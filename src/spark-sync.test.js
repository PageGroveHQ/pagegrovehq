import { describe, it, expect } from "vitest";
import { makeBook } from "./engine";
import {
  bookRecord,
  relinkLocalFile,
  sameBook,
  reconnectCandidates,
  combineCopies,
} from "./spark-sync";
import { sampleBooks } from "./samples";
describe("Firebase Spark respects local book storage", () => {
  it("uses stable sample IDs across devices, prioritizes fileless records, and never matches regular books by title alone", () => {
    expect(sampleBooks().map((b) => b.id)).toEqual(
      sampleBooks().map((b) => b.id),
    );
    const local = { id: "local", sourceHash: "file", title: "Same title" },
      remote = { id: "remote", sourceHash: "file", needsLocalFile: true };
    expect(reconnectCandidates(local, [local, remote])[0].id).toBe("remote");
    expect(sameBook(local, { title: "Same title" })).toBe(false);
    expect(sameBook(local, { ...remote, separateCopy: true })).toBe(false);
  });
  it("lets a reader explicitly reconnect a legacy record with no fingerprint or block map", () => {
    const imported = makeBook({
      title: "Legacy novel",
      chapters: [
        {
          title: "One",
          blocks: [{ type: "paragraph", text: "One two three four." }],
        },
      ],
    });
    imported.sourceHash = "file";
    const record = {
      ...imported,
      id: "old-cloud",
      sourceHash: "",
      needsLocalFile: true,
      chapters: [{ id: "old-chapter", title: "One", blocks: [] }],
      chapterSummaries: [{ id: "old-chapter", title: "One" }],
      position: 2,
    };
    expect(() => relinkLocalFile(imported, record)).toThrow();
    const merged = combineCopies(imported, record, { confirmed: true });
    expect(merged.id).toBe("old-cloud");
    expect(merged.position).toBe(2);
    expect(merged.sourceHash).toBe("file");
    expect(merged.chapters[0].blocks[0].text).toBe("One two three four.");
  });
  it("syncs metadata and deliberate saved excerpts without book text or images", () => {
    const book = makeBook({
      title: "Private book",
      chapters: [
        {
          title: "One",
          blocks: [
            { type: "paragraph", text: "FULL_PRIVATE_BOOK_TEXT" },
            { type: "image", src: "data:image/png;base64,PRIVATE_IMAGE" },
          ],
        },
      ],
    });
    book.cover = "PRIVATE_COVER";
    book.highlights = [
      { id: "note", quote: "Saved excerpt", note: "My thought" },
    ];
    const record = bookRecord(book),
      json = JSON.stringify(record);
    expect(json).not.toContain("FULL_PRIVATE_BOOK_TEXT");
    expect(json).not.toContain("PRIVATE_IMAGE");
    expect(json).not.toContain("PRIVATE_COVER");
    expect(record.highlights[0].quote).toBe("Saved excerpt");
    expect(record.localOnly).toBe(true);
  });
  it("reconnects the same file to its synced position and stable annotation IDs", () => {
    const original = makeBook({
      title: "Book",
      chapters: [
        {
          title: "One",
          blocks: [{ type: "paragraph", text: "One two three four." }],
        },
      ],
    });
    original.sourceHash = "same-hash";
    original.position = 2;
    original.highlights = [
      {
        id: "h",
        reference: { passageId: original.chapters[0].blocks[0].id, offset: 1 },
      },
    ];
    const record = { ...bookRecord(original), needsLocalFile: true };
    const imported = makeBook({
      title: "Book",
      chapters: [
        {
          title: "One",
          blocks: [{ type: "paragraph", text: "One two three four." }],
        },
      ],
    });
    imported.sourceHash = "same-hash";
    const linked = relinkLocalFile(imported, record);
    expect(linked.id).toBe(original.id);
    expect(linked.position).toBe(2);
    expect(linked.chapters[0].blocks[0].id).toBe(
      original.chapters[0].blocks[0].id,
    );
    expect(linked.needsLocalFile).toBe(false);
    expect(() =>
      relinkLocalFile({ ...imported, sourceHash: "other" }, record),
    ).toThrow(/same original file/);
  });
});
