// Minimal EPUB → HTML converter shared by local file imports and remote
// sources (Standard Ebooks). Spine items are concatenated into one document
// with section headings; the reader's own sanitizer and chapter splitter do
// the rest. Images become blob URLs from the zip contents.
import { unzipSync } from 'fflate';

const resolvePath = (base, href) => {
  const parts = (base + decodeURIComponent(href)).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
};

const rewriteImages = (bodyEl, zip, basePath) => {
  bodyEl.querySelectorAll('img[src], image').forEach((el) => {
    const attr = el.hasAttribute('src') ? 'src' : el.hasAttribute('href') ? 'href' : 'xlink:href';
    const src = el.getAttribute(attr);
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return;
    const data = zip[resolvePath(basePath, src)];
    if (!data) return;
    const ext = resolvePath(basePath, src).split('.').pop().toLowerCase();
    const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext] || 'image/png';
    el.setAttribute(attr, URL.createObjectURL(new Blob([data], { type })));
  });
};

// bytes: Uint8Array of an .epub file. Returns a single HTML string with one
// <section> per spine item.
export const parseEpubBytes = async (bytes) => {
  let zip;
  try {
    zip = unzipSync(bytes);
  } catch {
    throw new Error('This .epub file is corrupt (not a valid zip).');
  }
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
    const itemPath = resolvePath(baseDir, item.href);
    const html = readStr(itemPath);
    if (!html) continue;
    const cdoc = new DOMParser().parseFromString(html, 'text/html');
    cdoc.body.querySelectorAll('script, style, link, meta, iframe, object, embed').forEach((el) => el.remove());
    const itemDir = itemPath.includes('/') ? itemPath.slice(0, itemPath.lastIndexOf('/') + 1) : '';
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
  return sections.map((s, i) => {
    const safeTitle = s.title.replace(/[<>&]/g, '');
    const hasLeadingHeading = /^\s*<h[1-3][\s>]/i.test(s.bodyHtml);
    return hasLeadingHeading
      ? `<section>${s.bodyHtml}</section>`
      : `<section><h2 id="epub-ch-${i}">${safeTitle}</h2>${s.bodyHtml}</section>`;
  }).join('\n');
};
