import { DEFAULT_SETTINGS, clamp, tokenize, sentenceStart } from "./engine";
export const BUILTIN_PROFILES = [
  {
    id: "balanced",
    name: "Balanced",
    description: "A comfortable place to begin.",
    settings: { ...DEFAULT_SETTINGS },
  },
  {
    id: "evening",
    name: "Evening fiction",
    description: "Unhurried stories in warm parchment.",
    settings: {
      ...DEFAULT_SETTINGS,
      wpm: 300,
      theme: "sepia",
      pauseStrength: 1.25,
    },
  },
  {
    id: "study",
    name: "Study & reflect",
    description: "More breathing room and sentence context.",
    settings: {
      ...DEFAULT_SETTINGS,
      wpm: 200,
      pauseStrength: 1.75,
      presentation: "phrase",
      phraseSize: 3,
    },
  },
  {
    id: "articles",
    name: "Quick articles",
    description: "A brisk pace for familiar material.",
    settings: { ...DEFAULT_SETTINGS, wpm: 360, pauseStrength: 0.75 },
  },
];
export function upgradeBook(book) {
  book.chapters.forEach((c) => {
    c.id ||= crypto.randomUUID();
    c.blocks.forEach((b) => {
      b.id ||= crypto.randomUUID();
    });
  });
  book.highlights ||= [];
  book.sessions ||= [];
  book.tags ||= [];
  book.annotationTombstones ||= [];
  book.readingStatus ||= book.completed
    ? "finished"
    : book.lastRead
      ? "reading"
      : "ready";
  book.description ||= "";
  book.shelfOrder ||= book.addedAt;
  book.bookmarks = (book.bookmarks || []).map((m) => ({
    ...m,
    reference: m.reference || referenceAt(tokenize(book), m.position),
  }));
  return book;
}
export function referenceAt(words, index) {
  const w = words[clamp(index, 0, words.length - 1)];
  return w ? { passageId: w.passageId, offset: w.offset } : null;
}
export function locateReference(words, reference, fallback = 0) {
  if (!reference) return clamp(fallback, 0, words.length - 1);
  const matches = words
    .map((w, i) => ({ w, i }))
    .filter((x) => x.w.passageId === reference.passageId);
  if (!matches.length) return null;
  return matches.reduce((best, x) =>
    Math.abs(x.w.offset - reference.offset) <
    Math.abs(best.w.offset - reference.offset)
      ? x
      : best,
  ).i;
}
export function repairBook(original, chapters) {
  const before = tokenize(original);
  const book = { ...original, chapters };
  const after = tokenize(book);
  if (!after.length) throw new Error("Keep at least one readable passage.");
  const relocate = (mark) => {
    const reference = mark.reference || referenceAt(before, mark.position);
    const index = locateReference(after, reference, mark.position);
    const end = locateReference(
      after,
      mark.endReference,
      mark.endPosition ?? index ?? mark.position,
    );
    return {
      ...mark,
      reference,
      position: index ?? clamp(mark.position, 0, after.length - 1),
      endPosition: end ?? index ?? clamp(mark.position, 0, after.length - 1),
      orphaned: index == null,
    };
  };
  return {
    ...book,
    wordCount: after.length,
    position:
      locateReference(
        after,
        referenceAt(before, original.position),
        original.position,
      ) ?? clamp(original.position, 0, after.length - 1),
    bookmarks: original.bookmarks.map(relocate),
    highlights: (original.highlights || []).map(relocate),
    contentUpdatedAt: Date.now(),
    cloudContentDirty: !!book.cloudContentPath,
    completed: false,
  };
}
export function presentationUnit(words, index, settings) {
  const start = clamp(index, 0, words.length - 1);
  let end = start;
  const max =
    settings.presentation === "phrase"
      ? clamp(settings.phraseSize, 2, 6)
      : settings.presentation === "sentence"
        ? 80
        : 1;
  while (
    end < words.length - 1 &&
    end - start + 1 < max &&
    !words[end].sentenceEnd &&
    !words[end].paragraphEnd &&
    words[end + 1].chapter === words[start].chapter &&
    words[end + 1].block === words[start].block
  )
    end++;
  const list = words.slice(start, end + 1);
  return { start, end, words: list, text: list.map((w) => w.text).join(" ") };
}
export function currentSentence(words, index) {
  const start = sentenceStart(words, index);
  let end = start;
  while (
    end < words.length - 1 &&
    !words[end].sentenceEnd &&
    !words[end].paragraphEnd &&
    words[end + 1].chapter === words[start].chapter
  )
    end++;
  return words
    .slice(start, end + 1)
    .map((w) => w.text)
    .join(" ");
}
export function notebookEntries(books) {
  return books
    .flatMap((book) =>
      [
        ...book.bookmarks.map((m) => ({ ...m, kind: "bookmark" })),
        ...(book.highlights || []).map((h) => ({ ...h, kind: "highlight" })),
      ].map((mark) => ({
        book,
        mark,
        quote: mark.quote || currentSentence(tokenize(book), mark.position),
      })),
    )
    .sort((a, b) => b.mark.createdAt - a.mark.createdAt);
}
export function notebookMarkdown(books) {
  const entries = notebookEntries(books);
  return (
    `# My Page Grove notebook\n\nExported ${new Date().toISOString().slice(0, 10)}\n\n` +
    entries
      .map(
        ({ book, mark, quote }) =>
          `## ${book.title.replace(/\n/g, " ")}\n\n${book.author}\n\n> ${quote.replace(/\n/g, "\n> ")}\n\n${mark.note || ""}\n\n*${mark.kind} · ${new Date(mark.createdAt).toLocaleDateString()}${mark.orphaned ? " · original passage was excluded" : ""}*\n`,
      )
      .join("\n---\n\n")
  );
}
export async function fingerprint(file) {
  const bytes =
    typeof file === "string"
      ? new TextEncoder().encode(file)
      : await file.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
export function readingInsights(books) {
  const sessions = books
    .flatMap((b) =>
      (b.sessions || []).map((s) => ({ ...s, bookId: b.id, title: b.title })),
    )
    .sort((a, b) => b.startedAt - a.startedAt);
  const totalSeconds = books.reduce((sum, b) => sum + (b.secondsRead || 0), 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 13 + i);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    return {
      date: date.toISOString(),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      minutes:
        sessions
          .filter((s) => s.startedAt >= +date && s.startedAt < +end)
          .reduce((sum, s) => sum + s.seconds, 0) / 60,
    };
  });
  return {
    sessions,
    totalSeconds,
    days,
    finished: books.filter((b) => b.completed).length,
    annotations: notebookEntries(books).length,
  };
}
export function growStage(seconds) {
  return Math.min(5, Math.floor(seconds / 1800));
}
