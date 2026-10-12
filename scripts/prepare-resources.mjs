import { cp, mkdir, readdir } from 'node:fs/promises';
await mkdir('public/pdf-resources', { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp('node_modules/pdfjs-dist/' + dir, 'public/pdf-resources/' + dir, { recursive: true });
await mkdir('public/ocr/core', { recursive: true }); await mkdir('public/ocr/lang', { recursive: true });
await cp('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const file of await readdir('node_modules/tesseract.js-core')) if (/^tesseract-core.*\.(js|wasm)$/.test(file)) await cp('node_modules/tesseract.js-core/' + file, 'public/ocr/core/' + file);
for (const language of ['eng', 'spa', 'fra', 'deu', 'ita', 'por']) await cp(`node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`, `public/ocr/lang/${language}.traineddata.gz`);
