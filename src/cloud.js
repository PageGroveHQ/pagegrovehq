import { mergeDocuments } from "./sync-merge";
import * as storage from "./storage";
import { fingerprint } from "./enhancements";
import { bookRecord } from "./spark-sync";
import { validateBackup, cleanSettings, tokenize } from "./engine";
let config = null,
  client = null,
  inflight = null,
  listeners = new Set(),
  readingBook = null;
export function setReadingBook(id) {
  readingBook = id;
}
let state = {
  configured: false,
  session: null,
  status: "local",
  conflicts: [],
  error: "",
  lastSynced: 0,
  pending: 0,
  cloudStorage: false,
};
function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}
export function cloudState() {
  return state;
}
export function needsSignInEmail() {
  return !!client?.needsEmail();
}
export async function ensureBookAvailable(book) {
  if (book.needsLocalFile)
    throw new Error(
      "This device has the synced reading record, but not the book file. Import the same file here to continue reading.",
    );
  if (book.cloudOwnerId && state.session?.user.id !== book.cloudOwnerId)
    throw new Error("Sign in to the account that owns this cloud book.");
  if (book.chapters.some((c) => c.blocks.length)) return book;
  if (!client || state.session?.user.id !== book.cloudOwnerId)
    throw new Error("Sign in to the account that owns this cloud book.");
  if (!navigator.onLine)
    throw new Error(
      "This book is stored in the cloud. Connect to the internet, or choose an offline book.",
    );
  const blob = await client.download(book.cloudContentPath);
  const content = JSON.parse(await blob.text());
  const validated = validateBackup({
    app: "pagegrovehq-reader",
    version: 1,
    books: [{ ...book, ...content }],
  }).books[0];
  return storage.cacheBookContent({
    ...validated,
    cloudOwnerId: book.cloudOwnerId,
    cloudContentPath: book.cloudContentPath,
    cloudContentDirty: false,
    offlineAvailable: !!book.offlineAvailable,
  });
}
export async function keepBookOffline(book, enabled) {
  if (enabled) await ensureBookAvailable(book);
  await storage.setOfflineBook(book.id, enabled);
}
export function subscribeCloud(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
export async function initializeCloud() {
  if (config) return state;
  try {
    const response = await fetch(
      new URL("cloud-config.json", document.baseURI),
    );
    config = await response.json();
    if (!config.enabled) {
      emit({ configured: false });
      return state;
    }
    if (
      !config.firebase?.projectId ||
      !config.firebase?.apiKey ||
      !config.firebase?.storageBucket
    )
      throw new Error("The cloud connection is not configured correctly.");
    const { createFirebaseBackend } = await import("./firebase-client");
    client = createFirebaseBackend(config.firebase);
    const session = await client.start((session) => {
      emit({ session, status: session ? "ready" : "signed-out" });
      if (session) setTimeout(() => syncLibrary(), 0);
    });
    emit({
      configured: true,
      cloudStorage: config.bookStorage === "cloud",
      session,
      status: session ? "ready" : "signed-out",
    });
    window.addEventListener("online", () => syncLibrary());
    window.addEventListener("grove-local-change", schedule);
    await syncLibrary();
  } catch (e) {
    emit({ error: e.message, status: "error" });
  }
  return state;
}
let timeout;
function schedule() {
  clearTimeout(timeout);
  timeout = setTimeout(() => syncLibrary(), 2000);
}
export async function signIn(email) {
  if (!client) throw new Error("Cloud accounts are not enabled yet.");
  await client.signIn(email);
}
export async function signOut() {
  storage.releaseReadingContent();
  const user = state.session?.user?.id;
  if (user) {
    await storage.setMeta("cloud-sync", { enabled: false, userId: user });
    await storage.clearQueue(user);
  }
  if (client) {
    await client.signOut();
  }
  emit({ session: null, status: "signed-out", conflicts: [] });
}
export async function enableSync(originals = true) {
  if (!state.session) throw new Error("Sign in first.");
  await storage.queueLibrary(state.session.user.id);
  await storage.setMeta("sync-originals", originals);
  await syncLibrary();
}
export async function disableSync() {
  if (state.session) {
    await storage.setMeta("cloud-sync", {
      enabled: false,
      userId: state.session.user.id,
    });
    await storage.clearQueue(state.session.user.id);
  }
  emit({ status: "local", pending: 0, conflicts: [] });
}
async function check(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function uploadContent(user, book) {
  if (book.cloudContentPath && !book.cloudContentDirty)
    return book.cloudContentPath;
  const content = JSON.stringify({
    chapters: book.chapters,
    cover: book.cover,
  });
  const hash = await fingerprint(content),
    path = `${user}/${book.id}/${hash}.json`;
  const bases = (await storage.getMeta(`cloud-bases:${user}`)) || {};
  if (bases[`book:${book.id}`]?.payload?.contentPath !== path) {
    await client.upload(
      path,
      new Blob([content], { type: "application/json" }),
      "application/json",
    );
  }
  return path;
}
async function localPayload(user, item) {
  if (item.kind === "preferences")
    return {
      settings: await storage.getSettings(),
      profiles: await storage.getProfiles(),
      vocabulary: await storage.getVocabulary(),
      shelves: (await storage.getMeta("shelves")) || [],
    };
  const book = (await storage.listBooks()).find((b) => b.id === item.id);
  if (!book) return null;
  if (config.bookStorage !== "cloud") {
    return bookRecord(book);
  }
  const contentPath = await uploadContent(user, book);
  const {
    chapters,
    cover,
    updatedAt,
    cloudContentPath,
    cloudContentDirty,
    cloudOwnerId,
    offlineAvailable,
    ...metadata
  } = book;
  const previous = (await storage.getMeta(`cloud-bases:${user}`))?.[
    `book:${book.id}`
  ];
  let originalPath = previous?.payload?.originalPath || null;
  if (await storage.getMeta("sync-originals")) {
    const original = await storage.getOriginal(book.id);
    if (original) {
      const hash = book.sourceHash || (await fingerprint(original));
      originalPath = `${user}/${book.id}/original-${hash}`;
      await client.upload(originalPath, original, "application/octet-stream");
    }
  }
  return {
    ...metadata,
    contentPath,
    originalPath,
    chapterSummaries: chapters.map((c) => ({
      id: c.id,
      title: c.title,
      excluded: !!c.excluded,
      wordCount: c.wordCount || tokenize({ chapters: [c] }).length,
    })),
  };
}
async function applyDocument(user, row) {
  if (row.kind === "preferences") {
    if (row.deleted) return;
    const preferences = validateBackup({
      app: "pagegrovehq-reader",
      version: 1,
      books: [],
      ...row.payload,
    });
    await storage.setMeta("settings", preferences.settings, {
      remote: true,
    });
    for (const key of ["profiles", "vocabulary", "shelves"])
      if (Array.isArray(preferences[key]))
        await storage.setMeta(key, preferences[key], { remote: true });
    return;
  }
  if (row.deleted) {
    await storage.deleteBook(row.record_id, { remote: true });
    return;
  }
  if (row.payload?.localOnly) {
    const previous = (await storage.listBooks()).find(
      (b) => b.id === row.record_id,
    );
    const hasFile =
      previous &&
      !previous.needsLocalFile &&
      previous.chapters.some((c) => c.blocks.some((b) => b.text));
    await storage.saveBook(
      {
        ...row.payload,
        id: row.record_id,
        syncOwnerId: user,
        needsLocalFile: !hasFile,
        cover: previous?.cover || null,
        chapters: hasFile
          ? previous.chapters
          : (row.payload.chapterSummaries || []).map((c) => ({
              ...c,
              blocks: [],
            })),
      },
      { remote: true },
    );
    return;
  }
  if (!row.payload?.contentPath?.startsWith(user + "/"))
    throw new Error("Invalid private book path.");
  const previous = (await storage.listBooks()).find(
    (b) => b.id === row.record_id,
  );
  const sameContent = previous?.cloudContentPath === row.payload.contentPath;
  const b = {
    ...row.payload,
    id: row.record_id,
    cloudOwnerId: user,
    cloudContentPath: row.payload.contentPath,
    cloudContentDirty: false,
    offlineAvailable: sameContent && !!previous?.offlineAvailable,
    cover: sameContent ? previous?.cover : null,
    chapters: sameContent
      ? previous.chapters
      : (row.payload.chapterSummaries || []).map((c) => ({ ...c, blocks: [] })),
  };
  if (b.readingSettings) b.readingSettings = cleanSettings(b.readingSettings);
  await storage.saveBook(b, { remote: true });
  if (b.offlineAvailable) await ensureBookAvailable(b);
}
async function writeDocument(user, item, payload, revision) {
  return client.write(item, payload, revision);
}
export async function syncLibrary() {
  if (inflight) return inflight;
  if (!client || !state.session) return;
  const user = state.session.user.id,
    sync = await storage.getMeta("cloud-sync");
  if (!sync?.enabled || sync.userId !== user) return;
  if (!navigator.onLine) {
    emit({ status: "offline" });
    return;
  }
  inflight = (async () => {
    try {
      emit({ status: "syncing", error: "" });
      let bases = (await storage.getMeta(`cloud-bases:${user}`)) || {};
      const items = await storage.pendingChanges(user),
        blocked = [];
      emit({ pending: items.length });
      for (const item of items) {
        const payload = await localPayload(user, item);
        const base = bases[`${item.kind}:${item.id}`];
        let result = await writeDocument(
          user,
          item,
          payload,
          base?.revision || 0,
        );
        if (!result.accepted) {
          const remote = result.document;
          const merged =
            item.deleted || remote.deleted
              ? { value: payload, conflicts: ["Book deletion"] }
              : mergeDocuments(base?.payload, payload, remote.payload);
          if (merged.conflicts.length) {
            blocked.push({
              item,
              local: payload,
              remote,
              fields: merged.conflicts,
              merged: merged.value,
            });
            continue;
          }
          result = await writeDocument(
            user,
            item,
            merged.value,
            remote.revision,
          );
          if (!result.accepted) {
            blocked.push({
              item,
              local: payload,
              remote: result.document,
              fields: ["Changed while syncing"],
              merged: merged.value,
            });
            continue;
          }
          await applyDocument(user, result.document);
        }
        bases[`${item.kind}:${item.id}`] = result.document;
        await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
        await storage.acknowledgeChange(item);
        if (
          config.bookStorage !== "cloud" &&
          item.kind === "book" &&
          !item.deleted
        )
          await storage.markSyncedMetadata(item.id, user);
        if (
          config.bookStorage === "cloud" &&
          item.kind === "book" &&
          !item.deleted &&
          !(await storage.pendingChanges(user)).some((p) => p.key === item.key)
        ) {
          await storage.markCloudBook(
            item.id,
            user,
            result.document.payload.contentPath,
            !!result.document.payload.originalPath,
          );
        }
      }
      const rows = await client.documents();
      const pending = await storage.pendingChanges(user);
      for (const row of rows) {
        const key = `${row.kind}:${row.record_id}`;
        if (
          (row.kind === "book" && row.record_id === readingBook) ||
          pending.some((i) => i.kind === row.kind && i.id === row.record_id) ||
          bases[key]?.revision === row.revision
        )
          continue;
        await applyDocument(user, row);
        bases[key] = row;
      }
      await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
      emit({
        status: blocked.length ? "conflict" : "synced",
        conflicts: blocked,
        lastSynced: Date.now(),
        pending: (await storage.pendingChanges(user)).length,
      });
    } catch (e) {
      emit({ status: "error", error: e.message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
export async function resolveConflict(conflict, choice) {
  const user = state.session.user.id;
  if (choice === "remote") {
    await applyDocument(user, conflict.remote);
    const bases = (await storage.getMeta(`cloud-bases:${user}`)) || {};
    bases[`${conflict.item.kind}:${conflict.item.id}`] = conflict.remote;
    await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
    await storage.acknowledgeChange(conflict.item);
  } else {
    const result = await writeDocument(
      user,
      conflict.item,
      conflict.merged,
      conflict.remote.revision,
    );
    if (!result.accepted)
      throw new Error(
        "The cloud copy changed again. Sync and review the newer copy.",
      );
    await applyDocument(user, result.document);
    const bases = (await storage.getMeta(`cloud-bases:${user}`)) || {};
    bases[`${conflict.item.kind}:${conflict.item.id}`] = result.document;
    await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
    await storage.acknowledgeChange(conflict.item);
  }
  emit({ conflicts: state.conflicts.filter((c) => c !== conflict) });
  await syncLibrary();
}
export function aiAvailable() {
  return !!config?.aiEnabled && !!state.session;
}
export async function askReadingAssistant(mode, passages) {
  if (!aiAvailable())
    throw new Error(
      "Sign in to an AI-enabled Page Grove deployment to use this tool.",
    );
  return client.invoke("readingAssistant", { mode, passages });
}
export async function queueServerOCR(bookId) {
  if (!config?.serverOcrEnabled || !state.session)
    throw new Error("Server OCR is not enabled for this deployment.");
  return client.invoke("requestOcr", { bookId });
}
export async function listProcessingJobs() {
  if (!config?.serverOcrEnabled || !state.session) return [];
  return client.jobs();
}
export function processingAvailable() {
  return !!config?.serverOcrEnabled && !!state.session;
}
export async function downloadProcessingResult(job) {
  const user = state.session?.user.id;
  if (
    !user ||
    !job.result_path ||
    !job.result_path.startsWith(user + "/") ||
    job.status !== "complete"
  )
    throw new Error("No completed private result is available.");
  const blob = await client.download(job.result_path);
  return JSON.parse(await blob.text());
}
export async function cancelProcessingJob(id) {
  if (!client || !state.session) throw new Error("Sign in first.");
  await client.invoke("cancelOcr", { id });
}
