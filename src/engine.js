export const DEFAULT_SETTINGS = {
  wpm: 250,
  punctuation: true,
  longWords: true,
  pauseStrength: 1,
  highlight: true,
  guides: true,
  theme: "cream",
  fontSize: 56,
  countdown: true,
  replay: true,
  mediaPause: true,
  chapterPause: true,
  reducedMotion: false,
  ocrLanguage: "eng",
  presentation: "word",
  phraseSize: 3,
  contextOnPause: true,
  growth: true,
  controlsCollapsed: false,
  gestures: true,
  profileId: "balanced",
};
export const PRESETS = [150, 200, 250, 300, 360, 400, 500, 600];
export const clamp = (n, min, max) =>
  Math.min(max, Math.max(min, Number(n) || min));
export function normalizeText(text) {
  return String(text)
    .replace(/\u00ad/g, "")
    .replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, "$1$2")
    .replace(/\r/g, "")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}
export function textBlocks(text) {
  return normalizeText(text)
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((text) => ({ type: "paragraph", text: text.replace(/\n/g, " ") }));
}
export function tokenize(book) {
  const words = [];
  book.chapters.forEach((chapter, ci) =>
    chapter.blocks.forEach((block, bi) => {
      if (
        !block.text ||
        block.excluded ||
        chapter.excluded ||
        block.type === "image" ||
        block.type === "table"
      )
        return;
      const list = normalizeText(block.text).match(/\S+/gu) || [];
      list.forEach((text, wi) =>
        words.push({
          text,
          chapter: ci,
          block: bi,
          chapterId: chapter.id,
          passageId: block.id,
          offset: wi,
          paragraphEnd: wi === list.length - 1,
          sentenceEnd: /[.!?…]["'”’\)\]]*$/.test(text),
        }),
      );
    }),
  );
  return words;
}
export function wordDuration(word, settings) {
  let multiplier = 1;
  if (settings.longWords)
    multiplier += Math.max(0, [...word.text].length - 8) * 0.035;
  if (settings.punctuation) {
    const strength = clamp(settings.pauseStrength, 0, 2);
    if (word.paragraphEnd) multiplier += 1.5 * strength;
    else if (word.sentenceEnd) multiplier += 0.9 * strength;
    else if (/[,;:—]["'”’]*$/.test(word.text)) multiplier += 0.35 * strength;
  }
  return (60000 / clamp(settings.wpm, 100, 800)) * multiplier;
}
export function anchorParts(text = "") {
  const chars = [...text];
  const leading = chars.findIndex((c) => /[\p{L}\p{N}]/u.test(c));
  const count = chars.filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  const pivot =
    Math.max(0, leading) +
    (count <= 1 ? 0 : count <= 5 ? 1 : count <= 9 ? 2 : count <= 13 ? 3 : 4);
  return [
    chars.slice(0, pivot).join(""),
    chars[pivot] || "",
    chars.slice(pivot + 1).join(""),
  ];
}
export function sentenceStart(words, index, previous = false) {
  let i = clamp(index, 0, words.length - 1);
  if (
    previous &&
    i > 0 &&
    (words[i - 1]?.sentenceEnd || words[i - 1]?.paragraphEnd)
  )
    i--;
  while (
    i > 0 &&
    !words[i - 1].sentenceEnd &&
    !words[i - 1].paragraphEnd &&
    words[i - 1].chapter === words[i].chapter
  )
    i--;
  return i;
}
export function nextSentence(words, index) {
  let i = index;
  while (
    i < words.length - 1 &&
    !words[i].sentenceEnd &&
    !words[i].paragraphEnd
  )
    i++;
  return Math.min(words.length - 1, i + 1);
}
export function makeBook({
  title,
  author = "Unknown author",
  chapters,
  cover = null,
  format = "TEXT",
  ...rest
}) {
  const book = {
    id: crypto.randomUUID(),
    title,
    author,
    chapters: chapters.map((c) => ({
      ...c,
      id: c.id || crypto.randomUUID(),
      blocks: c.blocks.map((b) => ({ ...b, id: b.id || crypto.randomUUID() })),
    })),
    cover,
    format,
    addedAt: Date.now(),
    lastRead: 0,
    position: 0,
    completed: false,
    bookmarks: [],
    highlights: [],
    sessions: [],
    tags: [],
    readingSettings: null,
    readingStatus: "ready",
    description: "",
    collection: "",
    secondsRead: 0,
    wordsRead: 0,
    ...rest,
  };
  book.wordCount = tokenize(book).length;
  if (!book.wordCount)
    throw new Error(
      "No readable text was found. Try a text-based EPUB or use OCR for a scanned PDF.",
    );
  return book;
}
export function validateBackup(data) {
  if (
    data?.app !== "pagegrovehq-reader" ||
    data.version !== 1 ||
    !Array.isArray(data.books) ||
    data.books.length > 500
  )
    throw new Error("This is not a supported Page Grove backup.");
  const ids = new Set();
  const safeImage = (src) =>
    typeof src === "string" &&
    /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(src);
  const books = data.books.map((b) => {
    if (
      !b ||
      typeof b.id !== "string" ||
      ids.has(b.id) ||
      typeof b.title !== "string" ||
      !Array.isArray(b.chapters) ||
      b.chapters.length > 10000
    )
      throw new Error("The backup contains an invalid book.");
    ids.add(b.id);
    const chapters = b.chapters.map((c) => {
      if (typeof c.title !== "string" || !Array.isArray(c.blocks))
        throw new Error("Invalid chapter in backup.");
      return {
        title: c.title,
        id: typeof c.id === "string" ? c.id.slice(0, 100) : crypto.randomUUID(),
        excluded: Boolean(c.excluded),
        blocks: c.blocks.map((block) => {
          if (
            !["paragraph", "heading", "image", "table"].includes(block.type) ||
            (block.text != null && typeof block.text !== "string")
          )
            throw new Error("Invalid passage in backup.");
          if (block.type === "image" && !safeImage(block.src))
            throw new Error("Invalid image in backup.");
          if (
            block.type === "table" &&
            (!Array.isArray(block.rows) ||
              !block.rows.every(
                (row) =>
                  Array.isArray(row) &&
                  row.every((cell) => typeof cell === "string"),
              ))
          )
            throw new Error("Invalid table in backup.");
          return {
            type: block.type,
            text: block.text || "",
            id:
              typeof block.id === "string"
                ? block.id.slice(0, 100)
                : crypto.randomUUID(),
            excluded: Boolean(block.excluded),
            ...(block.src
              ? { src: block.src, alt: String(block.alt || "") }
              : {}),
            ...(block.rows ? { rows: block.rows } : {}),
          };
        }),
      };
    });
    const book = makeBook({
      id: b.id,
      title: b.title.slice(0, 500),
      author: String(b.author || "Unknown author").slice(0, 500),
      chapters,
      format: String(b.format || "TEXT"),
      collection: String(b.collection || "").slice(0, 100),
      cover: safeImage(b.cover) ? b.cover : null,
      demo: Boolean(b.demo),
      coverStyle: clamp(b.coverStyle, 0, 3),
      addedAt: Number(b.addedAt) || Date.now(),
      lastRead: Number(b.lastRead) || 0,
      secondsRead: Math.max(0, Number(b.secondsRead) || 0),
      wordsRead: Math.max(0, Number(b.wordsRead) || 0),
      completed: Boolean(b.completed),
    });
    book.position = clamp(b.position, 0, book.wordCount - 1);
    book.bookmarks = Array.isArray(b.bookmarks)
      ? b.bookmarks
          .filter(
            (m) =>
              typeof m.id === "string" &&
              Number.isInteger(m.position) &&
              m.position >= 0 &&
              m.position < book.wordCount,
          )
          .map((m) => ({
            id: m.id,
            position: m.position,
            note: String(m.note || "").slice(0, 1000),
            createdAt: Number(m.createdAt) || Date.now(),
          }))
      : [];
    const safeRef = (r) =>
      r && typeof r.passageId === "string"
        ? {
            passageId: r.passageId.slice(0, 100),
            offset: clamp(r.offset, 0, 1000000),
          }
        : null;
    book.bookmarks = book.bookmarks.map((m) => {
      const old = b.bookmarks.find((x) => x.id === m.id);
      return {
        ...m,
        quote: String(old.quote || "").slice(0, 10000),
        reference: safeRef(old.reference),
        orphaned: Boolean(old.orphaned),
        updatedAt: Number(old.updatedAt) || m.createdAt,
      };
    });
    book.highlights = Array.isArray(b.highlights)
      ? b.highlights
          .filter(
            (h) => typeof h.id === "string" && typeof h.quote === "string",
          )
          .map((h) => ({
            id: h.id,
            quote: h.quote.slice(0, 10000),
            note: String(h.note || "").slice(0, 2000),
            color: ["sage", "gold", "rose"].includes(h.color)
              ? h.color
              : "sage",
            position: clamp(h.position, 0, book.wordCount - 1),
            endPosition: clamp(h.endPosition, 0, book.wordCount - 1),
            reference: safeRef(h.reference),
            endReference: safeRef(h.endReference),
            orphaned: Boolean(h.orphaned),
            createdAt: Number(h.createdAt) || Date.now(),
            updatedAt: Number(h.updatedAt) || Number(h.createdAt) || Date.now(),
          }))
      : [];
    book.sessions = Array.isArray(b.sessions)
      ? b.sessions
          .filter((s) => typeof s.id === "string")
          .slice(-10000)
          .map((s) => ({
            id: s.id,
            startedAt: Number(s.startedAt) || Date.now(),
            seconds: Math.max(0, Number(s.seconds) || 0),
            words: Math.max(0, Number(s.words) || 0),
            wpm: clamp(s.wpm, 100, 800),
            mode: ["word", "phrase", "sentence", "guided"].includes(s.mode)
              ? s.mode
              : "word",
            clarity: ["clear", "mixed", "unclear"].includes(s.clarity)
              ? s.clarity
              : null,
            startPosition: clamp(s.startPosition, 0, book.wordCount - 1),
            endPosition: clamp(s.endPosition, 0, book.wordCount - 1),
          }))
      : [];
    book.tags = Array.isArray(b.tags)
      ? b.tags
          .filter((t) => typeof t === "string")
          .map((t) => t.slice(0, 60))
          .slice(0, 20)
      : [];
    book.description = String(b.description || "").slice(0, 5000);
    book.readingStatus = ["ready", "want", "reading", "finished"].includes(
      b.readingStatus,
    )
      ? b.readingStatus
      : "ready";
    book.shelfOrder = Number(b.shelfOrder) || 0;
    book.readingSettings =
      b.readingSettings && typeof b.readingSettings === "object"
        ? cleanSettings(b.readingSettings)
        : null;
    book.sourceHash =
      typeof b.sourceHash === "string" ? b.sourceHash.slice(0, 100) : "";
    book.annotationTombstones = Array.isArray(b.annotationTombstones)
      ? b.annotationTombstones
          .filter((t) => typeof t.id === "string")
          .map((t) => ({
            id: t.id,
            deletedAt: Number(t.deletedAt) || Date.now(),
          }))
      : [];
    return book;
  });
  const raw = data.settings || {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of [
    "punctuation",
    "longWords",
    "highlight",
    "guides",
    "countdown",
    "replay",
    "mediaPause",
    "chapterPause",
    "reducedMotion",
  ])
    if (typeof raw[key] === "boolean") settings[key] = raw[key];
  settings.wpm = clamp(raw.wpm || 250, 100, 800);
  settings.fontSize = clamp(raw.fontSize || 56, 28, 80);
  settings.pauseStrength = clamp(raw.pauseStrength ?? 1, 0, 2);
  if (["cream", "sepia", "dark"].includes(raw.theme))
    settings.theme = raw.theme;
  if (["eng", "spa", "fra", "deu", "ita", "por"].includes(raw.ocrLanguage))
    settings.ocrLanguage = raw.ocrLanguage;
  return {
    books,
    settings: cleanSettings(raw),
    shelves: Array.isArray(data.shelves)
      ? data.shelves
          .filter((s) => typeof s === "string")
          .map((s) => s.slice(0, 100))
          .slice(0, 100)
      : [],
    profiles: Array.isArray(data.profiles)
      ? data.profiles
          .filter((p) => typeof p.id === "string" && typeof p.name === "string")
          .map((p) => ({
            id: p.id,
            name: p.name.slice(0, 80),
            settings: cleanSettings(p.settings),
          }))
      : null,
    vocabulary: Array.isArray(data.vocabulary)
      ? data.vocabulary
          .filter((v) => typeof v.id === "string" && typeof v.word === "string")
          .map((v) => ({
            id: v.id,
            word: v.word.slice(0, 100),
            definition: String(v.definition || "").slice(0, 2000),
            bookTitle: String(v.bookTitle || "").slice(0, 500),
            createdAt: Number(v.createdAt) || Date.now(),
            nextReview: Number(v.nextReview) || Date.now(),
            level: clamp(v.level, 0, 6),
          }))
      : [],
  };
}
export function cleanSettings(raw = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS))
    if (typeof value === "boolean" && typeof raw[key] === "boolean")
      out[key] = raw[key];
  out.wpm = clamp(raw.wpm || 250, 100, 800);
  out.fontSize = clamp(raw.fontSize || 56, 28, 80);
  out.pauseStrength = clamp(raw.pauseStrength ?? 1, 0, 2);
  out.phraseSize = clamp(raw.phraseSize || 3, 2, 6);
  if (["cream", "sepia", "dark"].includes(raw.theme)) out.theme = raw.theme;
  if (["word", "phrase", "sentence", "guided"].includes(raw.presentation))
    out.presentation = raw.presentation;
  if (["eng", "spa", "fra", "deu", "ita", "por"].includes(raw.ocrLanguage))
    out.ocrLanguage = raw.ocrLanguage;
  out.profileId = String(raw.profileId || "balanced").slice(0, 100);
  return out;
}
