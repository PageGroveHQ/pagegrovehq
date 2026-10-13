import { mergeDocuments } from "./sync-merge";
import * as storage from "./storage";
import { fingerprint } from "./enhancements";
import { bookRecord, sameBook, combineCopies } from "./spark-sync";
import { validateBackup, cleanSettings, tokenize } from "./engine";
import { createDriveClient, cleanDriveFolder } from "./drive-client";
import { scanDriveLibrary, openDriveBook } from "./drive-library";
import { coverThumbnail } from "./cover-thumbnail";
let config = null,
  client = null,
  inflight = null,
  listeners = new Set(),
  readingBook = null;
export function setReadingBook(id) {
  readingBook = id;
  if (!id) schedule();
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
  driveConnected: false,
  driveStatus: "disconnected",
  driveProgress: null,
  driveResult: null,
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
export async function ensureBookAvailable(book, options = {}) {
  if (book.driveSource) {
    const available = await openDriveBook(book, {
      drive: driveClient(),
      ownerId: state.session?.user.id,
      ...options,
    });
    return available;
  }
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
  if (!enabled && book.driveEdited)
    throw new Error(
      "Your repaired text is kept on this device. Use the updated Drive file first if you want to discard those repairs.",
    );
  if (enabled) await ensureBookAvailable(book);
  await storage.setOfflineBook(book.id, enabled);
}
function driveClient() {
  if (!client || !state.session) throw new Error("Sign in with Google first.");
  return createDriveClient(() => client.driveAccessToken());
}
export async function signInGoogle() {
  if (!client) throw new Error("Cloud accounts are not enabled yet.");
  const session = await client.signInGoogle();
  emit({ session, error: "", status: "ready" });
  // Authentication is complete; slow/offline Firestore must not keep login busy.
  void syncLibrary();
}
export async function connectDrive() {
  await client.connectDrive();
  emit({ driveConnected: true, driveStatus: "ready", error: "" });
}
export async function disconnectDrive() {
  cancelDriveSync();
  client?.disconnectDrive();
  emit({ driveConnected: false, driveStatus: "disconnected" });
}
export async function listDriveFolders(parent = "root") {
  return driveClient().folders(parent);
}
export async function setDriveFolder(id, recursive) {
  const user = state.session?.user.id;
  const folder = await driveClient().file(id);
  if (
    folder.mimeType !== "application/vnd.google-apps.folder" ||
    folder.trashed
  )
    throw new Error("Choose an available Drive folder.");
  await storage.setMeta(
    `drive-folder:${user}`,
    cleanDriveFolder({ ...folder, recursive, enabled: true }),
  );
  await syncDriveFolder();
}
let driveInflight = null,
  driveAbort = null,
  driveLastCheck = 0;
export function cancelDriveSync() {
  driveAbort?.abort();
}
export async function syncDriveFolder({ automatic = false } = {}) {
  if (driveInflight) return driveInflight;
  const user = state.session?.user.id;
  const folder =
    user && cleanDriveFolder(await storage.getMeta(`drive-folder:${user}`));
  if (!folder?.enabled) return;
  if (!client?.driveAccess?.()) {
    emit({ driveConnected: false, driveStatus: "reconnect" });
    if (!automatic)
      throw new Error("Reconnect Google Drive to check your books folder.");
    return;
  }
  if (
    !navigator.onLine ||
    (automatic &&
      (document.hidden || readingBook || Date.now() - driveLastCheck < 300000))
  )
    return;
  driveLastCheck = Date.now();
  driveAbort = new AbortController();
  driveInflight = (async () => {
    emit({
      driveStatus: "syncing",
      driveProgress: { message: "Checking your Drive folder…", percent: 0 },
      error: "",
    });
    try {
      await syncLibrary();
      const result = await scanDriveLibrary({
        drive: driveClient(),
        ownerId: user,
        folder,
        signal: driveAbort.signal,
        activeBook: readingBook,
        report: (message, percent) =>
          emit({ driveProgress: { message, percent } }),
      });
      if (state.session?.user.id !== user) return;
      emit({
        driveStatus: result.errors.length ? "partial" : "synced",
        driveResult: result,
        driveProgress: null,
      });
      await syncLibrary();
      return result;
    } catch (e) {
      emit({
        ...(/Reconnect|access expired/i.test(e.message)
          ? { driveConnected: false }
          : {}),
        driveStatus: e.name === "AbortError" ? "ready" : "error",
        driveProgress: null,
        ...(e.name !== "AbortError" ? { error: e.message } : {}),
      });
      if (!automatic && e.name !== "AbortError") throw e;
    } finally {
      driveInflight = null;
      driveAbort = null;
    }
  })();
  return driveInflight;
}
export async function updateDriveBook(book) {
  const result = await openDriveBook(book, {
    drive: driveClient(),
    ownerId: state.session?.user.id,
    acceptUpdate: true,
  });
  await storage.saveBook(result);
  return result;
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
    window.addEventListener("online", () =>
      syncDriveFolder({ automatic: true }),
    );
    document.addEventListener("visibilitychange", () =>
      syncDriveFolder({ automatic: true }),
    );
    setInterval(() => syncDriveFolder({ automatic: true }), 60000);
    await syncLibrary();
  } catch (e) {
    emit({ error: e.message, status: "error" });
  }
  return state;
}
let timeout;
function schedule() {
  // Coalesce reader autosaves rather than fetching the entire cloud index for
  // every few words. The manual Sync now action remains immediate.
  if (readingBook && timeout) return;
  clearTimeout(timeout);
  timeout = setTimeout(
    () => {
      timeout = null;
      syncLibrary();
    },
    readingBook ? 30000 : 2000,
  );
}
export async function signIn(email) {
  if (!client) throw new Error("Cloud accounts are not enabled yet.");
  await client.signIn(email);
}
export async function signOut() {
  cancelDriveSync();
  storage.releaseReadingContent();
  const user = state.session?.user?.id;
  if (user) {
    await storage.setMeta("cloud-sync", { enabled: false, userId: user });
    await storage.clearQueue(user);
  }
  if (client) {
    await client.signOut();
  }
  emit({
    session: null,
    status: "signed-out",
    conflicts: [],
    driveConnected: false,
    driveStatus: "disconnected",
    driveResult: null,
  });
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
  if (item.deleted) return item.payload || null;
  if (item.kind === "preferences")
    return {
      settings: await storage.getSettings(),
      profiles: await storage.getProfiles(),
      vocabulary: await storage.getVocabulary(),
      shelves: (await storage.getMeta("shelves")) || [],
      driveFolder: cleanDriveFolder(
        await storage.getMeta(`drive-folder:${user}`),
      ),
      driveIgnored: (await storage.getMeta(`drive-ignored:${user}`)) || [],
    };
  const book = (await storage.listBooks()).find((b) => b.id === item.id);
  if (!book) return null;
  if (config.bookStorage !== "cloud") {
    return { ...bookRecord(book), coverThumbnail: await coverThumbnail(book.cover) || book.coverThumbnail || null };
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
    await storage.setMeta(
      `drive-folder:${user}`,
      cleanDriveFolder(row.payload.driveFolder),
      { remote: true },
    );
    if (Array.isArray(row.payload.driveIgnored))
      await storage.setMeta(
        `drive-ignored:${user}`,
        row.payload.driveIgnored
          .filter((x) => typeof x === "string" && /^[\w-]{1,200}$/.test(x))
          .slice(0, 10000),
        { remote: true },
      );
    return;
  }
  if (row.deleted) {
    if (row.payload?.syncRedirectTo) {
      const local = await storage.listBooks(),
        alias = local.find((b) => b.id === row.record_id);
      if (alias) {
        const target =
          local.find((b) => b.id === row.payload.syncRedirectTo) ||
          (await client.documents())
            .filter(
              (r) => !r.deleted && r.record_id === row.payload.syncRedirectTo,
            )
            .map(rowBook)[0];
        if (target)
          await storage.consolidateBook(
            combineCopies(alias, target),
            [alias.id],
            user,
          );
      }
      return;
    }
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
        needsLocalFile: !hasFile && !row.payload.driveSource,
        offlineAvailable: !!previous?.offlineAvailable,
        driveEdited: !!previous?.driveEdited,
        cover: row.payload.coverThumbnail || previous?.cover || null,
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
const rowBook = (row) => ({
  ...row.payload,
  id: row.record_id,
  needsLocalFile: true,
  chapters: (row.payload.chapterSummaries || []).map((c) => ({
    ...c,
    blocks: [],
  })),
});
async function reconcileCopies(user, rows, bases) {
  await storage.prepareBookIdentities();
  const books = (await storage.listBooks()).filter(
      (b) => !b.syncOwnerId || b.syncOwnerId === user,
    ),
    handled = new Set();
  const redirects = (await storage.getMeta(`sync-redirects:${user}`)) || [];
  const active = rows
    .filter((r) => r.kind === "book" && !r.deleted)
    .sort(
      (a, b) =>
        Number(
          books.some((x) => x.syncCanonicalId === b.record_id) ||
            b.payload.syncCanonicalId === b.record_id,
        ) -
          Number(
            books.some((x) => x.syncCanonicalId === a.record_id) ||
              a.payload.syncCanonicalId === a.record_id,
          ) ||
        (a.payload.addedAt || 0) - (b.payload.addedAt || 0) ||
        a.record_id.localeCompare(b.record_id),
    );
  for (const row of active) {
    if (handled.has(row.record_id)) continue;
    const group = active.filter(
      (r) =>
        r.record_id === row.record_id ||
        sameBook(r.payload, row.payload) ||
        books.some(
          (b) =>
            (b.id === row.record_id && sameBook(b, r.payload)) ||
            (b.id === r.record_id && sameBook(b, row.payload)),
        ),
    );
    group.forEach((r) => handled.add(r.record_id));
    const local = books.filter(
      (b) =>
        (!b.syncOwnerId || b.syncOwnerId === user) &&
        (group.some((r) => r.record_id === b.id) || sameBook(b, row.payload)),
    );
    const aliases = local.filter((b) => b.id !== row.record_id);
    const remoteAliases = group.filter((r) => r.record_id !== row.record_id);
    if (!aliases.length && !remoteAliases.length) continue;
    if (local.some((b) => b.id === readingBook)) continue;
    let result = local.find((b) => b.id === row.record_id) || rowBook(row);
    result = {
      ...result,
      sourceHash: result.sourceHash || row.payload.sourceHash,
      contentHash: result.contentHash || row.payload.contentHash,
    };
    for (const other of remoteAliases)
      result = combineCopies(rowBook(other), result);
    for (const other of aliases) result = combineCopies(other, result);
    result.syncCanonicalId = row.record_id;
    await storage.consolidateBook(
      result,
      aliases.map((b) => b.id),
      user,
    );
    // A device that has never seen this ID must merge against its existing cloud
    // revision, rather than creating a second row or treating all fields as new.
    bases[`book:${row.record_id}`] ||= row;
    for (const other of remoteAliases)
      if (!redirects.some((r) => r.alias.record_id === other.record_id))
        redirects.push({ alias: other, target: row.record_id });
  }
  await storage.setMeta(`sync-redirects:${user}`, redirects, { remote: true });
  await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
}
async function finishRedirects(user, bases) {
  const pending = await storage.pendingChanges(user),
    remaining = [];
  for (const redirect of (await storage.getMeta(`sync-redirects:${user}`)) ||
    []) {
    if (pending.some((i) => i.kind === "book" && i.id === redirect.target)) {
      remaining.push(redirect);
      continue;
    }
    const alias = redirect.alias;
    const result = await writeDocument(
      user,
      { kind: "book", id: alias.record_id, deleted: true },
      { ...alias.payload, syncRedirectTo: redirect.target },
      alias.revision,
    );
    if (!result.accepted) {
      remaining.push({ ...redirect, alias: result.document });
      continue;
    }
    bases[`book:${alias.record_id}`] = result.document;
  }
  await storage.setMeta(`sync-redirects:${user}`, remaining, { remote: true });
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
      const initialRows = await client.documents();
      // A stale local edit must not resurrect a book removed on another device.
      // Preserve the stale copy for recovery before accepting the tombstone.
      for (const row of initialRows.filter(r => r.kind === "book" && r.deleted && !r.payload?.syncRedirectTo)) {
        const local = (await storage.listBooks()).filter(b =>
          (!b.syncOwnerId || b.syncOwnerId === user) &&
          (b.id === row.record_id || sameBook(b, row.payload || {})));
        for (const book of local) {
          if (book.id === readingBook) continue;
          const queued = (await storage.pendingChanges(user)).filter(i => i.kind === "book" && i.id === book.id);
          const recovered = (await storage.getMeta(`sync-deleted-copies:${user}`)) || [];
          await storage.setMeta(`sync-deleted-copies:${user}`, [...recovered.filter(b => b.id !== book.id), book], { remote: true });
          await storage.deleteBook(book.id, { remote: true });
          for (const item of queued) await storage.acknowledgeChange(item);
          bases[`book:${book.id}`] = row;
        }
      }
      await reconcileCopies(user, initialRows, bases);
      // Backfill artwork for books synced before cover thumbnails were supported.
      for (const book of await storage.listBooks()) {
        if (book.syncOwnerId && book.syncOwnerId !== user) continue;
        const remote = initialRows.find(r => r.kind === "book" && !r.deleted && r.record_id === book.id);
        if (remote && !remote.payload.coverThumbnail && book.cover) {
          const thumbnail = await coverThumbnail(book.cover);
          if (thumbnail) await storage.patchBook(book.id, { coverThumbnail: thumbnail });
        }
      }
      const items = await storage.pendingChanges(user),
        blocked = [];
      emit({ pending: items.length });
      for (const item of items) {
        const payload = await localPayload(user, item);
        if (
          item.kind === "book" &&
          item.id === readingBook &&
          initialRows.some(
            (r) =>
              r.kind === "book" &&
              !r.deleted &&
              r.record_id !== item.id &&
              sameBook(payload, r.payload),
          )
        )
          continue;
        const base = bases[`${item.kind}:${item.id}`];
        let result = await writeDocument(
          user,
          item,
          payload,
          base?.revision || 0,
        );
        if (!result.accepted) {
          const remote = result.document;
          if (item.deleted && remote.deleted) {
            bases[`${item.kind}:${item.id}`] = remote;
            await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
            await storage.acknowledgeChange(item);
            continue;
          }
          if (item.deleted && !remote.deleted) {
            result = await writeDocument(user, item, payload || remote.payload, remote.revision);
            if (result.accepted) {
              bases[`${item.kind}:${item.id}`] = result.document;
              await storage.setMeta(`cloud-bases:${user}`, bases, { remote: true });
              await storage.acknowledgeChange(item);
              continue;
            }
          }
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
      await finishRedirects(user, bases);
      const rows = await client.documents();
      const pending = await storage.pendingChanges(user);
      for (const row of rows) {
        const key = `${row.kind}:${row.record_id}`;
        if (
          (row.kind === "book" && row.record_id === readingBook) ||
          (await storage.pendingChanges(user)).some(
            (i) => i.kind === row.kind && i.id === row.record_id,
          ) ||
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
