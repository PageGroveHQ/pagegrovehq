export const DEFAULT_SETTINGS = { wpm: 250, punctuation: true, longWords: true, pauseStrength: 1, highlight: true, guides: true, theme: 'cream', fontSize: 56, countdown: true, replay: true, mediaPause: true, chapterPause: true, reducedMotion: false, ocrLanguage: 'eng' };
export const PRESETS = [150, 200, 250, 300, 360, 400, 500, 600];
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || min));
export function normalizeText(text) { return String(text).replace(/\u00ad/g, '').replace(/([\p{L}])-\s*\n\s*([\p{Ll}])/gu, '$1$2').replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').trim(); }
export function textBlocks(text) { return normalizeText(text).split(/\n\s*\n/).filter(Boolean).map(text => ({ type: 'paragraph', text: text.replace(/\n/g, ' ') })); }
export function tokenize(book) {
  const words = [];
  book.chapters.forEach((chapter, ci) => chapter.blocks.forEach((block, bi) => {
    if (!block.text || block.type === 'image' || block.type === 'table') return;
    const list = normalizeText(block.text).match(/\S+/gu) || [];
    list.forEach((text, wi) => words.push({ text, chapter: ci, block: bi, offset: wi, paragraphEnd: wi === list.length - 1, sentenceEnd: /[.!?…]["'”’\)\]]*$/.test(text) }));
  }));
  return words;
}
export function wordDuration(word, settings) {
  let multiplier = 1;
  if (settings.longWords) multiplier += Math.max(0, [...word.text].length - 8) * .035;
  if (settings.punctuation) {
    const strength = clamp(settings.pauseStrength, 0, 2);
    if (word.paragraphEnd) multiplier += 1.5 * strength;
    else if (word.sentenceEnd) multiplier += .9 * strength;
    else if (/[,;:—]["'”’]*$/.test(word.text)) multiplier += .35 * strength;
  }
  return (60000 / clamp(settings.wpm, 100, 800)) * multiplier;
}
export function anchorParts(text = '') {
  const chars = [...text];
  const leading = chars.findIndex(c => /[\p{L}\p{N}]/u.test(c));
  const count = chars.filter(c => /[\p{L}\p{N}]/u.test(c)).length;
  const pivot = Math.max(0, leading) + (count <= 1 ? 0 : count <= 5 ? 1 : count <= 9 ? 2 : count <= 13 ? 3 : 4);
  return [chars.slice(0, pivot).join(''), chars[pivot] || '', chars.slice(pivot + 1).join('')];
}
export function sentenceStart(words, index, previous = false) {
  let i = clamp(index, 0, words.length - 1);
  if (previous && i > 0 && (words[i - 1]?.sentenceEnd || words[i - 1]?.paragraphEnd)) i--;
  while (i > 0 && !words[i - 1].sentenceEnd && !words[i - 1].paragraphEnd && words[i - 1].chapter === words[i].chapter) i--;
  return i;
}
export function nextSentence(words, index) { let i = index; while (i < words.length - 1 && !words[i].sentenceEnd && !words[i].paragraphEnd) i++; return Math.min(words.length - 1, i + 1); }
export function makeBook({ title, author = 'Unknown author', chapters, cover = null, format = 'TEXT', ...rest }) {
  const book = { id: crypto.randomUUID(), title, author, chapters, cover, format, addedAt: Date.now(), lastRead: 0, position: 0, completed: false, bookmarks: [], collection: '', secondsRead: 0, wordsRead: 0, ...rest };
  book.wordCount = tokenize(book).length;
  if (!book.wordCount) throw new Error('No readable text was found. Try a text-based EPUB or use OCR for a scanned PDF.');
  return book;
}
export function validateBackup(data) {
  if (data?.app !== 'pagegrovehq-reader' || data.version !== 1 || !Array.isArray(data.books) || data.books.length > 500) throw new Error('This is not a supported Page Grove backup.');
  const ids = new Set();
  const safeImage = src => typeof src === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(src);
  const books = data.books.map(b => {
    if (!b || typeof b.id !== 'string' || ids.has(b.id) || typeof b.title !== 'string' || !Array.isArray(b.chapters) || b.chapters.length > 10000) throw new Error('The backup contains an invalid book.');
    ids.add(b.id);
    const chapters = b.chapters.map(c => {
      if (typeof c.title !== 'string' || !Array.isArray(c.blocks)) throw new Error('Invalid chapter in backup.');
      return { title: c.title, blocks: c.blocks.map(block => {
        if (!['paragraph', 'heading', 'image', 'table'].includes(block.type) || (block.text != null && typeof block.text !== 'string')) throw new Error('Invalid passage in backup.');
        if (block.type === 'image' && !safeImage(block.src)) throw new Error('Invalid image in backup.');
        if (block.type === 'table' && (!Array.isArray(block.rows) || !block.rows.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string')))) throw new Error('Invalid table in backup.');
        return { type: block.type, text: block.text || '', ...(block.src ? { src: block.src, alt: String(block.alt || '') } : {}), ...(block.rows ? { rows: block.rows } : {}) };
      }) };
    });
    const book = makeBook({ id: b.id, title: b.title.slice(0, 500), author: String(b.author || 'Unknown author').slice(0, 500), chapters, format: String(b.format || 'TEXT'), collection: String(b.collection || '').slice(0, 100), cover: safeImage(b.cover) ? b.cover : null, demo: Boolean(b.demo), coverStyle: clamp(b.coverStyle, 0, 3), addedAt: Number(b.addedAt) || Date.now(), lastRead: Number(b.lastRead) || 0, secondsRead: Math.max(0, Number(b.secondsRead) || 0), wordsRead: Math.max(0, Number(b.wordsRead) || 0), completed: Boolean(b.completed) });
    book.position = clamp(b.position, 0, book.wordCount - 1);
    book.bookmarks = Array.isArray(b.bookmarks) ? b.bookmarks.filter(m => typeof m.id === 'string' && Number.isInteger(m.position) && m.position >= 0 && m.position < book.wordCount).map(m => ({ id: m.id, position: m.position, note: String(m.note || '').slice(0, 1000), createdAt: Number(m.createdAt) || Date.now() })) : [];
    return book;
  });
  const raw = data.settings || {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of ['punctuation', 'longWords', 'highlight', 'guides', 'countdown', 'replay', 'mediaPause', 'chapterPause', 'reducedMotion']) if (typeof raw[key] === 'boolean') settings[key] = raw[key];
  settings.wpm = clamp(raw.wpm || 250, 100, 800); settings.fontSize = clamp(raw.fontSize || 56, 28, 80); settings.pauseStrength = clamp(raw.pauseStrength ?? 1, 0, 2);
  if (['cream', 'sepia', 'dark'].includes(raw.theme)) settings.theme = raw.theme;
  if (['eng', 'spa', 'fra', 'deu', 'ita', 'por'].includes(raw.ocrLanguage)) settings.ocrLanguage = raw.ocrLanguage;
  return { books, settings };
}
