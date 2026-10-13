import * as storage from "./storage";
import { importFile } from "./importers";
import { fingerprint } from "./enhancements";
import {
  bookRecord,
  contentFingerprint,
  sameBook,
  combineCopies,
  relinkLocalFile,
} from "./spark-sync";
export function driveSource(file, ownerId, folder) {
  return {
    fileId: file.id,
    ownerId,
    folderId: folder.id,
    name: file.name,
    modifiedTime: file.modifiedTime || "",
    checksum: file.md5Checksum || "",
    size: Number(file.size) || 0,
    missing: false,
  };
}
export function sameDriveVersion(a, b) {
  return a?.checksum && b?.checksum
    ? a.checksum === b.checksum
    : !!a?.modifiedTime &&
        a.modifiedTime === b?.modifiedTime &&
        a.size === b?.size;
}
async function parse(drive, file, report, signal) {
  const original = await drive.download(file, signal);
  const parsed = await importFile(
    original,
    report,
    signal,
    (await storage.getSettings()).ocrLanguage,
  );
  parsed.sourceHash = await fingerprint(original);
  parsed.contentHash = await contentFingerprint(parsed);
  return parsed;
}
export async function scanDriveLibrary({
  drive,
  ownerId,
  folder,
  report = () => {},
  signal,
  activeBook = null,
}) {
  const listing = await drive.scan(folder.id, folder.recursive, signal);
  const ignored = new Set(
    (await storage.getMeta(`drive-ignored:${ownerId}`)) || [],
  );
  let imported = 0,
    updated = 0;
  const errors = [];
  for (let i = 0; i < listing.files.length; i++) {
    if (signal?.aborted)
      throw new DOMException("Drive sync cancelled", "AbortError");
    const file = listing.files[i],
      source = driveSource(file, ownerId, folder);
    if (ignored.has(file.id)) continue;
    report(
      `Checking ${i + 1} of ${listing.files.length}: ${file.name}`,
      Math.round((i / Math.max(1, listing.files.length)) * 100),
    );
    const books = await storage.listBooks();
    const existing = books.find(
      (b) =>
        b.driveSource?.ownerId === ownerId && b.driveSource.fileId === file.id,
    );
    if (existing) {
      if (existing.id === activeBook) continue;
      const changed = !sameDriveVersion(existing.driveSource, source);
      if (
        changed ||
        existing.driveSource.missing ||
        existing.driveSource.folderId !== folder.id ||
        existing.driveSource.name !== file.name
      ) {
        await storage.patchBook(existing.id, {
          driveSource: {
            ...existing.driveSource,
            missing: false,
            folderId: folder.id,
            name: file.name,
          },
          driveUpdate: changed ? source : null,
        });
        updated += Number(changed);
      }
      continue;
    }
    try {
      const parsed = await parse(drive, file, () => {}, signal);
      const match = books
        .filter(
          (b) =>
            (!b.syncOwnerId || b.syncOwnerId === ownerId) &&
            sameBook(parsed, b),
        )
        .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))[0];
      const book = match
        ? combineCopies(parsed, match)
        : {
            ...parsed,
            id: `drive-${(await fingerprint(`${ownerId}:${file.id}`)).slice(0, 48)}`,
          };
      book.driveSource = source;
      book.syncOwnerId = ownerId;
      book.offlineAvailable =
        !!match &&
        !match.needsLocalFile &&
        (!match.driveSource || !!match.offlineAvailable);
      book.needsLocalFile = false;
      book.chapterSummaries = bookRecord({
        ...book,
        needsLocalFile: false,
      }).chapterSummaries;
      if (match?.id === activeBook) continue;
      await storage.saveBook(book);
      if (!book.offlineAvailable) storage.releaseReadingContent(book.id);
      imported++;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      if (/Reconnect|access expired|access was denied/i.test(e.message))
        throw e;
      errors.push(`${file.name}: ${e.message}`);
    }
  }
  // Only a complete listing can mark a file missing. Never delete its notes.
  const ids = new Set(listing.files.map((f) => f.id));
  for (const book of await storage.listBooks()) {
    if (
      book.id === activeBook ||
      book.driveSource?.ownerId !== ownerId ||
      book.driveSource.folderId !== folder.id
    )
      continue;
    const missing = !ids.has(book.driveSource.fileId);
    if (book.driveSource.missing !== missing)
      await storage.patchBook(book.id, {
        driveSource: { ...book.driveSource, missing },
      });
  }
  report("Drive folder checked", 100);
  return {
    imported,
    updated,
    errors,
    count: listing.files.length,
    folderName: listing.folder.name,
  };
}
export async function openDriveBook(
  book,
  { drive, ownerId, report = () => {}, signal, acceptUpdate = false },
) {
  if (book.driveSource.ownerId !== ownerId)
    throw new Error("Sign in to the Google account that connected this book.");
  if (book.driveUpdate && !acceptUpdate)
    throw new Error(
      "This Drive file changed. Open its book details and choose Use updated Drive file to review the new edition.",
    );
  if (!acceptUpdate && book.chapters.some((c) => c.blocks.some((b) => b.text)))
    return book;
  if (!navigator.onLine)
    throw new Error(
      "Connect to the internet to open this Drive book, or use an offline copy.",
    );
  const file = await drive.file(book.driveSource.fileId, signal);
  if (file.trashed)
    throw new Error(
      "This book is in Drive’s trash. Restore it in Drive to read it.",
    );
  const source = driveSource(file, ownerId, { id: book.driveSource.folderId });
  if (!acceptUpdate && !sameDriveVersion(book.driveSource, source)) {
    await storage.patchBook(book.id, { driveUpdate: source });
    throw new Error(
      "This Drive file changed. Open its details to use the updated file. Your notes and position are preserved.",
    );
  }
  const parsed = await parse(drive, file, report, signal);
  const merged = relinkLocalFile(parsed, book, { confirmed: true });
  merged.driveSource = source;
  merged.driveUpdate = null;
  merged.driveEdited = false;
  merged.needsLocalFile = false;
  merged.chapterSummaries = bookRecord({
    ...merged,
    needsLocalFile: false,
  }).chapterSummaries;
  if (book.driveCoverOverride) merged.cover = book.cover;
  if (acceptUpdate)
    merged.warnings = [
      ...(parsed.warnings || []),
      "The Drive file was updated. Review your saved position and annotations against this edition.",
    ];
  await storage.cacheBookContent(merged);
  return merged;
}
