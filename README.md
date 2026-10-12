# Page Grove HQ

A private, local-first ebook library and Rapid Serial Visual Presentation reader. Built for **PageGroveHQ/pagegrovehq**; no shared assets, settings, deployment configuration, or credentials from other PageGroveHQ projects.

## Use the app

Add an EPUB, PDF, FB2, TXT, Markdown, or HTML file, or paste text. Review the import, add it to the shelf, and open the reader. Files are processed in your browser, not uploaded. Three public-domain sample excerpts are included, clearly labeled as excerpts.

- Cover library with search, grid/list views, sorting, in-progress and finished filters.
- Collections: assign a name in a book's details.
- Adjustable RSVP from 100–800 WPM, presets, a 10-WPM slider, and exact integer entry.
- Fixed anchor letter, optional guides, punctuation pauses, long-word timing, countdown, sentence replay, and chapter/page pauses.
- Sentence rewind/advance, chapter navigation, word search, exact-position progress, full passage reading, illustrations and tables.
- Bookmarks with personal notes, reading minutes, completed readings, and a short comprehension practice exercise.
- Daylight, parchment, and night themes; reduced motion; keyboard and touch controls; fullscreen and optional screen wake lock.
- Automatic pause when the document becomes hidden or loses focus. Word timing never fast-forwards to catch up after a slow frame.
- IndexedDB persistence and atomic backup restore. Backups contain extracted books, illustrations, settings, positions, bookmarks, and statistics. Original uploaded files are retained locally and separately downloadable, but excluded from backups.
- Offline app shell and all bundled PDF resources, isolated service worker scope, installable web manifest.

### Important behavior

**PDFs:** text extraction is automatic; pages without usable text invoke on-device Tesseract OCR. Every original page is retained as a compressed image in passage view. Column detection and repeated-header cleanup are heuristics, so every PDF gets a review preview. OCR recognition resources are bundled on this app's own hosting and fetched only when needed; no book content leaves the device. First use needs internet; the resources are then cached for offline reuse. OCR is slower on mobile. Choose English, Spanish, French, German, Italian, or Portuguese in Settings. Cancel stops import between asynchronous processing steps.

**EPUBs:** metadata, spine order, covers, paragraphs, images, and tables are preserved. Embedded scripts and navigation markup are ignored, and book HTML is never injected into the application DOM. External book images are not fetched. SVG images are stripped of scripts and external references, then rasterized before persistence.

**Limits:** 100 MB input files, 180 MB expanded EPUBs, and 1,000 PDF pages. DRM-protected EPUBs and Kindle MOBI/AZW/KFX are not supported: use an unprotected EPUB edition you have permission to read. HTML imports omit external images; Markdown is treated as readable text. Complex layouts, equations, and some fixed-layout books are best reviewed in passage view. Sentence heuristics may treat abbreviations as sentence endings. This app makes no clinical or speed/comprehension guarantees.

**Storage:** this is a browser-local library, with no accounts or automatic cloud synchronization. Backup/restore transfers it between devices. Clearing browser site data can remove it. Keep original files and export regular backups. GitHub Pages project sites on one account share an origin: the database, cache names, and service worker are specific to this project, but origin-level storage quota and security remain shared. Use a dedicated domain for stronger isolation.

## Develop

Node.js 22.12+ (Node 24 also supported).

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

`npm run build` copies PDF font/CMap/WASM resources from the pinned dependency into the public assets, builds the app, and generates a versioned service worker with paths relative to the project scope. Dependencies and generated runtime assets stay inside this checkout. No backend or secrets are required.

## Browser tests

```sh
npm run test:e2e
```

Uses an installed Chrome browser via Playwright. Tests run at desktop and iPhone-sized viewports against the production build. Coverage includes real EPUB/PDF imports, safe extraction, media pauses, exact speed entry, saved positions, bookmarks, collections, backup/restore, unsupported-format messages, and offline reloading. Screenshots and failure traces are in ignored `test-results/`.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` runs tests, builds, and deploys **only this repository** on pushes to `main`. In this repository's **Settings → Pages**, select **GitHub Actions** as the source if it has not already been enabled. Expected project URL: `https://pagegrovehq.github.io/pagegrovehq/`.

All asset links are relative so the app works under `/pagegrovehq/` or a dedicated domain. The service worker caches and handles requests only within its own registration scope. It never clears sibling apps' caches. Never put book uploads or private library backups into the public repository.

## Artwork

The book-and-leaf logo, sample cover designs, focus guides, and animations are original vector/CSS assets. The library's botanical watercolor banner was generated with the built-in ImageGen tool, optimized to WebP, and committed at `public/grove-banner.webp`. Prompt and provenance: `docs/artwork.md`.

Samples are public-domain excerpts in the United States: *Alice's Adventures in Wonderland* (Lewis Carroll, 1865), *The Secret Garden* (Frances Hodgson Burnett, 1911), and *Walden* (Henry David Thoreau, 1854). The practice passage is original text. Third-party dependencies retain their respective licenses.
