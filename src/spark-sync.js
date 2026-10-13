import { tokenize } from "./engine";

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
    ...metadata
  } = book;
  return {
    ...metadata,
    localOnly: true,
    chapterSummaries: book.needsLocalFile
      ? book.chapterSummaries
      : chapters.map((c) => ({
          id: c.id,
          title: c.title,
          excluded: !!c.excluded,
          wordCount: c.wordCount || tokenize({ chapters: [c] }).length,
          blocks: c.blocks.map((b) => ({
            id: b.id,
            type: b.type,
            excluded: !!b.excluded,
          })),
        })),
  };
}
export function relinkLocalFile(imported, record) {
  if (!imported.sourceHash || imported.sourceHash !== record.sourceHash)
    throw new Error(
      "Choose the same original file to reconnect its reading record.",
    );
  const summaries = record.chapterSummaries || record.chapters;
  const chapters = imported.chapters.map((c, i) => ({
    ...c,
    id: summaries[i]?.id || c.id,
    blocks: c.blocks.map((b, j) => ({
      ...b,
      id: summaries[i]?.blocks[j]?.id || b.id,
    })),
  }));
  return {
    ...imported,
    ...record,
    chapters,
    cover: imported.cover,
    id: record.id,
    needsLocalFile: false,
    wordCount: imported.wordCount,
    position: Math.min(record.position || 0, imported.wordCount - 1),
  };
}
