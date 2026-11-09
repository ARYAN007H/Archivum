// Local file import (.txt / .epub) → a book object the existing reader
// understands. EPUB parsing lives in src/lib/epub.js (shared with the
// Standard Ebooks remote source).
import { textToBookHtml } from './bookFormat';
import { parseEpubBytes } from './epub';

const localId = (file) => `local:${file.name}:${file.size}`;

const safeFileName = (name) => name.replace(/\.(txt|epub)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported book';

export async function openLocalFile(file) {
  const title = safeFileName(file.name);
  const book = {
    id: localId(file),
    title,
    authors: [],
    formats: {},
    languages: ['en'],
    subjects: ['Local file'],
    _source: 'local',
  };
  if (/\.epub$/i.test(file.name) || file.type === 'application/epub+zip') {
    book._localHtml = await parseEpubBytes(new Uint8Array(await file.arrayBuffer()));
  } else {
    const text = await file.text();
    if (!text.trim()) throw new Error('This file is empty.');
    // eslint-disable-next-line no-misleading-character-class
    if (!/[A-Za-z\u0900-\u097F]{3,}/.test(text)) throw new Error('No readable text found in this file.');
    // Raw text — the reader's buildBookHtml applies the rule engine and the
    // optional smart-format model at open time (prefs may change between
    // imports), then caches the result.
    book._localText = text;
  }
  return book;
}
