import { openDB } from "idb";
import { DEFAULT_SETTINGS } from "./engine";
import { BUILTIN_PROFILES, upgradeBook, fingerprint } from "./enhancements";
import { contentFingerprint } from "./spark-sync";
const database = openDB("pagegrovehq-rsvp-library-v1", 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("books"))
      db.createObjectStore("books", { keyPath: "id" });
    if (!db.objectStoreNames.contains("originals"))
      db.createObjectStore("originals");
    if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
    if (!db.objectStoreNames.contains("outbox"))
      db.createObjectStore("outbox", { keyPath: "key" });
  },
});
const readingContent = new Map();
export async function prepareBookIdentities() {
  for (const book of await listBooks()) {
    if (book.needsLocalFile) continue;
    let changed = false;
    if (!book.sourceHash) {
      const file = await getOriginal(book.id);
      if (file) {
        book.sourceHash = await fingerprint(file);
        changed = true;
      }
    }
    if (
      !book.contentHash &&
      book.chapters.some((c) => c.blocks.some((b) => b.text))
    ) {
      book.contentHash = await contentFingerprint(book);
      changed = true;
    }
    if (changed) await saveBook(book);
  }
}
export async function consolidateBook(book, aliases, userId) {
  const tx = (await database).transaction(
    ["books", "originals", "meta", "outbox"],
    "readwrite",
  );
  const recovered =
    (await tx.objectStore("meta").get("recovered-sync-copies")) || [];
  for (const id of aliases) {
    const old = await tx.objectStore("books").get(id);
    if (!old) continue;
    recovered.push({ ...old, recoveredAt: Date.now(), reconnectedTo: book.id });
    const original = await tx.objectStore("originals").get(id);
    if (original && !(await tx.objectStore("originals").get(book.id)))
      await tx.objectStore("originals").put(original, book.id);
    await tx.objectStore("books").delete(id);
    await tx.objectStore("outbox").delete(`${userId}:book:${id}`);
  }
  await tx.objectStore("meta").put(recovered, "recovered-sync-copies");
  await tx.objectStore("books").put(
    persistedBook({
      ...upgradeBook(book),
      syncOwnerId: userId,
      updatedAt: Date.now(),
    }),
  );
  await enqueue(tx, book.id);
  await tx.done;
  notify();
}
function withoutContent(book) {
  return {
    ...book,
    cover: book.driveSource && book.cover?.length < 250000 ? book.cover : null,
    chapters: book.chapters.map((c) => ({
      id: c.id,
      title: c.title,
      excluded: !!c.excluded,
      wordCount:
        c.wordCount ||
        c.blocks.reduce(
          (n, b) =>
            n + (b.text?.trim().split(/\s+/).filter(Boolean).length || 0),
          0,
        ),
      blocks: [],
    })),
  };
}
function persistedBook(book) {
  if (
    ((book.cloudContentPath && !book.cloudContentDirty) ||
      (book.driveSource && !book.driveEdited)) &&
    !book.offlineAvailable
  ) {
    if (book.chapters.some((c) => c.blocks.length))
      readingContent.set(book.id, {
        chapters: book.chapters,
        cover: book.cover,
      });
    return withoutContent(book);
  }
  return book;
}
export async function cacheBookContent(book) {
  readingContent.set(book.id, { chapters: book.chapters, cover: book.cover });
  await saveBook(book, { remote: true });
  return book;
}
export async function markCloudBook(id, user, path, originalUploaded = false) {
  const db = await database,
    tx = db.transaction(["books", "originals", "outbox"], "readwrite");
  const book = await tx.objectStore("books").get(id);
  if (!book || (await tx.objectStore("outbox").get(`${user}:book:${id}`))) {
    await tx.done;
    return;
  }
  book.cloudOwnerId = user;
  book.cloudContentPath = path;
  book.cloudContentDirty = false;
  await tx.objectStore("books").put(persistedBook(book));
  if (originalUploaded) await tx.objectStore("originals").delete(id);
  await tx.done;
  notify(true);
}
export async function setOfflineBook(id, enabled) {
  const book = (await listBooks()).find((b) => b.id === id);
  if (!book) return;
  if (enabled && !book.chapters.some((c) => c.blocks.length))
    throw new Error("Download this book before keeping it offline.");
  book.offlineAvailable = enabled;
  await saveBook(book, { remote: true });
  if (!enabled && book.driveSource)
    await (await database).delete("originals", id);
}
export function releaseReadingContent(id) {
  if (id) readingContent.delete(id);
  else readingContent.clear();
}
export async function markSyncedMetadata(id, userId) {
  const tx = (await database).transaction("books", "readwrite");
  const book = await tx.store.get(id);
  if (book) await tx.store.put({ ...book, syncOwnerId: userId });
  await tx.done;
}
const notify = (remote = false) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("grove-library-change"));
    if (!remote) window.dispatchEvent(new Event("grove-local-change"));
  }
};
async function enqueue(tx, id, kind = "book", deleted = false) {
  const config = await tx.objectStore("meta").get("cloud-sync");
  if (!config?.enabled || !config.userId) return;
  if (kind === "book") {
    const book = await tx.objectStore("books").get(id);
    if (book?.syncOwnerId && book.syncOwnerId !== config.userId) return;
  }
  const key = `${config.userId}:${kind}:${id}`;
  await tx.objectStore("outbox").put({
    key,
    id,
    kind,
    deleted,
    userId: config.userId,
    generation: crypto.randomUUID(),
    queuedAt: Date.now(),
  });
}
export async function listBooks() {
  const db = await database;
  const books = await db.getAll("books");
  const changed = books.filter(
    (b) =>
      !b.chapters[0]?.id ||
      !Array.isArray(b.highlights) ||
      !Array.isArray(b.sessions),
  );
  for (const book of changed) await db.put("books", upgradeBook(book));
  return books.map((b) =>
    upgradeBook({ ...b, ...(readingContent.get(b.id) || {}) }),
  );
}
export async function saveBook(book, options = {}) {
  if (book.cloudContentDirty) readingContent.delete(book.id);
  if (options.remote) {
    const old = await (await database).get("books", book.id);
    if (
      old?.cloudContentPath !== book.cloudContentPath ||
      old?.driveSource?.checksum !== book.driveSource?.checksum ||
      old?.driveSource?.modifiedTime !== book.driveSource?.modifiedTime
    )
      readingContent.delete(book.id);
  }
  const tx = (await database).transaction(
    ["books", "meta", "outbox"],
    "readwrite",
  );
  await tx
    .objectStore("books")
    .put(persistedBook({ ...upgradeBook(book), updatedAt: Date.now() }));
  if (!options.remote) await enqueue(tx, book.id);
  await tx.done;
  notify(!!options.remote);
}
export const getOriginal = async (id) => (await database).get("originals", id);
export async function addBook(book, original) {
  const tx = (await database).transaction(
    ["books", "originals", "meta", "outbox"],
    "readwrite",
  );
  await tx
    .objectStore("books")
    .put(persistedBook({ ...upgradeBook(book), updatedAt: Date.now() }));
  if (original) await tx.objectStore("originals").put(original, book.id);
  await enqueue(tx, book.id);
  await tx.done;
  notify();
}
export async function deleteBook(id, options = {}) {
  const tx = (await database).transaction(
    ["books", "originals", "meta", "outbox"],
    "readwrite",
  );
  const previous = await tx.objectStore("books").get(id);
  if (previous?.driveSource && !options.remote) {
    const key = `drive-ignored:${previous.driveSource.ownerId}`;
    const ignored = (await tx.objectStore("meta").get(key)) || [];
    await tx
      .objectStore("meta")
      .put([...new Set([...ignored, previous.driveSource.fileId])], key);
    await enqueue(tx, "preferences", "preferences");
  }
  await tx.objectStore("books").delete(id);
  await tx.objectStore("originals").delete(id);
  readingContent.delete(id);
  if (!options.remote) await enqueue(tx, id, "book", true);
  await tx.done;
  notify(!!options.remote);
}
export async function patchBook(id, patch) {
  const tx = (await database).transaction(
    ["books", "meta", "outbox"],
    "readwrite",
  );
  let book = await tx.objectStore("books").get(id);
  if (book) {
    book = { ...book, ...(readingContent.get(id) || {}) };
    if (
      Object.hasOwn(patch, "cover") &&
      patch.cover !== book.cover &&
      book.cloudContentPath
    )
      patch.cloudContentDirty = true;
    if (
      Object.hasOwn(patch, "cover") &&
      patch.cover !== book.cover &&
      book.driveSource
    )
      patch.driveCoverOverride = true;
    const tombstones = [
      ...(book.annotationTombstones || []),
      ...(patch.annotationTombstones || []),
    ];
    const dead = new Set(tombstones.map((t) => t.id));
    for (const key of ["bookmarks", "highlights"])
      if (patch[key]) {
        const merged = new Map((book[key] || []).map((x) => [x.id, x]));
        for (const x of patch[key]) merged.set(x.id, x);
        patch[key] = [...merged.values()].filter((x) => !dead.has(x.id));
      }
    if (tombstones.length)
      patch.annotationTombstones = [
        ...new Map(tombstones.map((t) => [t.id, t])).values(),
      ];
    Object.assign(book, patch, { updatedAt: Date.now() });
    await tx.objectStore("books").put(persistedBook(upgradeBook(book)));
    await enqueue(tx, id);
  }
  await tx.done;
  notify();
  return book;
}
export const getSettings = async () => ({
  ...DEFAULT_SETTINGS,
  ...(await (await database).get("meta", "settings")),
});
export const saveSettings = async (settings) => setMeta("settings", settings);
export const getMeta = async (key) => (await database).get("meta", key);
export async function setMeta(key, value, options = {}) {
  const tx = (await database).transaction(["meta", "outbox"], "readwrite");
  await tx.objectStore("meta").put(value, key);
  if (
    !options.remote &&
    (["settings", "profiles", "vocabulary", "shelves"].includes(key) ||
      key.startsWith("drive-folder:") ||
      key.startsWith("drive-ignored:"))
  )
    await enqueue(tx, "preferences", "preferences");
  await tx.done;
  notify(
    !!options.remote ||
      !(
        ["settings", "profiles", "vocabulary", "shelves"].includes(key) ||
        key.startsWith("drive-folder:") ||
        key.startsWith("drive-ignored:")
      ),
  );
}
export const getProfiles = async () =>
  (await getMeta("profiles")) || BUILTIN_PROFILES;
export const getVocabulary = async () => (await getMeta("vocabulary")) || [];
export async function restoreLibrary(
  books,
  settings,
  replace = false,
  extras = {},
) {
  const tx = (await database).transaction(
    ["books", "meta", "originals", "outbox"],
    "readwrite",
  );
  if (replace) {
    const old = await tx.objectStore("books").getAll();
    for (const b of old)
      if (!books.some((x) => x.id === b.id))
        await enqueue(tx, b.id, "book", true);
    await tx.objectStore("books").clear();
    await tx.objectStore("originals").clear();
  }
  for (const b of books) {
    await tx.objectStore("books").put(upgradeBook(b));
    await tx.objectStore("originals").delete(b.id);
    await enqueue(tx, b.id);
  }
  await tx.objectStore("meta").put(settings, "settings");
  for (const key of ["profiles", "vocabulary", "shelves"])
    if (extras[key]) await tx.objectStore("meta").put(extras[key], key);
  await enqueue(tx, "preferences", "preferences");
  await tx.done;
  notify();
}
export async function pendingChanges(userId) {
  return (await (await database).getAll("outbox")).filter(
    (x) => x.userId === userId,
  );
}
export async function acknowledgeChange(item) {
  const tx = (await database).transaction("outbox", "readwrite");
  const latest = await tx.store.get(item.key);
  if (latest?.generation === item.generation) await tx.store.delete(item.key);
  await tx.done;
}
export async function queueLibrary(userId) {
  await setMeta("cloud-sync", { enabled: true, userId });
  const tx = (await database).transaction(
    ["books", "meta", "outbox"],
    "readwrite",
  );
  for (const b of await tx.objectStore("books").getAll())
    if (
      (!b.cloudOwnerId || b.cloudOwnerId === userId) &&
      (!b.syncOwnerId || b.syncOwnerId === userId)
    )
      await enqueue(tx, b.id);
  await enqueue(tx, "preferences", "preferences");
  await tx.done;
  notify();
}
export async function clearQueue(userId) {
  const tx = (await database).transaction("outbox", "readwrite");
  for (const item of await tx.store.getAll())
    if (item.userId === userId) await tx.store.delete(item.key);
  await tx.done;
}
