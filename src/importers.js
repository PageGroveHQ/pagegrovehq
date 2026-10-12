import JSZip from 'jszip';
import { makeBook, normalizeText, textBlocks } from './engine';
const MAX_FILE = 100 * 1024 * 1024;
const MAX_UNPACKED = 180 * 1024 * 1024;
function check(signal) { if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError'); }
function parseXML(text) { const doc = new DOMParser().parseFromString(text, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('This ebook has malformed XML and could not be read.'); return doc; }
function nodes(doc, name) { return [...doc.getElementsByTagNameNS('*', name)]; }
function first(doc, name) { return nodes(doc, name)[0]?.textContent?.trim(); }
function resolvePath(base, href) { let decoded; try { decoded = decodeURIComponent(href.split('#')[0].split('?')[0]); } catch { decoded = href.split('#')[0]; } if (/^(https?:|data:|javascript:)/i.test(decoded)) return ''; const parts = (base.slice(0, base.lastIndexOf('/') + 1) + decoded).split('/'); const result = []; for (const part of parts) { if (part === '..') result.pop(); else if (part && part !== '.') result.push(part); } return result.join('/'); }
function blobURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }
async function rasterImage(data, type) {
  if (!/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(type)) return null;
  const blob = new Blob([data], { type });
  if (type === 'image/svg+xml') {
    const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
    svg.querySelectorAll('script,foreignObject,image,use').forEach(n => n.remove());
    svg.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || /url\(|https?:|javascript:/i.test(a.value)) n.removeAttribute(a.name); }));
    const safe = new Blob([new XMLSerializer().serializeToString(svg)], { type });
    return rasterBlob(safe);
  }
  return rasterBlob(blob);
}
async function rasterBlob(blob) {
  const url = URL.createObjectURL(blob);
  try { const img = new Image(); img.src = url; await img.decode(); const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale)); canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/webp', .82); } catch { return null; } finally { URL.revokeObjectURL(url); }
}
export async function htmlBlocks(doc, imageResolver = async () => null) {
  const blocks = [];
  const root = doc.body || doc.documentElement;
  async function walk(node) {
    if (node.nodeType === 3) { const text = normalizeText(node.textContent); if (text) blocks.push({ type: 'paragraph', text }); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (['script', 'style', 'nav', 'head', 'noscript', 'iframe', 'object'].includes(tag) || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return;
    if (tag === 'img' || tag === 'image') { const href = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('xlink:href'); const src = href ? await imageResolver(href) : null; if (src) blocks.push({ type: 'image', src, alt: node.getAttribute('alt') || 'Book illustration', text: '' }); else blocks.push({ type: 'paragraph', text: `[Illustration${node.getAttribute('alt') ? ': ' + node.getAttribute('alt') : ' unavailable'}]` }); return; }
    if (tag === 'table') { const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => normalizeText(cell.textContent))); if (rows.length) blocks.push({ type: 'table', rows, text: rows.map(r => r.join(' | ')).join('\n') }); return; }
    if (/^(p|h[1-6]|li|blockquote|pre|figcaption)$/.test(tag) && !node.querySelector('img,image,table')) { const clone = node.cloneNode(true); clone.querySelectorAll('script,style').forEach(n => n.remove()); clone.querySelectorAll('br').forEach(n => n.replaceWith('\n')); const text = normalizeText(clone.textContent).replace(/\n/g, ' '); if (text) blocks.push({ type: /^h[1-6]$/.test(tag) ? 'heading' : 'paragraph', text }); return; }
    for (const child of node.childNodes) await walk(child);
  }
  for (const child of root.childNodes) await walk(child);
  return blocks;
}
async function importEpub(file, report, signal) {
  report('Opening EPUB…', 5); const zip = await JSZip.loadAsync(file); check(signal);
  let total = 0; for (const entry of Object.values(zip.files)) { total += entry._data?.uncompressedSize || 0; if (total > MAX_UNPACKED) throw new Error('This EPUB expands beyond the 180 MB safety limit. Try a smaller edition.'); }
  const container = zip.file('META-INF/container.xml'); if (!container) throw new Error('This file is not a valid EPUB: the package container is missing.');
  const path = nodes(parseXML(await container.async('string')), 'rootfile')[0]?.getAttribute('full-path');
  const opfFile = zip.file(path || ''); if (!opfFile) throw new Error('The EPUB content package could not be found.');
  const opf = parseXML(await opfFile.async('string'));
  const encryption = zip.file('META-INF/encryption.xml');
  if (encryption) { const encrypted = parseXML(await encryption.async('string')); const algorithms = nodes(encrypted, 'EncryptionMethod').map(n => n.getAttribute('Algorithm')); if (algorithms.some(a => !['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'].includes(a))) throw new Error('This EPUB is DRM-protected. Import an unprotected EPUB that you have permission to read.'); }
  const items = nodes(opf, 'item'); const byId = new Map(items.map(n => [n.getAttribute('id'), n]));
  const coverId = nodes(opf, 'meta').find(n => n.getAttribute('name') === 'cover')?.getAttribute('content');
  const coverItem = items.find(n => n.getAttribute('properties')?.split(' ').includes('cover-image')) || byId.get(coverId);
  const images = new Map();
  async function getImage(href, base = path) { const imgPath = resolvePath(base, href); if (images.has(imgPath)) return images.get(imgPath); const entry = zip.file(imgPath); if (!entry) return null; const meta = items.find(n => resolvePath(path, n.getAttribute('href')) === imgPath); const type = meta?.getAttribute('media-type') || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[imgPath.split('.').pop().toLowerCase()]); if (entry._data?.uncompressedSize > 15 * 1024 * 1024) return null; const src = await rasterImage(await entry.async('uint8array'), type || ''); images.set(imgPath, src); return src; }
  const cover = coverItem ? await getImage(coverItem.getAttribute('href')) : null;
  const spine = nodes(opf, 'itemref').filter(n => n.getAttribute('linear') !== 'no'); const chapters = [];
  for (let i = 0; i < spine.length; i++) { check(signal); const item = byId.get(spine[i].getAttribute('idref')); if (!item) continue; const contentPath = resolvePath(path, item.getAttribute('href')); const entry = zip.file(contentPath); if (!entry) continue; report(`Reading chapter ${i + 1} of ${spine.length}…`, 10 + 85 * i / spine.length); const doc = new DOMParser().parseFromString(await entry.async('string'), 'text/html'); const blocks = await htmlBlocks(doc, href => getImage(href, contentPath)); if (blocks.length) chapters.push({ title: doc.querySelector('h1,h2,h3')?.textContent?.trim() || doc.title || `Section ${chapters.length + 1}`, blocks }); }
  return makeBook({ title: first(opf, 'title') || file.name.replace(/\.epub$/i, ''), author: nodes(opf, 'creator').map(n => n.textContent.trim()).join(', ') || 'Unknown author', cover, chapters, format: 'EPUB', sourceName: file.name });
}
export function linesFromPDF(items, width) {
  const textItems = items.filter(i => i.str?.trim()).map(i => ({ text: i.str, x: i.transform[4], y: i.transform[5], width: i.width, height: Math.abs(i.transform[3]) || i.height || 12 }));
  textItems.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const item of textItems) { let line = groups.find(l => Math.abs(l.y - item.y) < Math.max(2, item.height * .35)); if (!line) groups.push(line = { y: item.y, items: [] }); line.items.push(item); }
  const split = width / 2;
  const left = textItems.filter(i => i.x < split - width * .05 && i.x + i.width < split - width * .015);
  const right = textItems.filter(i => i.x > split + width * .015);
  const crossing = textItems.filter(i => i.x < split && i.x + i.width > split + width * .015);
  const columns = left.length > 6 && right.length > 6 && crossing.length < Math.max(3, textItems.length * .08);
  const make = arr => arr.map(line => ({ y: line.y, text: line.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ').trim() })).filter(l => l.text);
  if (columns) { const header = make(groups.filter(l => l.items.some(i => crossing.includes(i)))); const body = groups.filter(l => !l.items.some(i => crossing.includes(i))); return { columns: true, lines: [...header, ...make(body.map(l => ({ ...l, items: l.items.filter(i => i.x < split) })).filter(l => l.items.length)), ...make(body.map(l => ({ ...l, items: l.items.filter(i => i.x >= split) })).filter(l => l.items.length))] }; }
  return { columns: false, lines: make(groups) };
}
async function importPDF(file, report, signal, language) {
  report('Loading PDF reader…', 2);
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const bytes = new Uint8Array(await file.arrayBuffer()); check(signal);
  const resourceBase = new URL('pdf-resources/', document.baseURI).href;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, cMapUrl: resourceBase + 'cmaps/', cMapPacked: true, standardFontDataUrl: resourceBase + 'standard_fonts/', wasmUrl: resourceBase + 'wasm/' });
  let pdf, ocr;
  try { pdf = await task.promise; } catch (error) { if (error.name === 'PasswordException') throw new Error('This PDF requires a password. Save an unlocked copy, then import it.'); throw error; }
  const pages = []; const warnings = []; let cover;
  try {
    if (pdf.numPages > 1000) throw new Error('This PDF has more than 1,000 pages. Split it into smaller volumes first.');
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal); report(`Reading page ${number} of ${pdf.numPages}…`, 5 + number / pdf.numPages * 85);
      const page = await pdf.getPage(number); const content = await page.getTextContent(); const viewport = page.getViewport({ scale: 1 }); const extracted = linesFromPDF(content.items, viewport.width);
      const canvas = document.createElement('canvas'); const scale = Math.min(1.5, 1200 / Math.max(viewport.width, viewport.height)); const view = page.getViewport({ scale }); canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height); await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise; check(signal);
      const src = canvas.toDataURL('image/webp', .75); if (number === 1) cover = src;
      let text = extracted.lines.map(l => l.text).join('\n'); let scanned = text.replace(/\s/g, '').length < 20;
      if (scanned) { if (!ocr) { report('Preparing on-device OCR (first use needs internet)…', 5 + number / pdf.numPages * 85); const { createWorker } = await import('tesseract.js'); const ocrBase = new URL('ocr/', document.baseURI).href; ocr = await createWorker(language, 1, { workerPath: ocrBase + 'worker.min.js', corePath: ocrBase + 'core/', langPath: ocrBase + 'lang/', workerBlobURL: false, cachePath: 'pagegrovehq-rsvp-ocr', logger: m => { if (m.status === 'recognizing text') report(`Recognizing page ${number} of ${pdf.numPages} · ${Math.round(m.progress * 100)}%`, 5 + number / pdf.numPages * 85); } }); check(signal); } const result = await ocr.recognize(canvas); check(signal); text = result.data.text; warnings.push(`Page ${number} used OCR${result.data.confidence < 75 ? ' with low confidence' : ''}. Review the extracted passage.`); }
      if (extracted.columns) warnings.push(`Page ${number} appears to have columns. Check its reading order.`);
      pages.push({ number, text, lines: extracted.lines, scanned, src }); page.cleanup();
    }
    check(signal);
    const repeated = new Map();
    for (const p of pages.filter(p => !p.scanned)) { const edges = [...p.lines.slice(0, 2), ...p.lines.slice(-2)].map(l => l.text.replace(/\d+/g, '#')); for (const s of new Set(edges)) repeated.set(s, (repeated.get(s) || 0) + 1); }
    const chapters = pages.map(p => { let text = p.text; if (!p.scanned && pages.length >= 3) { const edge = new Set([...p.lines.slice(0, 2), ...p.lines.slice(-2)]); text = p.lines.filter(l => !edge.has(l) || !(/^\d+$/.test(l.text) || (repeated.get(l.text.replace(/\d+/g, '#')) || 0) >= Math.max(3, pages.length * .6))).map(l => l.text).join('\n'); } return { title: `Page ${p.number}`, blocks: [...textBlocks(normalizeText(text)), { type: 'image', src: p.src, alt: `Original PDF page ${p.number} · review illustrations, tables, and layout`, text: '' }] }; });
    const metadata = await pdf.getMetadata().catch(() => null);
    return makeBook({ title: metadata?.info?.Title?.trim() || file.name.replace(/\.pdf$/i, ''), author: metadata?.info?.Author?.trim() || 'Unknown author', format: 'PDF', cover, chapters, warnings: [...new Set(warnings)], needsReview: true, sourceName: file.name });
  } finally { if (ocr) await ocr.terminate(); await task.destroy(); }
}
async function importFB2(file) { const doc = parseXML(await file.text()); const body = nodes(doc, 'body').find(n => n.getAttribute('name') !== 'notes'); if (!body) throw new Error('No reading body found in this FB2 file.'); const chapters = []; const sections = [...body.children].filter(n => n.localName === 'section'); for (const section of (sections.length ? sections : [body])) { const blocks = []; for (const n of [...section.querySelectorAll('p,subtitle,image')]) { if (n.localName === 'image') { const id = (n.getAttribute('l:href') || n.getAttribute('xlink:href') || n.getAttribute('href') || '').replace('#', ''); const binary = nodes(doc, 'binary').find(b => b.id === id); if (binary) { const src = await rasterImage(Uint8Array.from(atob(binary.textContent.replace(/\s/g, '')), c => c.charCodeAt(0)), binary.getAttribute('content-type')); if (src) blocks.push({ type: 'image', src, alt: 'Book illustration', text: '' }); } } else if (n.textContent.trim()) blocks.push({ type: n.localName === 'subtitle' ? 'heading' : 'paragraph', text: normalizeText(n.textContent) }); } chapters.push({ title: section.querySelector('title')?.textContent?.trim() || `Section ${chapters.length + 1}`, blocks }); } return makeBook({ title: first(doc, 'book-title') || file.name, author: nodes(doc, 'author').map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(', ') || 'Unknown author', chapters, format: 'FB2', sourceName: file.name }); }
export async function importFile(file, report = () => {}, signal, language = 'eng') {
  if (file.size > MAX_FILE) throw new Error('Please choose a file smaller than 100 MB.'); check(signal);
  const ext = file.name.split('.').pop().toLowerCase(); let book;
  if (ext === 'epub') book = await importEpub(file, report, signal);
  else if (ext === 'pdf') book = await importPDF(file, report, signal, language);
  else if (ext === 'fb2') book = await importFB2(file);
  else if (['txt', 'md', 'html', 'htm'].includes(ext)) { const text = await file.text(); const blocks = ['html', 'htm'].includes(ext) ? await htmlBlocks(new DOMParser().parseFromString(text, 'text/html')) : textBlocks(text); book = makeBook({ title: file.name.replace(/\.[^.]+$/, ''), chapters: [{ title: 'Reading', blocks }], format: ext.toUpperCase(), sourceName: file.name }); }
  else throw new Error(['mobi', 'azw', 'azw3', 'kfx'].includes(ext) ? 'Kindle formats are not supported directly. Export an unprotected EPUB using your ebook manager, then import it here. DRM-protected books cannot be converted by Page Grove.' : 'Choose an EPUB, PDF, FB2, TXT, Markdown, or HTML file.');
  check(signal); report('Ready for your shelf', 100); return book;
}
