import { describe, it, expect } from "vitest";
import {
  makeBook,
  tokenize,
  validateBackup,
  DEFAULT_SETTINGS,
  wordDuration,
} from "./engine";
import {
  referenceAt,
  repairBook,
  presentationUnit,
  notebookMarkdown,
  readingInsights,
} from "./enhancements";
import { mergeDocuments } from "./sync-merge";
const fixture = () =>
  makeBook({
    title: "A steady story",
    chapters: [
      {
        title: "One",
        blocks: [
          {
            type: "paragraph",
            text: "One quiet sentence. A second sentence follows.",
          },
          { type: "paragraph", text: "Another paragraph keeps its place." },
        ],
      },
    ],
  });
describe("stable passages and repair", () => {
  it("keeps bookmarks attached when paragraphs move", () => {
    const b = fixture(),
      words = tokenize(b);
    b.bookmarks = [
      {
        id: "m",
        position: 7,
        reference: referenceAt(words, 7),
        quote: "Another paragraph",
        note: "Keep this",
        createdAt: 1,
      },
    ];
    const chapters = structuredClone(b.chapters);
    chapters[0].blocks.reverse();
    const repaired = repairBook(b, chapters);
    expect(tokenize(repaired)[repaired.bookmarks[0].position].text).toBe(
      "Another",
    );
    expect(repaired.bookmarks[0].note).toBe("Keep this");
    expect(repaired.bookmarks[0].orphaned).toBe(false);
  });
  it("preserves quotations when a passage is excluded", () => {
    const b = fixture();
    b.bookmarks = [
      {
        id: "m",
        position: 0,
        reference: referenceAt(tokenize(b), 0),
        quote: "One quiet sentence.",
        createdAt: 1,
      },
    ];
    const chapters = structuredClone(b.chapters);
    chapters[0].blocks[0].excluded = true;
    const repaired = repairBook(b, chapters);
    expect(repaired.bookmarks[0].orphaned).toBe(true);
    expect(repaired.bookmarks[0].quote).toBe("One quiet sentence.");
    expect(() =>
      repairBook(
        b,
        chapters.map((c) => ({ ...c, excluded: true })),
      ),
    ).toThrow("Keep at least");
  });
  it("backs up stable IDs, exclusions, highlights, profiles, vocabulary and sessions", () => {
    const b = fixture();
    b.chapters[0].blocks[1].excluded = true;
    b.highlights = [
      {
        id: "h",
        position: 0,
        endPosition: 2,
        quote: "One quiet sentence.",
        reference: referenceAt(tokenize(b), 0),
        color: "gold",
        createdAt: 1,
      },
    ];
    b.sessions = [
      { id: "s", seconds: 12, words: 8, wpm: 250, mode: "word", startedAt: 1 },
    ];
    const result = validateBackup({
      app: "pagegrovehq-reader",
      version: 1,
      books: [b],
      settings: { ...DEFAULT_SETTINGS, presentation: "phrase", growth: false },
      profiles: [
        {
          id: "p",
          name: "My study",
          settings: { ...DEFAULT_SETTINGS, wpm: 213 },
        },
      ],
      vocabulary: [
        { id: "v", word: "grove", definition: "A small group of trees" },
      ],
    });
    expect(result.books[0].chapters[0].blocks[0].id).toBe(
      b.chapters[0].blocks[0].id,
    );
    expect(result.books[0].chapters[0].blocks[1].excluded).toBe(true);
    expect(result.books[0].highlights[0].reference.passageId).toBe(
      b.chapters[0].blocks[0].id,
    );
    expect(result.settings.presentation).toBe("phrase");
    expect(result.settings.growth).toBe(false);
    expect(result.profiles[0].settings.wpm).toBe(213);
    expect(result.vocabulary[0].word).toBe("grove");
  });
});
describe("presentation timing", () => {
  it("stops phrases at punctuation and never crosses a paragraph", () => {
    const w = tokenize(fixture());
    expect(
      presentationUnit(w, 0, { presentation: "phrase", phraseSize: 6 }).text,
    ).toBe("One quiet sentence.");
    expect(
      presentationUnit(w, 3, { presentation: "phrase", phraseSize: 3 }).text,
    ).toBe("A second sentence");
    expect(
      presentationUnit(w, 6, { presentation: "phrase", phraseSize: 6 }).text,
    ).toBe("follows.");
  });
  it("shows complete sentences with timing proportional to words shown", () => {
    const w = tokenize(fixture()),
      unit = presentationUnit(w, 3, { presentation: "sentence" });
    expect(unit.text).toBe("A second sentence follows.");
    expect(
      unit.words.reduce(
        (s, x) =>
          s +
          wordDuration(x, {
            ...DEFAULT_SETTINGS,
            wpm: 300,
            punctuation: false,
          }),
        0,
      ),
    ).toBe(800);
  });
  it("exports quotations and notes and totals fractional session time", () => {
    const b = fixture();
    b.bookmarks = [
      { id: "m", position: 0, note: "Remember the quiet", createdAt: 1 },
    ];
    b.secondsRead = 12.4;
    b.sessions = [
      { id: "s", seconds: 12.4, startedAt: Date.now(), words: 8, wpm: 250 },
    ];
    expect(notebookMarkdown([b])).toContain("Remember the quiet");
    expect(readingInsights([b]).totalSeconds).toBe(12.4);
  });
});
describe("cross-device conflict semantics", () => {
  it("requires a choice when one device rereads and another reads further", () => {
    const base = { position: 100 },
      local = { position: 20 },
      remote = { position: 200 };
    const result = mergeDocuments(base, local, remote);
    expect(result.conflicts).toContain("position");
    expect(result.value.position).toBe(20);
  });
  it("merges independent notes and preserves explicit deletion", () => {
    const base = {
      bookmarks: [{ id: "a", note: "old" }],
      highlights: [],
      sessions: [],
      annotationTombstones: [],
    };
    const local = {
      ...base,
      bookmarks: [
        { id: "a", note: "edited" },
        { id: "b", note: "local" },
      ],
      annotationTombstones: [{ id: "c", deletedAt: 1 }],
    };
    const remote = {
      ...base,
      bookmarks: [...base.bookmarks, { id: "c", note: "remote" }],
    };
    const result = mergeDocuments(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.value.bookmarks.map((x) => x.id)).toEqual(["a", "b"]);
    expect(result.value.bookmarks[0].note).toBe("edited");
  });
  it("flags concurrent edits to the same note and retains both sessions", () => {
    const base = { bookmarks: [{ id: "a", note: "old" }], sessions: [] },
      local = {
        ...base,
        bookmarks: [{ id: "a", note: "local" }],
        sessions: [{ id: "s1", seconds: 5 }],
      },
      remote = {
        ...base,
        bookmarks: [{ id: "a", note: "remote" }],
        sessions: [{ id: "s2", seconds: 7 }],
      };
    const result = mergeDocuments(base, local, remote);
    expect(result.conflicts).toContain("bookmarks:a");
    expect(result.value.sessions).toHaveLength(2);
    expect(result.value.secondsRead).toBe(12);
  });
});
