import { tokenize } from "./engine";
import { fingerprint, referenceAt } from "./enhancements";

export function sameBook(a, b) {
  if (a.demo && b.demo)
    return (
      a.title?.normalize("NFKC").toLowerCase() ===
        b.title?.normalize("NFKC").toLowerCase() && a.author === b.author
    );
  if (a.separateCopy || b.separateCopy) return false;
  return !!(
    (a.driveSource?.fileId &&
      a.driveSource.fileId === b.driveSource?.fileId &&
      a.driveSource.ownerId === b.driveSource.ownerId) ||
    (a.sourceHash && a.sourceHash === b.sourceHash) ||
    (a.contentHash &&
      a.contentHash === b.contentHash &&
      a.format === b.format &&
      a.wordCount >= 100 &&
      b.wordCount >= 100 &&
      a.title?.normalize("NFKC").toLowerCase() ===
        b.title?.normalize("NFKC").toLowerCase() &&
      a.author === b.author)
  );
}
export async function contentFingerprint(book) {
  return fingerprint(
    tokenize(book)
      .map((w) => w.text.normalize("NFC"))
      .join(" "),
  );
}
export function reconnectCandidates(book, books) {
  const matches = books.filter((b) => sameBook(book, b));
  return matches.sort(
    (a, b) =>
      Number(!!b.needsLocalFile) - Number(!!a.needsLocalFile) ||
      (a.addedAt || 0) - (b.addedAt || 0),
  );
}
export function combineCopies(local, record, { confirmed = false } = {}) {
  const full = local.chapters.some((c) => c.blocks.some((b) => b.text));
  const connected = full
    ? relinkLocalFile(local, record, { confirmed })
    : record.chapters?.some((c) => c.blocks.some((b) => b.text))
      ? { ...record }
      : { ...record, chapters: local.chapters, needsLocalFile: true };
  for (const key of [
    "bookmarks",
    "highlights",
    "sessions",
    "annotationTombstones",
  ]) {
    const entries = new Map((record[key] || []).map((x) => [x.id, x]));
    for (const entry of local[key] || []) {
      const previous = entries.get(entry.id);
      if (!previous || (entry.updatedAt || 0) > (previous.updatedAt || 0))
        entries.set(entry.id, entry);
    }
    connected[key] = [...entries.values()];
  }
  if (
    local.position !== record.position &&
    (local.position > 0 || local.completed)
  ) {
    const id = `recovered-position-${local.id}-${local.position}`;
    if (!connected.bookmarks.some((m) => m.id === id))
      connected.bookmarks.push({
        id,
        position: local.position,
        createdAt: Date.now(),
        note: "Reading position recovered from another copy.",
        quote: tokenize(local)
          .slice(local.position, local.position + 12)
          .map((w) => w.text)
          .join(" "),
      });
  }
  const words = full ? tokenize(connected) : [];
  if (words.length)
    for (const key of ["bookmarks", "highlights"])
      connected[key] = connected[key].map((m) => ({
        ...m,
        reference: referenceAt(words, m.position),
        ...(key === "highlights"
          ? { endReference: referenceAt(words, m.endPosition ?? m.position) }
          : {}),
      }));
  const dead = new Set(connected.annotationTombstones.map((t) => t.id));
  for (const key of ["bookmarks", "highlights"])
    connected[key] = connected[key].filter((m) => !dead.has(m.id));
  connected.secondsRead = Math.max(
    record.secondsRead || 0,
    local.secondsRead || 0,
    connected.sessions.reduce((n, s) => n + (s.seconds || 0), 0),
  );
  connected.wordsRead = Math.max(record.wordsRead || 0, local.wordsRead || 0);
  connected.tags = [
    ...new Set([...(record.tags || []), ...(local.tags || [])]),
  ];
  connected.description = record.description || local.description || "";
  connected.collection = record.collection || local.collection || "";
  connected.sourceHash = local.sourceHash || record.sourceHash;
  connected.contentHash = local.contentHash || record.contentHash;
  if (record.driveSource || local.driveSource) {
    connected.driveSource = record.driveSource || local.driveSource;
    connected.driveUpdate = record.driveUpdate || local.driveUpdate || null;
    connected.needsLocalFile = false;
    connected.offlineAvailable = !!(
      record.offlineAvailable || local.offlineAvailable
    );
  }
  return connected;
}

// No full book text, original bytes, or illustrations enter a Spark record.
export function bookRecord(book) {
  const {
    chapters,
    cover,
    updatedAt,
    offlineAvailable,
    cloudContentPath,
    cloudContentDirty,
    cloudOwnerId,
    needsLocalFile,
    driveEdited,
    ...metadata
  } = book;
  return {
    ...metadata,
    localOnly: true,
    chapterSummaries:
      book.needsLocalFile ||
      (book.driveSource && !chapters.some((c) => c.blocks.length))
        ? book.chapterSummaries
        : chapters.map((c) => ({
            id: c.id,
            title: c.title,
            excluded: !!c.excluded,
            wordCount: c.wordCount || tokenize({ chapters: [c] }).length,
            blocks: c.blocks.map((b) => b.id),
          })),
  };
}
export function relinkLocalFile(imported, record, { confirmed = false } = {}) {
  if (!confirmed && !sameBook(imported, record))
    throw new Error(
      "Choose the same original file to reconnect its reading record.",
    );
  const summaries = record.chapterSummaries || record.chapters;
  const chapters = imported.chapters.map((c, i) => ({
    ...c,
    id: summaries[i]?.id || c.id,
    blocks: c.blocks.map((b, j) => ({
      ...b,
      id:
        (typeof summaries[i]?.blocks?.[j] === "string"
          ? summaries[i].blocks[j]
          : summaries[i]?.blocks?.[j]?.id) || b.id,
    })),
  }));
  return {
    ...imported,
    ...record,
    chapters,
    cover: imported.cover,
    id: record.id,
    syncCanonicalId: record.id,
    sourceName: imported.sourceName,
    format: imported.format,
    sourceHash: imported.sourceHash,
    contentHash: imported.contentHash || record.contentHash,
    needsLocalFile: false,
    wordCount: imported.wordCount,
    position: Math.min(record.position || 0, imported.wordCount - 1),
  };
}
