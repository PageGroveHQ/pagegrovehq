import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  anchorParts,
  makeBook,
  normalizeText,
  sentenceStart,
  nextSentence,
  tokenize,
  validateBackup,
  wordDuration,
} from "./engine";
import { htmlBlocks, linesFromPDF } from "./importers";
const fixture = () =>
  makeBook({
    title: "Fixture",
    chapters: [
      {
        title: "One",
        blocks: [
          {
            type: "paragraph",
            text: "First sentence. Another longer sentence!",
          },
          {
            type: "image",
            src: "data:image/png;base64,AAAA",
            alt: "Illustration",
          },
          { type: "paragraph", text: "New paragraph starts here." },
          { type: "table", text: "Skipped table", rows: [["One", "Two"]] },
        ],
      },
      { title: "Two", blocks: [{ type: "paragraph", text: "Next chapter." }] },
    ],
  });
describe("reading model", () => {
  it("preserves source positions and excludes illustrations/tables from the word stream", () => {
    const words = tokenize(fixture());
    expect(words).toHaveLength(11);
    expect(words[5]).toMatchObject({
      text: "New",
      chapter: 0,
      block: 2,
      offset: 0,
    });
    expect(words[9]).toMatchObject({ chapter: 1, block: 0 });
  });
  it("rewinds by sentences without jumping across paragraph boundaries", () => {
    const words = tokenize(fixture());
    expect(sentenceStart(words, 4)).toBe(2);
    expect(sentenceStart(words, 2, true)).toBe(0);
    expect(sentenceStart(words, 5)).toBe(5);
    expect(nextSentence(words, 0)).toBe(2);
    expect(nextSentence(words, 8)).toBe(9);
  });
  it("applies punctuation and long-word timing while preserving exact base WPM", () => {
    expect(
      wordDuration({ text: "read" }, { ...DEFAULT_SETTINGS, wpm: 300 }),
    ).toBe(200);
    expect(
      wordDuration(
        { text: "done.", sentenceEnd: true },
        { ...DEFAULT_SETTINGS, wpm: 300 },
      ),
    ).toBe(380);
    expect(
      wordDuration(
        { text: "done.", paragraphEnd: true },
        { ...DEFAULT_SETTINGS, wpm: 300 },
      ),
    ).toBe(500);
    expect(
      wordDuration({ text: "extraordinarily" }, DEFAULT_SETTINGS),
    ).toBeGreaterThan(240);
  });
  it("highlights a Unicode character and preserves every character", () => {
    for (const word of [
      "idea",
      "I",
      "“wonderful!”",
      "café",
      "🌳tree",
      "你好",
    ]) {
      const parts = anchorParts(word);
      expect(parts.join("")).toBe(word);
      expect([...parts[1]]).toHaveLength(1);
    }
    expect(anchorParts("idea")[1]).toBe("d");
  });
  it("joins line-break hyphens without deleting compound word hyphens", () => {
    expect(normalizeText("un-\n hurried well-known\n words")).toBe(
      "unhurried well-known\n words",
    );
  });
});
describe("backups", () => {
  it("restores positions, bookmarks, media, and exact settings", () => {
    const b = fixture();
    b.position = 5;
    b.bookmarks = [{ id: "mark", position: 5, note: "Remember", createdAt: 1 }];
    const result = validateBackup({
      app: "pagegrovehq-reader",
      version: 1,
      books: [b],
      settings: { ...DEFAULT_SETTINGS, wpm: 367 },
    });
    expect(result.books[0].position).toBe(5);
    expect(result.books[0].bookmarks[0].note).toBe("Remember");
    expect(result.settings.wpm).toBe(367);
  });
  it("rejects remote executable media and duplicate IDs before any writes", () => {
    const b = fixture();
    b.chapters[0].blocks[1].src = "https://example.com/tracker.svg";
    expect(() =>
      validateBackup({ app: "pagegrovehq-reader", version: 1, books: [b] }),
    ).toThrow("Invalid image");
    const c = fixture();
    expect(() =>
      validateBackup({ app: "pagegrovehq-reader", version: 1, books: [c, c] }),
    ).toThrow("invalid book");
  });
});
describe("extraction", () => {
  it("removes scripts and navigation while preserving paragraphs and tables", async () => {
    const doc = new DOMParser().parseFromString(
      "<nav>Skip me</nav><h1>Chapter</h1><p>A <em>good</em> book.<script>bad()</script></p><table><tr><td>Keep</td><td>this</td></tr></table>",
      "text/html",
    );
    const blocks = await htmlBlocks(doc);
    expect(blocks.map((b) => b.text)).toEqual([
      "Chapter",
      "A good book.",
      "Keep | this",
    ]);
    expect(blocks[2].rows).toEqual([["Keep", "this"]]);
  });
  it("orders a simple two-column PDF vertically before moving to the next column", () => {
    const items = Array.from({ length: 8 }, (_, i) => [
      {
        str: "Left " + i,
        transform: [12, 0, 0, 12, 30, 700 - i * 20],
        width: 120,
      },
      {
        str: "Right " + i,
        transform: [12, 0, 0, 12, 330, 700 - i * 20],
        width: 120,
      },
    ]).flat();
    const result = linesFromPDF(items, 600);
    expect(result.columns).toBe(true);
    expect(result.lines.map((l) => l.text)).toEqual([
      ...Array.from({ length: 8 }, (_, i) => "Left " + i),
      ...Array.from({ length: 8 }, (_, i) => "Right " + i),
    ]);
  });
});
