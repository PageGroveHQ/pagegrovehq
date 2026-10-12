import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function walk(dir, prefix = '') { const result = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const name = prefix + entry.name; if (entry.isDirectory()) result.push(...await walk(dir + '/' + entry.name, name + '/')); else result.push(name); } return result; }
const allFiles = (await walk('dist')).filter(f => f !== 'sw.js');
const files = allFiles.filter(f => !f.startsWith('ocr/'));
const hash = createHash('sha256'); for (const file of allFiles) hash.update(await readFile('dist/' + file));
const version = hash.digest('hex').slice(0, 12);
await writeFile('dist/sw.js', `/* Page Grove HQ: this service worker and its caches are scoped only to this project. */
const PREFIX = 'pagegrovehq-rsvp-shell-' + encodeURIComponent(new URL(self.registration.scope).pathname) + '-';
const CACHE = PREFIX + '${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new URL(f, self.registration.scope).href)))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match(new URL('index.html', scope).href))); return; }
  event.respondWith(caches.match(event.request, { ignoreVary: true }).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && url.pathname.startsWith(new URL('ocr/', scope).pathname)) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  })));
});
`);
console.log(`Offline shell prepared: ${files.length} project assets, version ${version}`);
