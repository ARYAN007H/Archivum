// Standard Ebooks catalog (standardebooks.org) — carefully formatted,
// public-domain epubs. Their OPDS feed needs an account, but the public
// /ebooks index pages carry clean schema.org microdata, and the actual
// epub downloads are public (the /downloads/ URL serves an interstitial;
// appending ?source=download returns the epub directly).
import { fetchWithProxy } from './fetchProxy';

export const SE_ORIGIN = 'https://standardebooks.org';

const parseIndexPage = (html) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const books = [];
  doc.querySelectorAll('li[typeof="schema:Book"]').forEach((li) => {
    const path = li.getAttribute('about');
    if (!path) return;
    const title = li.querySelector('[property="schema:name"]')?.textContent?.trim();
    const author = li.querySelector('.author [property="schema:name"]')?.textContent?.trim();
    const cover = li.querySelector('img[property="schema:image"]')?.getAttribute('src');
    if (!title) return;
    books.push({
      id: `se:${path}`,
      title,
      authors: author ? [{ name: author }] : [],
      // The catalog image is avif-first; the <img> fallback src is jpg.
      formats: cover ? { 'image/jpeg': `${SE_ORIGIN}${cover}` } : {},
      languages: ['en'],
      subjects: ['Standard Ebooks'],
      download_count: 0,
      _source: 'standardebooks',
      _sePath: path,
    });
  });
  return books;
};

// Fetch a few pages of the SE catalog (48 per page). Returns [] on any
// failure — the catalog simply shows without them.
export const fetchStandardEbooks = async (pages = 2) => {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const html = await fetchWithProxy(`${SE_ORIGIN}/ebooks?per-page=48&page=${p}`, 'text', null);
      if (!html || html.length < 500) break;
      const parsed = parseIndexPage(html);
      if (!parsed.length) break;
      out.push(...parsed);
    } catch {
      break;
    }
  }
  return out;
};
