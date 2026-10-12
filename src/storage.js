import { openDB } from 'idb';
import { DEFAULT_SETTINGS } from './engine';
const database = openDB('pagegrovehq-rsvp-library-v1', 1, { upgrade(db) { db.createObjectStore('books', { keyPath: 'id' }); db.createObjectStore('originals'); db.createObjectStore('meta'); } });
export const listBooks = async () => (await database).getAll('books');
export const saveBook = async book => (await database).put('books', book);
export const getOriginal = async id => (await database).get('originals', id);
export async function addBook(book, original) { const db = await database; const tx = db.transaction(['books', 'originals'], 'readwrite'); await tx.objectStore('books').put(book); if (original) await tx.objectStore('originals').put(original, book.id); await tx.done; }
export async function deleteBook(id) { const tx = (await database).transaction(['books', 'originals'], 'readwrite'); await tx.objectStore('books').delete(id); await tx.objectStore('originals').delete(id); await tx.done; }
export async function patchBook(id, patch) { const tx = (await database).transaction('books', 'readwrite'); const book = await tx.store.get(id); if (book) { Object.assign(book, patch); await tx.store.put(book); } await tx.done; return book; }
export const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...await (await database).get('meta', 'settings') });
export const saveSettings = async settings => (await database).put('meta', settings, 'settings');
export const getMeta = async key => (await database).get('meta', key);
export const setMeta = async (key, value) => (await database).put('meta', value, key);
export async function restoreLibrary(books, settings, replace = false) { const tx = (await database).transaction(['books', 'meta', 'originals'], 'readwrite'); if (replace) { await tx.objectStore('books').clear(); await tx.objectStore('originals').clear(); } for (const b of books) { await tx.objectStore('books').put(b); await tx.objectStore('originals').delete(b.id); } await tx.objectStore('meta').put(settings, 'settings'); await tx.done; }
