import { describe, it, expect } from "vitest";
import { makeBook } from "./engine";
import { bookRecord, relinkLocalFile } from "./spark-sync";
describe("Firebase Spark respects local book storage", () => {
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
