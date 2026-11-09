// Local file import (.txt / .epub) → a book object the existing reader
// understands. EPUBs are unzipped with fflate, spine items are concatenated
// into one HTML document with section headings, and images become blob URLs —
// the reader's own sanitizer + chapter splitter do the rest.
import { unzipSync } from 'fflate';

const localId = (file) => `local:${file.name}:${file.size}`;

const safeFileName = (name) => name.replace(/\.(txt|epub)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported book';

const rewriteImages = (bodyEl, zip, basePath) => {
  const resolvePath = (href) => {
    const parts = (basePath + decodeURIComponent(href)).split('/');
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.' && p !== '') out.push(p);
    }
    return out.join('/');
  };
  bodyEl.querySelectorAll('img[src], image').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : el.hasAttribute('href') ? 'href' : 'xlink:href';
    const src = el.getAttribute(attr);
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
    const path = resolvePath(src);
    const data = zip[path];
    if (!data) return;
    const ext = path.split('.').pop().toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext] || 'image/png';
    el.setAttribute(attr, URL.createObjectURL(new Blob([data], { type })));
  });
};

const parseEpub = async (file) => {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const decoder = new TextDecoder();
  const readStr = (p) => (zip[p] ? decoder.decode(zip[p]) : null);

  const container = readStr('META-INF/container.xml');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('Not a valid EPUB (missing OPF).');
  const opf = readStr(opfPath);
  const doc = new DOMParser().parseFromString(opf, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a valid EPUB (bad OPF).');

  const manifest = {};
  doc.querySelectorAll('manifest > item').forEach((it) => {
    manifest[it.getAttribute('id')] = {
      href: it.getAttribute('href'),
      type: it.getAttribute('media-type') || '',
    };
  });
  const spine = [...doc.querySelectorAll('spine > itemref')]
    .map((ir) => ir.getAttribute('idref'))
    .filter(Boolean);
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const sections = [];
  for (const idref of spine) {
    const item = manifest[idref];
    if (!item || !/x?html/i.test(item.type)) continue;
    const parts = (baseDir + decodeURIComponent(item.href)).split('/');
    const resolved = [];
    for (const p of parts) {
      if (p === '..') resolved.pop();
      else if (p !== '.' && p !== '') resolved.push(p);
    }
    const html = readStr(resolved.join('/'));
    if (!html) continue;
    const cdoc = new DOMParser().parseFromString(html, 'text/html');
    cdoc.body.querySelectorAll('script, style, link, meta, iframe, object, embed').forEach((el) => el.remove());
    const itemDir = resolved.slice(0, -1).join('/') + (resolved.length > 1 ? '/' : '');
    rewriteImages(cdoc.body, zip, itemDir);
    const heading = cdoc.body.querySelector('h1, h2, h3');
    const chapterTitle = heading?.textContent?.trim()
      || cdoc.querySelector('title')?.textContent?.trim()
      || `Section ${sections.length + 1}`;
    const bodyHtml = cdoc.body.innerHTML.trim();
    if (bodyHtml) sections.push({ title: chapterTitle, bodyHtml });
  }
  if (!sections.length) throw new Error('No readable chapters found in this EPUB.');

  // One document, one <section> per spine item — the reader's chapter
  // splitter turns each section heading into a chapter + TOC entry. The
  // wrapper heading is only injected when the spine item doesn't already
  // start with one, otherwise the empty wrapper becomes its own chapter.
  const html = sections.map((s, i) => {
    const safeTitle = s.title.replace(/[<>&]/g, '');
    const hasLeadingHeading = /^\s*<h[1-3][\s>]/i.test(s.bodyHtml);
    return hasLeadingHeading
      ? `<section>${s.bodyHtml}</section>`
      : `<section><h2 id="epub-ch-${i}">${safeTitle}</h2>${s.bodyHtml}</section>`;
  }).join('\n');

  return html;
};

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
    book._localHtml = await parseEpub(file);
  } else {
    // Raw text — the reader's buildBookHtml applies the rule engine and the
    // optional smart-format model at open time (prefs may change between
    // imports), then caches the result.
    book._localText = await file.text();
  }
  return book;
}
