import React, { useState, useEffect, useCallback, useRef, useMemo, Component } from 'react';
import NativeReader from './components/NativeReader';
import { Search, ChevronDown, User, Library, BookOpen, Home, Settings, ArrowRight, Command, CornerDownLeft, X, Globe, Filter, Heart, BarChart3, Clock, Flame, BookMarked } from 'lucide-react';
import { supabase } from './supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import Lenis from 'lenis';
import { lockPageScroll, unlockPageScroll, scrollToPosition } from './lib/scrollLock';
import { recordReadingDay, getReadingStreak, getTodayMinutes } from './lib/readingStats';
import { trapFocusIn } from './lib/focusTrap';
import { openLocalFile } from './lib/localBook';

// ========== ERROR BOUNDARY ==========

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base, #0a0a0f)', color: 'var(--text-primary, #EDE8DF)', fontFamily: "'JetBrains Mono', monospace", gap: '16px', padding: '40px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '24px', margin: 0 }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary, #8a8a8a)', maxWidth: '400px' }}>{this.state.error?.message || 'An unexpected error occurred.'}</p>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} style={{ padding: '12px 24px', background: 'var(--ember, #E04E2A)', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>RELOAD APP</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ========== HELPER COMPONENTS ==========

const SkeletonCard = () => (
  <div className="book-card-skeleton">
    <div className="skeleton-cover" />
    <div className="skeleton-body">
      <div className="skeleton-line short" />
      <div className="skeleton-line" />
      <div className="skeleton-line tiny" />
    </div>
  </div>
);

const MagneticButton = ({ children, className, onClick, style }) => {
  const ref = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouse = (e) => {
    const { clientX, clientY } = e;
    const { height, width, left, top } = ref.current.getBoundingClientRect();
    const middleX = clientX - (left + width / 2);
    const middleY = clientY - (top + height / 2);
    setPosition({ x: middleX * 0.2, y: middleY * 0.2 });
  };

  const reset = () => {
    setPosition({ x: 0, y: 0 });
  };

  return (
    <motion.button
      ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={reset}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
      className={className}
      onClick={onClick}
      style={style}
    >
      {children}
    </motion.button>
  );
};

const ProgressRing = ({ percent }) => {
  const r = 14, c = 2 * Math.PI * r;
  return (
    <svg className="card-progress-ring" viewBox="0 0 36 36">
      <circle className="ring-bg" cx="18" cy="18" r={r} />
      <circle className="ring-fill" cx="18" cy="18" r={r}
        strokeDasharray={c} strokeDashoffset={c - (percent / 100) * c} />
      <text className="ring-text" x="18" y="18">{percent}%</text>
    </svg>
  );
};

const cleanSubject = (sub) => {
  return sub.split('--').map(s => s.trim()).filter(s => s.length > 0 && s.length < 30)[0] || sub.substring(0, 25);
};

const getReadingProgress = () => {
  const progress = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('archivum_progress_percent_')) {
      const bookId = key.replace('archivum_progress_percent_', '');
      progress[bookId] = parseInt(localStorage.getItem(key)) || 0;
    }
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('archivum_progress_') && !key.startsWith('archivum_progress_percent_')) {
      const bookId = key.replace('archivum_progress_', '');
      if (progress[bookId] === undefined) {
        const rawProgress = parseInt(localStorage.getItem(key)) || 0;
        if (rawProgress < 10000) {
          progress[bookId] = Math.min(99, rawProgress);
        } else {
          progress[bookId] = 50;
        }
      }
    }
  }
  return progress;
};

const generateCover = (title, author, id) => {
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  const hues = [210, 340, 160, 25, 280, 50, 190, 310];
  // Safely convert id to a numeric index — string IDs (e.g. "ia_xxx") need hashing
  let numericId = 0;
  if (typeof id === 'number') {
    numericId = id;
  } else if (typeof id === 'string') {
    for (let i = 0; i < id.length; i++) numericId += id.charCodeAt(i);
  }
  const hue = hues[Math.abs(numericId) % hues.length];

  const grad = ctx.createLinearGradient(0, 0, 200, 300);
  grad.addColorStop(0, `hsl(${hue}, 35%, 18%)`);
  grad.addColorStop(1, `hsl(${hue}, 20%, 8%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 200, 300);

  ctx.strokeStyle = `hsl(${hue}, 60%, 55%)`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 24); ctx.lineTo(180, 24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 276); ctx.lineTo(180, 276); ctx.stroke();

  ctx.fillStyle = '#EDE8DF';
  ctx.font = 'bold 15px Georgia';
  ctx.textAlign = 'center';
  const words = (title || 'Unknown').split(' ');
  let line = '', y = 100;
  words.forEach(word => {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > 160 && line) {
      ctx.fillText(line.trim(), 100, y); line = word + ' '; y += 22;
    } else { line = test; }
  });
  ctx.fillText(line.trim(), 100, y);

  ctx.font = '11px monospace';
  ctx.fillStyle = `hsl(${hue}, 50%, 65%)`;
  ctx.fillText((author || 'Unknown').split(',')[0].toUpperCase(), 100, 250);

  return canvas.toDataURL();
};

const DynamicCover = ({ book, style, className }) => {
  const [coverUrl, setCoverUrl] = useState(() => {
    if (book._source !== 'archive' && book.formats?.['image/jpeg']) return book.formats['image/jpeg'];
    if (book._source === 'archive') {
      const cached = localStorage.getItem(`cover_${book._iaIdentifier}`);
      if (cached) return cached;
    }
    return null;
  });
  const [loading, setLoading] = useState(true);
  // A cached remote cover that fails to load (IA service hiccup, dead link)
  // falls back to the generated cover instead of a broken-image icon.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (coverUrl || book._source !== 'archive') return;

    let isMounted = true;
    const cacheKey = `cover_${book._iaIdentifier}`;
    
    // For IA books, default to their image service
    if (book._iaIdentifier) {
      const iaCover = `https://archive.org/services/img/${book._iaIdentifier}`;
      setCoverUrl(iaCover);
      localStorage.setItem(cacheKey, iaCover);
      return;
    }

    const authorQuery = book.authors?.[0]?.name ? `&author=${encodeURIComponent(book.authors[0].name)}` : '';
    const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}${authorQuery}&fields=cover_i&limit=1`;
    
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        const coverI = data?.docs?.[0]?.cover_i;
        if (coverI) {
          const finalUrl = `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
          setCoverUrl(finalUrl);
          localStorage.setItem(cacheKey, finalUrl);
        } else {
          localStorage.setItem(cacheKey, 'notfound');
        }
      })
      .catch(() => {});

    return () => { isMounted = false; };
  }, [book, coverUrl]);

  // Canvas raster + PNG encode per card is expensive — only regenerate when
  // the book identity actually changes, not on every parent re-render.
  const coverAuthorName = book.authors?.[0]?.name || 'Unknown';
  const fallback = useMemo(
    () => generateCover(book.title, coverAuthorName, book.id),
    [book.title, coverAuthorName, book.id]
  );
  const finalSrc = !loadFailed && coverUrl && coverUrl !== 'notfound' ? coverUrl : fallback;

  return (
    <div style={{ position: 'relative', display: 'flex', ...style }} className={className}>
      {loading && <div className="image-shimmer" style={{ position: 'absolute', inset: 0, borderRadius: style?.borderRadius || 0 }} aria-hidden="true" />}
      <img
        src={finalSrc}
        alt={book.title}
        style={{ width: '100%', height: '100%', objectFit: style?.objectFit || 'cover', borderRadius: style?.borderRadius || 0, display: 'block' }}
        loading="lazy"
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setLoadFailed(true); }}
      />
    </div>
  );
};

// ========== INTERNET ARCHIVE API ==========

const IA_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const IA_COVER_URL = 'https://archive.org/services/img';

// Gutendex (and some IA) names arrive as "Last, First" — flip them for display
// when the tail actually looks like a personal name. "Giles, Lionel" becomes
// "Lionel Giles", but "Sun-tzu, 6th cent. B.C" is left untouched.
const formatAuthorName = (name) => {
  if (!name || typeof name !== 'string') return name;
  // Gutendex embeds life dates in the name ("Shakespeare, William, 1564-1616");
  // the detail panel shows years separately from structured birth/death fields.
  // Internet Archive appends role suffixes ("…, 1859-1930, AUTHOR").
  const cleaned = name
    .replace(/\s*,\s*[c.]?\s*\d{1,4}\s*[–—-]\s*[c.]?\s*\d{0,4}\s*$/, '')
    .replace(/\s*,\s*(author|illustrator|editor|translator)\s*\.?$/i, '')
    .trim();
  const parts = cleaned.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length !== 2) return cleaned || name;
  const [last, first] = parts;
  const looksLikeName = (s) =>
    s.length > 1 && s.length < 40 && !/\d/.test(s) &&
    s.split(/\s+/).length <= 3 &&
    // eslint-disable-next-line no-misleading-character-class
    s.split(/\s+/).every(w => /^[A-Z\u00C0-\u024F\u0900-\u097F]/u.test(w));
  if (!looksLikeName(first)) return name;
  return `${first} ${last}`;
};

const normalizeIABook = (doc) => {
  const identifier = doc.identifier;
  const creatorRaw = doc.creator;
  const authorName = Array.isArray(creatorRaw) ? creatorRaw[0] : (creatorRaw || 'Unknown');
  const langRaw = doc.language;
  const lang = Array.isArray(langRaw) ? langRaw[0] : (langRaw || 'en');
  const langCode = lang.length <= 3 ? lang.toLowerCase() : (lang.toLowerCase() === 'hindi' ? 'hi' : 'en');
  const subjects = Array.isArray(doc.subject) ? doc.subject : (doc.subject ? [doc.subject] : []);

  return {
    id: `ia_${identifier}`,
    _iaIdentifier: identifier,
    _source: 'archive',
    title: doc.title || 'Untitled',
    authors: [{ name: formatAuthorName(authorName) }],
    formats: {
      'image/jpeg': null,
      'application/epub+zip': null,
      'text/html': null,
      'text/plain': null,
    },
    subjects: subjects.slice(0, 6),
    download_count: doc.downloads || 0,
    languages: [langCode],
    bookshelves: [],
    _needsMetadata: true,
  };
};

// Helper: fetch with timeout
const fetchWithTimeout = (url, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
};

const looksLikeHtml = (text) => {
  const head = text.slice(0, 500).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
};

// Dev-only Vite proxies (see vite.config.js); in production these fall through.
const devProxyFor = (url) => {
  if (url.includes('gutenberg.org')) return url.replace(/^https?:\/\/[^/]+/, '/gutenberg');
  if (url.includes('archive.org')) return url.replace(/^https?:\/\/[^/]+/, '/ia');
  return null;
};

const fetchWithProxy = async (url, responseType = 'json') => {
  const devProxy = devProxyFor(url);
  const proxyMakers = [
    ...(devProxy ? [{ make: () => devProxy, timeout: 20000 }] : []),
    { make: () => `/api/proxy?url=${encodeURIComponent(url)}`, timeout: 25000 },
    { make: () => `https://corsproxy.io/?${encodeURIComponent(url)}`, timeout: 10000 },
    { make: () => url, timeout: 10000 }
  ];

  for (const item of proxyMakers) {
    try {
      const proxyUrl = item.make();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), item.timeout);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const text = await res.text();
      // Reject SPA shells / error pages served with 200 — they would either
      // fail JSON.parse with a confusing error or be treated as book data.
      if (looksLikeHtml(text)) continue;
      if (responseType === 'json') {
        return JSON.parse(text);
      }
      return text;
    } catch (e) {
      continue;
    }
  }
  throw new Error(`All proxies failed for: ${url}`);
};

// Escape a raw user term for a Lucene query: strip characters that have query
// syntax meaning and wrap the remainder as a phrase so it can never inject
// operators (a malformed query makes advancedsearch return 400 and the
// catalog silently goes empty).
const luceneEscape = (term) => term.replace(/["\\+!(){}[\]^~*?:/-]/g, ' ').replace(/\s+/g, ' ').trim();

const fetchIABooks = async (searchQuery = '', pageNum = 1, langFilter = '', genreFilter = '') => {
  // Filter for actual books: require 'texts' mediatype + book-related collections
  // Exclude known non-book collections (policies, reports, government docs)
  let q = 'mediatype:texts AND (collection:opensource OR collection:books OR collection:gutenberg OR collection:additional_collections)';
  q += ' AND NOT collection:governmentpublications AND NOT collection:usgovernmentdocuments';
  q += ' AND NOT title:(policy OR "terms of use" OR "privacy policy" OR "annual report" OR "financial statement" OR "ebook collection" OR masterdoc OR accident OR "incident report")';
  
  if (langFilter === 'hi') {
    q += ' AND language:(Hindi OR hin)';
  } else if (langFilter === 'en') {
    q += ' AND language:(English OR eng OR en)';
  }
  if (searchQuery) {
    const sq = luceneEscape(searchQuery);
    if (sq) q += ` AND (title:("${sq}") OR creator:("${sq}"))`;
  } else {
    // Default: popular Hindi + multilingual literature
    if (!langFilter) q += ' AND language:(Hindi OR hin OR English OR eng)';
    // Default listing quality gate: require a credited creator so the top of
    // the catalog isn't dominated by anonymous uploaded documents
    q += ' AND creator:*';
  }

  if (genreFilter) {
    const gf = luceneEscape(genreFilter);
    if (gf) q += ` AND subject:("${gf}")`;
  }

  const rows = 20;
  const url = `${IA_SEARCH_URL}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&fl[]=date&fl[]=subject&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&page=${pageNum}&output=json`;

  const data = await fetchWithProxy(url, 'json');
  const docs = data?.response?.docs || [];
  const numFound = data?.response?.numFound || 0;
  
  // Post-filter: remove items that look like non-books
  const junkPatterns = /policy|terms of (use|service)|privacy|annual report|financial|memorandum|regulation|guideline|compliance|software|firmware|gameboy|nintendo|snes|sega|nes rom|game boy|rom\b|romhack|walkthrough|manual for|driver|user guide|calendar|presentation|slides|dataset|logbook/i;
  const filtered = docs.filter(doc => {
    const title = (doc.title || '').toString();
    if (junkPatterns.test(title)) return false;
    if (!doc.language || doc.language.length === 0) return false; // uploaded docs rarely declare a language
    // Titles that are nearly all digits/symbols ("d68", "bn10") are dumps, not books
    // eslint-disable-next-line no-misleading-character-class
    const letters = title.toLowerCase().replace(/[^a-z\u0900-\u097f]/gu, '');
    if (letters.length < 3) return false;
    return true;
  });
  
  return {
    results: filtered.map(normalizeIABook),
    hasMore: (pageNum * rows) < numFound,
    total: numFound,
  };
};

const fetchIASearch = async (query) => {
  if (!query.trim()) return [];
  const sq = luceneEscape(query);
  if (!sq) return [];
  const url = `${IA_SEARCH_URL}?q=${encodeURIComponent(`mediatype:texts AND (title:("${sq}") OR creator:("${sq}"))`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&fl[]=downloads&sort[]=downloads+desc&rows=6&page=1&output=json`;
  const data = await fetchWithProxy(url, 'json');
  return (data?.response?.docs || []).map(normalizeIABook);
};

// ========== CURATED SUGGESTIONS ==========

const CURATED_SUGGESTIONS = [
  // English classics
  { title: 'Pride and Prejudice', author: 'Jane Austen', lang: 'en' },
  { title: 'Frankenstein', author: 'Mary Shelley', lang: 'en' },
  { title: 'Dracula', author: 'Bram Stoker', lang: 'en' },
  { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', lang: 'en' },
  { title: '1984', author: 'George Orwell', lang: 'en' },
  { title: 'Moby Dick', author: 'Herman Melville', lang: 'en' },
  { title: 'Adventures of Huckleberry Finn', author: 'Mark Twain', lang: 'en' },
  { title: 'War and Peace', author: 'Leo Tolstoy', lang: 'en' },
  { title: 'Crime and Punishment', author: 'Fyodor Dostoyevsky', lang: 'en' },
  { title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle', lang: 'en' },
  { title: 'Alice in Wonderland', author: 'Lewis Carroll', lang: 'en' },
  { title: 'A Tale of Two Cities', author: 'Charles Dickens', lang: 'en' },
  { title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', lang: 'en' },
  { title: 'Jane Eyre', author: 'Charlotte Brontë', lang: 'en' },
  { title: 'Wuthering Heights', author: 'Emily Brontë', lang: 'en' },
  { title: 'The Count of Monte Cristo', author: 'Alexandre Dumas', lang: 'en' },
  { title: 'Don Quixote', author: 'Miguel de Cervantes', lang: 'en' },
  { title: 'Les Misérables', author: 'Victor Hugo', lang: 'en' },
  { title: 'The Odyssey', author: 'Homer', lang: 'en' },
  { title: 'Romeo and Juliet', author: 'William Shakespeare', lang: 'en' },
  { title: 'Hamlet', author: 'William Shakespeare', lang: 'en' },
  { title: 'The Art of War', author: 'Sun Tzu', lang: 'en' },
  { title: 'The Republic', author: 'Plato', lang: 'en' },
  { title: 'Heart of Darkness', author: 'Joseph Conrad', lang: 'en' },
  { title: 'Little Women', author: 'Louisa May Alcott', lang: 'en' },
  // Hindi / Indian classics
  { title: 'गोदान', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'गबन', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'निर्मला', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'रंगभूमि', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'कर्मभूमि', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'सेवासदन', author: 'मुंशी प्रेमचंद', lang: 'hi' },
  { title: 'रामचरितमानस', author: 'तुलसीदास', lang: 'hi' },
  { title: 'कामायनी', author: 'जयशंकर प्रसाद', lang: 'hi' },
  { title: 'मधुशाला', author: 'हरिवंश राय बच्चन', lang: 'hi' },
  { title: 'चित्रलेखा', author: 'भगवती चरण वर्मा', lang: 'hi' },
  { title: 'गुनाहों का देवता', author: 'धर्मवीर भारती', lang: 'hi' },
  { title: 'श्रीमद्भगवद्गीता', author: 'वेदव्यास', lang: 'hi' },
  { title: 'Premchand Stories', author: 'Munshi Premchand', lang: 'hi' },
  { title: 'Ramcharitmanas', author: 'Tulsidas', lang: 'hi' },
  { title: 'Bhagavad Gita', author: 'Vedvyas', lang: 'hi' },
  { title: 'Mahabharata', author: 'Vedvyas', lang: 'hi' },
  { title: 'Ramayana', author: 'Valmiki', lang: 'hi' },
  { title: 'Meghadootam', author: 'Kalidas', lang: 'hi' },
  { title: 'Panchatantra', author: 'Vishnu Sharma', lang: 'hi' },
  { title: 'Chanakya Niti', author: 'Chanakya', lang: 'hi' },
  { title: 'माँ', author: 'मक्सिम गोर्की', lang: 'hi' },
  // Popular search terms
  { title: 'Shakespeare', author: '', lang: 'en' },
  { title: 'Philosophy', author: '', lang: 'en' },
  { title: 'Poetry', author: '', lang: 'en' },
  { title: 'Science Fiction', author: '', lang: 'en' },
  { title: 'हिन्दी साहित्य', author: '', lang: 'hi' },
  { title: 'Hindi Novels', author: '', lang: 'hi' },
];

const fuzzyMatch = (text, query) => {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return true;
  // Check if all query chars exist in order
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
};

const getLocalSuggestions = (query, langFilter = '') => {
  if (!query || query.length < 2) return [];
  return CURATED_SUGGESTIONS
    .filter(s => {
      if (langFilter && s.lang !== langFilter) return false;
      return fuzzyMatch(s.title, query) || (s.author && fuzzyMatch(s.author, query));
    })
    .slice(0, 5);
};

// Search cache
const searchCache = new Map();

function App() {
  const [books, setBooks] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  
  const [selectedBook, setSelectedBook] = useState(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [navVisible, setNavVisible] = useState(false);
  const [detailAnim, setDetailAnim] = useState(false);

  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((message) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const updateOfflineStatus = useCallback(async () => {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open('archivum-data-v1');
      const requests = await cache.keys();
      const cachedIds = new Set();
      
      requests.forEach(req => {
        const url = req.url;
        const gutMatch = url.match(/\/cache\/epub\/(\d+)\//) || url.match(/\/files\/(\d+)\//);
        if (gutMatch) {
          cachedIds.add(gutMatch[1]);
        }
        const iaMatch = url.match(/\/metadata\/([^\/]+)/) || url.match(/\/download\/([^\/]+)/);
        if (iaMatch && !iaMatch[1].endsWith('.js') && !iaMatch[1].endsWith('.css')) {
          cachedIds.add(`ia_${iaMatch[1]}`);
        }
        if (url.includes('/api/proxy') || url.includes('corsproxy.io')) {
          const decoded = decodeURIComponent(url);
          const pGutMatch = decoded.match(/\/cache\/epub\/(\d+)\//) || decoded.match(/\/files\/(\d+)\//);
          if (pGutMatch) {
            cachedIds.add(pGutMatch[1]);
          }
          const pIaMatch = decoded.match(/\/metadata\/([^\/]+)/) || decoded.match(/\/download\/([^\/]+)/);
          if (pIaMatch) {
            cachedIds.add(`ia_${pIaMatch[1]}`);
          }
        }
      });
      setOfflineBookIds(cachedIds);
    } catch (e) {
      console.error("Error reading cache for offline status:", e);
    }
  }, []);

  // Library State
  const [view, setView] = useState('catalog'); // 'catalog' | 'library' | 'saved' | 'stats'
  const [libraryBooks, setLibraryBooks] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Saved / Want to Read
  const [savedBooks, setSavedBooks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('archivum_saved_books') || '[]'); } catch { return []; }
  });
  const [justSavedId, setJustSavedId] = useState(null);

  // Auth State
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const loaderRef = useRef(null);
  const overlaySearchId = useRef(0);
  const searchDebounceRef = useRef(null);
  const [seBooks, setSeBooks] = useState([]);

  // Standard Ebooks catalog: best-effort, cached for a week in localStorage.
  // Merged into the grid below the Gutendex results.
  useEffect(() => {
    let alive = true;
    const TTL = 7 * 86400000;
    try {
      const cached = JSON.parse(localStorage.getItem('archivum_se_catalog') || 'null');
      if (cached && Date.now() - cached.at < TTL && Array.isArray(cached.books) && cached.books.length) {
        setSeBooks(cached.books);
        return;
      }
    } catch { /* re-fetch on bad cache */ }
    import('./lib/standardebooks').then(({ fetchStandardEbooks }) => fetchStandardEbooks(2)).then((books) => {
      if (!alive || !books.length) return;
      setSeBooks(books);
      try { localStorage.setItem('archivum_se_catalog', JSON.stringify({ at: Date.now(), books })); } catch { /* quota */ }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const scrollPositionRef = useRef(0);
  const currentFetchId = useRef(0);
  const loadingRef = useRef(false);
  const authModalRef = useRef(null);
  const searchOverlayRef = useRef(null);
  const detailPanelRef = useRef(null);
  const fileInputRef = useRef(null);
  const [importError, setImportError] = useState(null);

  // Search Overlay (Cmd+K)
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [overlayQuery, setOverlayQuery] = useState('');

  // Trending books for hero
  const [trendingBooks, setTrendingBooks] = useState([]);

  // Reading progress map { bookId: pageNum }
  const [progressMap, setProgressMap] = useState({});
  const [dailyGoal, setDailyGoal] = useState(() => {
    try { return parseInt(localStorage.getItem('archivum_daily_goal') || '30', 10); } catch { return 30; }
  });
  const [offlineBookIds, setOfflineBookIds] = useState(new Set());

  // Book-open cinematic transition
  const [bookOpenAnim, setBookOpenAnim] = useState(null);

  // Reading streak
  const [streak, setStreak] = useState(0);

  // Language filter: '' = all, 'en' = english, 'hi' = hindi
  const [langFilter, setLangFilter] = useState('');

  // Smart search: local suggestions
  const [localSuggestions, setLocalSuggestions] = useState([]);
  const [searchLangFilter, setSearchLangFilter] = useState(''); // filter inside search overlay

  // IA page tracker (separate from Gutenberg page)
  const [iaPage, setIaPage] = useState(1);

  // Save/unsave book toggle
  const toggleSaveBook = async (book, e) => {
    e.stopPropagation();
    
    const isSaved = isBookSaved(book.id);
    if (isSaved) {
      const newSaved = savedBooks.filter(b => b.id !== book.id);
      setSavedBooks(newSaved);
      localStorage.setItem('archivum_saved_books', JSON.stringify(newSaved));
      addToast("Removed from Saved.");
    } else {
      const newSaved = [...savedBooks, { id: book.id, title: book.title, authors: book.authors, formats: book.formats, languages: book.languages, subjects: book.subjects, download_count: book.download_count, _source: book._source, _iaIdentifier: book._iaIdentifier, savedAt: Date.now() }];
      setSavedBooks(newSaved);
      localStorage.setItem('archivum_saved_books', JSON.stringify(newSaved));
      setJustSavedId(book.id);
      setTimeout(() => setJustSavedId(null), 1500);
      addToast("Book saved to Library.");
    }
  };

  const removeBookProgress = async (bookId) => {
    if (window.confirm("Are you sure you want to remove this book from your library and reset your reading progress?")) {
      if (user && supabase) {
        try {
          await supabase.from('reading_progress').delete().eq('user_id', user.id).eq('book_id', bookId);
        } catch (e) {
          console.error(e);
        }
      }
      localStorage.removeItem(`archivum_progress_${bookId}`);
      localStorage.removeItem(`archivum_progress_percent_${bookId}`);
      localStorage.removeItem(`archivum_visible_index_${bookId}`);
      
      try {
        const localMeta = JSON.parse(localStorage.getItem('archivum_library_metadata') || '{}');
        delete localMeta[bookId];
        localStorage.setItem('archivum_library_metadata', JSON.stringify(localMeta));
      } catch (e) {}

      setProgressMap(prev => {
        const copy = { ...prev };
        delete copy[bookId];
        return copy;
      });

      setLibraryBooks(prev => prev.filter(b => b.id !== bookId));
      addToast("Book progress reset and removed.");
      closeBook();
    }
  };

  const isBookSaved = (bookId) => savedBooks.some(b => b.id === bookId);

  // Reading stats helpers
  const getReadingStats = () => {
    const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
    const uniqueDays = [...new Set(days)];
    let totalMinutes = 0;
    let booksStarted = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('archivum_time_')) {
        totalMinutes += parseInt(localStorage.getItem(key) || '0', 10);
      }
      if (key?.startsWith('archivum_progress_')) {
        booksStarted++;
      }
    }
    return { totalDays: uniqueDays.length, totalMinutes, booksStarted, streak: getReadingStreak(), savedCount: savedBooks.length };
  };

  // Lenis is initialized in main.jsx — no duplicate instance here

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user && _event === 'SIGNED_IN') {
          migrateLocalStorageToSupabase(session.user.id);
        }
      });
      return () => subscription.unsubscribe();
    }
  }, []);

  const migrateLocalStorageToSupabase = async (userId) => {
    if (!supabase) return;
    const updates = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('archivum_highlights_') || key.startsWith('archivum_bookmarks_') || key.startsWith('archivum_progress_')) {
        let bookId = '';
        if (key.startsWith('archivum_progress_')) {
          bookId = key.replace('archivum_progress_', '');
        } else if (key.startsWith('archivum_highlights_')) {
          bookId = key.replace('archivum_highlights_', '');
        } else if (key.startsWith('archivum_bookmarks_')) {
          bookId = key.replace('archivum_bookmarks_', '');
        }
        if (!bookId || bookId.startsWith('percent_')) continue; // skip the percentage key
        
        if (!updates[bookId]) updates[bookId] = { user_id: userId, book_id: bookId };
        try {
          const val = JSON.parse(localStorage.getItem(key));
          if (key.startsWith('archivum_highlights_')) updates[bookId].highlights = val;
          if (key.startsWith('archivum_bookmarks_')) updates[bookId].bookmarks = val;
          if (key.startsWith('archivum_progress_')) updates[bookId].current_page = val;
        } catch(e) {}
      }
    }
    const rows = Object.values(updates);
    if (rows.length > 0) {
      // Only clear local data after the cloud upsert is confirmed — if Supabase
      // is unreachable, misconfigured, or RLS rejects the write, deleting local
      // keys here would irreversibly destroy the user's reading data.
      const { error } = await supabase.from('reading_progress').upsert(rows, { onConflict: 'user_id,book_id' });
      if (error) {
        console.error('Progress sync failed — keeping local data:', error.message);
        return;
      }
      // Clear migrated items
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key.startsWith('archivum_highlights_') || key.startsWith('archivum_bookmarks_') || key.startsWith('archivum_progress_')) {
          if (key.startsWith('archivum_progress_percent_')) continue; // never delete the percentage cache
          localStorage.removeItem(key);
        }
      }
    }
  };

  const fetchBooks = useCallback(async (isLoadMore = false) => {
    if (isLoadMore && loadingRef.current) return;
    if (isLoadMore && !hasMore) return;
    
    const fetchId = ++currentFetchId.current;
    
    loadingRef.current = true;
    setLoading(true);
    
    try {
      const currentGutPage = isLoadMore ? page + 1 : 1;
      const currentIAPage = isLoadMore ? iaPage + 1 : 1;

      // Deduplicate helper
      const dedup = (arr) => {
        const seen = new Set();
        return arr.filter(b => {
          if (!b || !b.title) return false;
          const key = b.title.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, '').substring(0, 30);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      // Staggered fetch: show whichever source responds first
      let gutPromise = null;
      let iaPromise = null;

      // Gutenberg fetch (skip if Hindi-only filter) — 10s timeout
      if (langFilter !== 'hi') {
        let gutUrl = `https://gutendex.com/books/?page=${currentGutPage}`;
        if (query) gutUrl += `&search=${encodeURIComponent(query)}`;
        if (genre) gutUrl += `&topic=${encodeURIComponent(genre)}`;
        if (langFilter === 'en') gutUrl += `&languages=en`;
        gutPromise = fetchWithTimeout(gutUrl, 10000).then(r => r.json()).then(data => ({
          source: 'gutenberg',
          results: (data.results || []).filter(b => b && b.title).map(b => ({
            ...b,
            authors: (b.authors || []).map(a => ({ ...a, name: formatAuthorName(a.name) })),
          })),
          hasMore: !!data.next,
        })).catch(() => ({ source: 'gutenberg', results: [], hasMore: false }));
      }

      // Internet Archive fetch (always include for mixed/hindi) — 12s timeout
      if (langFilter !== 'en') {
        iaPromise = fetchIABooks(query || '', currentIAPage, langFilter, genre).then(data => ({
          source: 'archive',
          results: data.results || [],
          hasMore: data.hasMore,
        })).catch(() => ({ source: 'archive', results: [], hasMore: false }));
      }

      // Show fast source immediately, then merge slow source when ready
      let gutResult = null;
      let iaResult = null;
      let earlyBooks = [];

      // If both sources, show the first one that resolves instantly
      if (gutPromise && iaPromise) {
        // Race: show whichever resolves first
        const first = await Promise.race([
          gutPromise.then(r => { gutResult = r; return r; }),
          iaPromise.then(r => { iaResult = r; return r; }),
        ]);
        if (fetchId !== currentFetchId.current) return;

        // Show early results immediately
        earlyBooks = dedup(first.results || []);
        if (isLoadMore) {
          setBooks(prev => {
            const existingKeys = new Set(prev.map(b => b.id));
            return [...prev, ...earlyBooks.filter(b => !existingKeys.has(b.id))];
          });
        } else {
          setBooks(earlyBooks);
        }

        // Now wait for the slower source (with a secondary timeout)
        const slowTimeout = new Promise(resolve => setTimeout(() => resolve(null), 8000));
        if (!gutResult) gutResult = await Promise.race([gutPromise, slowTimeout]) || { source: 'gutenberg', results: [], hasMore: false };
        if (!iaResult) iaResult = await Promise.race([iaPromise, slowTimeout]) || { source: 'archive', results: [], hasMore: false };
        if (fetchId !== currentFetchId.current) return;
      } else {
        // Only one source
        if (gutPromise) gutResult = await gutPromise;
        if (iaPromise) iaResult = await iaPromise;
        if (fetchId !== currentFetchId.current) return;
      }

      // Merge and interleave final results
      const gutBooks = (gutResult?.results || []).filter(b => b && b.title);
      const iaBooks = (iaResult?.results || []).filter(b => b && b.title);

      let merged = [];
      let gi = 0, ii = 0;
      while (gi < gutBooks.length || ii < iaBooks.length) {
        for (let k = 0; k < 3 && gi < gutBooks.length; k++, gi++) {
          merged.push(gutBooks[gi]);
        }
        for (let k = 0; k < 2 && ii < iaBooks.length; k++, ii++) {
          merged.push(iaBooks[ii]);
        }
      }

      merged = dedup(merged);
      const anyHasMore = (gutResult?.hasMore ?? false) || (iaResult?.hasMore ?? false);

      if (isLoadMore) {
        setBooks(prev => {
          const existingKeys = new Set(prev.map(b => b.id));
          const newBooks = merged.filter(b => !existingKeys.has(b.id));
          return [...prev, ...newBooks];
        });
        setPage(currentGutPage);
        setIaPage(currentIAPage);
      } else {
        setBooks(merged);
        setPage(1);
        setIaPage(1);
      }
      setHasMore(anyHasMore);
    } catch (e) {
      console.error('fetchBooks error:', e);
    } finally {
      // A stale fetch (superseded by a newer filter/search change) must never
      // release the loading guard — otherwise the IntersectionObserver starts
      // a second concurrent fetch while the new one is still in flight.
      if (fetchId === currentFetchId.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [hasMore, page, iaPage, query, genre, langFilter]);

  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true);
    let ids = [];
    let localMeta = {};
    try {
      localMeta = JSON.parse(localStorage.getItem('archivum_library_metadata') || '{}');
    } catch (e) {
      console.error("Error reading library metadata:", e);
    }

    if (user && supabase) {
      try {
        const { data } = await supabase.from('reading_progress').select('book_id').eq('user_id', user.id);
        if (data) ids = data.map(d => d.book_id);
      } catch (e) { console.error(e); }
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('archivum_progress_') && !key.startsWith('archivum_progress_percent_')) {
          ids.push(key.replace('archivum_progress_', ''));
        }
      }
    }
    
    ids = [...new Set(ids)]; // deduplicate
    
    if (ids.length === 0) {
      setLibraryBooks([]);
      setLibraryLoading(false);
      return;
    }

    const resolvedBooks = [];
    const missingIds = [];

    ids.forEach(id => {
      if (localMeta[id]) {
        resolvedBooks.push(localMeta[id]);
      } else {
        missingIds.push(id);
      }
    });

    if (missingIds.length > 0) {
      // Only numeric Gutenberg ids can go to the batch endpoint — a single
      // local:/garbage id makes the whole ?ids= query 400 and silently drops
      // every legitimate book from the library.
      const gutIds = missingIds.filter(id => /^\d+$/.test(id.toString()));
      if (gutIds.length > 0) {
        try {
          const res = await fetch(`https://gutendex.com/books?ids=${gutIds.join(',')}`);
          const data = await res.json();
          if (data.results) {
            data.results.forEach(b => {
              resolvedBooks.push(b);
              localMeta[b.id] = {
                ...b,
                lastRead: Date.now() - 86400000
              };
            });
          }
        } catch(e) { console.error(e); }
      }

      const iaIds = missingIds.filter(id => id.toString().startsWith('ia_'));
      for (const iaId of iaIds) {
        const identifier = iaId.replace('ia_', '');
        try {
          const res = await fetch(`https://archive.org/metadata/${identifier}`);
          const data = await res.json();
          if (data?.metadata) {
            const meta = data.metadata;
            const normBook = normalizeIABook({
              identifier,
              creator: meta.creator,
              language: meta.language,
              subject: meta.subject,
              downloads: meta.downloads,
              title: meta.title
            });
            resolvedBooks.push(normBook);
            localMeta[iaId] = {
              ...normBook,
              lastRead: Date.now() - 86400000
            };
          }
        } catch(e) { console.error(e); }
      }

      try {
        localStorage.setItem('archivum_library_metadata', JSON.stringify(localMeta));
      } catch (e) {}
    }

    resolvedBooks.sort((a, b) => {
      const timeA = localMeta[a.id]?.lastRead || 0;
      const timeB = localMeta[b.id]?.lastRead || 0;
      return timeB - timeA;
    });

    setLibraryBooks(resolvedBooks);
    setLibraryLoading(false);
  }, [user]);

  useEffect(() => {
    if (view === 'library') fetchLibrary();
  }, [view, fetchLibrary]);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchBooks(false);
    }, 250);
    return () => clearTimeout(delayDebounce);
  }, [query, genre, langFilter]);

  useEffect(() => {
    const handleScroll = () => {
      setNavVisible(window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingRef.current && hasMore) {
        fetchBooks(true);
      }
    }, { rootMargin: '400px' });
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [hasMore, fetchBooks]);

  // Load trending books on mount (mixed Gutenberg + IA Hindi)
  useEffect(() => {
    Promise.all([
      fetch('https://gutendex.com/books/?sort=popular&page=1')
        .then(r => r.json())
        .then(data => (data.results || []).slice(0, 5))
        .catch(() => []),
      fetchIABooks('', 1, 'hi')
        .then(data => (data.results || []).slice(0, 3))
        .catch(() => []),
    ]).then(([gutTrending, iaTrending]) => {
      setTrendingBooks([...gutTrending, ...iaTrending]);
    });
  }, []);

  // Load reading progress map and streak on mount
  useEffect(() => {
    setProgressMap(getReadingProgress());
    setStreak(getReadingStreak());
    updateOfflineStatus();
  }, [updateOfflineStatus]);

  // Keep keyboard focus inside the open modal (auth, ⌘K search, book detail).
  useEffect(() => {
    if (showAuthModal) return trapFocusIn(authModalRef.current);
    if (showSearchOverlay) return trapFocusIn(searchOverlayRef.current);
    if (selectedBook) return trapFocusIn(detailPanelRef.current);
    return undefined;
  }, [showAuthModal, showSearchOverlay, selectedBook]);

  // Local file import: picker button, OS drag-and-drop, and PWA file
  // handling ("Open with Archivum" for .txt / .epub).
  const openLocalBook = async (file) => {
    if (!file) return;
    try {
      setImportError(null);
      const localBook = await openLocalFile(file);
      addToast(`Imported "${localBook.title}".`);
      if (user) {
        // Persist to library metadata immediately (startReading only fires
        // from the detail panel; imported files skip nothing anyway, but the
        // metadata write here makes the book survive a reload pre-read).
        try {
          const libraryMeta = JSON.parse(localStorage.getItem('archivum_library_metadata') || '{}');
          libraryMeta[localBook.id] = {
            id: localBook.id,
            title: localBook.title,
            authors: localBook.authors,
            formats: localBook.formats,
            languages: localBook.languages,
            subjects: localBook.subjects,
            download_count: 0,
            _source: 'local',
            lastRead: Date.now(),
            progressPercent: 0,
          };
          localStorage.setItem('archivum_library_metadata', JSON.stringify(libraryMeta));
        } catch { /* storage unavailable */ }
      }
      openBook(localBook);
    } catch (err) {
      console.error('Import failed:', err);
      // Surface everywhere (toasts render above any view) — the inline
      // notice only exists on the library screen.
      const msg = err?.message?.trim() || 'This file could not be read as a book.';
      setImportError(msg);
      addToast(`Import failed — ${msg}`);
    }
  };

  useEffect(() => {
    const onDragOver = (e) => { e.preventDefault(); };
    const onDrop = (e) => {
      e.preventDefault();
      const file = [...(e.dataTransfer?.files || [])].find((f) => /\.(txt|epub)$/i.test(f.name));
      if (file) openLocalBook(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    // PWA file handling (installed app, Chromium)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async ({ files }) => {
        if (files?.length) openLocalBook(files[0]);
      });
    }
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedBook]);

  // Cmd+K keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearchOverlay(prev => !prev);
      }
      if (e.key === 'Escape') setShowSearchOverlay(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Search overlay handler with caching + parallel search
  const handleOverlaySearch = useCallback(async (q, forceLang = null) => {
    if (!q.trim()) {
      clearTimeout(searchDebounceRef.current);
      setSearchResults([]);
      setLocalSuggestions([]);
      return;
    }

    // Instant local suggestions — no network needed for these
    const activeLang = forceLang !== null ? forceLang : searchLangFilter;
    setLocalSuggestions(getLocalSuggestions(q, activeLang));

    // Check cache
    const cacheKey = `${q.toLowerCase().trim()}|${activeLang}`;
    if (searchCache.has(cacheKey)) {
      clearTimeout(searchDebounceRef.current);
      setSearchResults(searchCache.get(cacheKey));
      return;
    }

    // Debounce the network round-trip — typing fires one request for the
    // settled query instead of one per keystroke.
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      const searchId = ++overlaySearchId.current;
      setSearchLoading(true);
      try {
        // Parallel search: Gutenberg + Internet Archive
        const fetchers = [];

        if (activeLang !== 'hi') {
          fetchers.push(
            fetch(`https://gutendex.com/books/?search=${encodeURIComponent(q)}`)
              .then(r => r.json())
              .then(data => (data.results?.slice(0, 5) || []).map(b => ({
                ...b,
                authors: (b.authors || []).map(a => ({ ...a, name: formatAuthorName(a.name) })),
              })))
              .catch(() => [])
          );
        }

        if (activeLang !== 'en') {
          fetchers.push(
            fetchIASearch(q).catch(() => [])
          );
        }

        const allResults = await Promise.all(fetchers);
        // A slow response for an earlier keystroke must never overwrite the
        // results of the latest one.
        if (searchId !== overlaySearchId.current) return;
        const merged = allResults.flat();

        // Deduplicate
        const seen = new Set();
        const deduped = merged.filter(b => {
          const key = b.title.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/g, '').substring(0, 30);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 10);

        // Cache results
        searchCache.set(cacheKey, deduped);
        if (searchCache.size > 50) {
          const firstKey = searchCache.keys().next().value;
          searchCache.delete(firstKey);
        }

        setSearchResults(deduped);
      } catch { setSearchResults([]); }
      if (searchId === overlaySearchId.current) setSearchLoading(false);
    }, 350);
  }, [searchLangFilter]);

  const openBook = (book) => {
    scrollPositionRef.current = window.scrollY;
    // Lock once per modal lifetime — re-opening over an open modal (e.g.
    // clicking a card behind the overlay) must not double-lock the counter,
    // or closeBook can never release the page scroll.
    if (!selectedBook) lockPageScroll();
    setSelectedBook(book);
    setTimeout(() => setDetailAnim(true), 10);
  };

  const closeBook = () => {
    setDetailAnim(false);
    setTimeout(() => {
      setSelectedBook(null);
      unlockPageScroll();
      scrollToPosition(scrollPositionRef.current, { immediate: true });
    }, 400);
  };

  const startReading = () => {
    recordReadingDay();
    setStreak(getReadingStreak());

    // Save book metadata for library caching
    try {
      const libraryMeta = JSON.parse(localStorage.getItem('archivum_library_metadata') || '{}');
      libraryMeta[selectedBook.id] = {
        id: selectedBook.id,
        title: selectedBook.title,
        authors: selectedBook.authors,
        formats: selectedBook.formats,
        languages: selectedBook.languages,
        subjects: selectedBook.subjects,
        download_count: selectedBook.download_count,
        _source: selectedBook._source,
        _iaIdentifier: selectedBook._iaIdentifier,
        lastRead: Date.now(),
        progressPercent: libraryMeta[selectedBook.id]?.progressPercent || 0
      };
      localStorage.setItem('archivum_library_metadata', JSON.stringify(libraryMeta));
    } catch (e) {
      console.error("Error saving library metadata:", e);
    }

    // Cinematic book-open transition
    let coverUrl = selectedBook.formats?.['image/jpeg'];
    if (!coverUrl && selectedBook._source === 'archive') {
      const cached = localStorage.getItem(`cover_${selectedBook._iaIdentifier}`);
      coverUrl = (cached && cached !== 'notfound') ? cached : generateCover(selectedBook.title, selectedBook.authors?.[0]?.name, selectedBook.id);
    }
    if (!coverUrl) coverUrl = generateCover(selectedBook.title, selectedBook.authors?.[0]?.name, selectedBook.id);
    
    setBookOpenAnim(coverUrl);
    setTimeout(() => {
      setBookOpenAnim(null);
      setReaderOpen(true);
    }, 800);
  };

  if (readerOpen && selectedBook) {
    return (
      <>
        <NativeReader
          book={selectedBook}
          onClose={() => {
            setReaderOpen(false);
            updateOfflineStatus();
            setProgressMap(getReadingProgress());
          }}
          user={user}
        />
      </>
    );
  }

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    if (!supabase) {
      setAuthError('Authentication service is not configured.');
      setAuthLoading(false);
      return;
    }
    try {
      const isSignUp = authMode === 'signup';
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        setShowAuthModal(false);
        addToast("Account created successfully.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
        setShowAuthModal(false);
        addToast("Signed in successfully.");
      }
    } catch (err) {
      setAuthError(err.message || 'An error occurred.');
      addToast("Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    addToast("Logged out successfully.");
  };

  return (
    <div id="app" className="visible">
      <div className="noise-overlay" />
      <div className="ambient-glow" />

      {/* FLOATING NAV */}
      <div className="floating-nav-wrap">
        <div className={`floating-nav ${navVisible ? 'hidden' : ''}`}>
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.2em' }}>
            ARCHIVUM <span style={{ width: 6, height: 6, background: 'var(--ember)', borderRadius: '50%' }}></span>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          
          <button className="mono" onClick={() => { setView('catalog'); scrollToPosition(0, { immediate: false }); }} style={{ color: view === 'catalog' ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 0.2s' }}>CATALOG</button>
          <button className="mono" onClick={() => setView('library')} style={{ color: view === 'library' ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}><Library size={14}/> LIBRARY</button>
          <button className="mono" onClick={() => setView('saved')} style={{ color: view === 'saved' ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}><Heart size={14}/> SAVED {savedBooks.length > 0 && <span style={{ fontSize: '9px', background: 'var(--ember)', color: '#fff', borderRadius: '10px', padding: '1px 5px', lineHeight: 1.2 }}>{savedBooks.length}</span>}</button>
          <button className="mono" onClick={() => setView('stats')} style={{ color: view === 'stats' ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}><BarChart3 size={14}/> STATS</button>
          
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />

          <button onClick={() => setShowSearchOverlay(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', transition: 'color 0.2s' }} aria-label="Search catalog">
            <Search size={16} aria-hidden="true" /> <span className="search-overlay-hint">⌘K</span>
          </button>
          
          {user ? (
            <button onClick={handleLogout} className="mono" style={{ color: 'var(--text-muted)' }}>LOGOUT</button>
          ) : (
            <button className="mono" onClick={() => setShowAuthModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
              <User size={14} aria-hidden="true" /> SIGN IN
            </button>
          )}
        </div>
      </div>

      <div className="toast-container">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              className="toast"
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* HERO - Only show in catalog view */}
      {view === 'catalog' && (
        <section id="hero" style={{ position: 'relative', minHeight: '100dvh', paddingTop: '96px', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }} />
          <motion.div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            <div className="mono hero-side-label">GUTENBERG + INTERNET ARCHIVE</div>
          </motion.div>
          <div className="hero-inner" style={{ position: 'relative', zIndex: 3, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="mono" style={{ color: 'var(--ember)', marginBottom: '20px' }}>// THE FREE LIBRARY</span>
            <motion.h1 
              className="hero-title"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              ARCHIVUM
            </motion.h1>
            <p className="body-text" style={{ fontSize: '18px', color: 'var(--text-secondary)', maxWidth: '400px', margin: '32px 0', textAlign: 'center' }}>
              Millions of books from Project Gutenberg & Internet Archive. English, हिन्दी, and more. Free forever.
            </p>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '40px' }}>
              <MagneticButton className="btn-primary" onClick={() => scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight)}>EXPLORE THE CATALOG &rarr;</MagneticButton>
              <MagneticButton className="btn-ghost" onClick={() => setShowSearchOverlay(true)}>SEARCH &nbsp;⌘K</MagneticButton>
            </div>
            {/* Trending Strip */}
            {trendingBooks.length > 0 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '10px' }}>POPULAR RIGHT NOW</span>
                <div className="marquee-container">
                  <div className="marquee-content">
                    {/* Double the list for infinite seamless scrolling */}
                    {[...trendingBooks, ...trendingBooks].map((tb, idx) => (
                      <div key={tb.id + '-' + idx} className="trending-item" onClick={(e) => { e.stopPropagation(); openBook(tb); }}>
                        <DynamicCover book={tb} />
                        <span>{tb.title.split(':')[0].substring(0, 18)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div style={{ position: 'absolute', bottom: '40px', right: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: 0.5 }}>
              <ChevronDown size={20} className="bounce" />
              <span className="mono">SCROLL</span>
            </div>
          </div>
        </section>
      )}

      {/* MAIN VIEW */}
      <section id="main-view" style={{ padding: '80px 5vw', minHeight: '100dvh', position: 'relative', marginTop: view === 'library' ? '80px' : '0' }}>
        <div style={{ marginBottom: '60px', position: 'relative' }}>
          <span className="mono">{view === 'catalog' ? '01 — CATALOG' : view === 'stats' ? '03 — STATISTICS' : '02 — MY LIBRARY'}</span>
          <h2 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', margin: '8px 0' }}>
            {view === 'catalog' ? 'The Archive' : view === 'stats' ? 'Reading Stats' : view === 'saved' ? 'Saved Books' : 'Continue Reading'}
          </h2>
          <span className="mono text-secondary">
            {view === 'catalog' ? `Showing ${books.length + seBooks.length} works` : view === 'saved' ? `${savedBooks.length} saved books` : view === 'stats' ? 'Your reading journey' : `${libraryBooks.length} books in progress`}
          </span>
          {view === 'library' && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mono library-import-btn"
                aria-label="Import a .txt or .epub file from this device"
                style={{
                  position: 'absolute', right: 0, bottom: '4px',
                  padding: '10px 16px', fontSize: '10px', letterSpacing: '0.1em',
                  background: 'transparent', border: '1px solid var(--border)', borderRadius: '999px',
                  color: 'var(--text-secondary)', cursor: 'pointer'
                }}
              >
                + IMPORT .TXT / .EPUB
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.epub,text/plain,application/epub+zip"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) openLocalBook(f); e.target.value = ''; }}
              />
              {importError && (
                <div className="mono" role="alert" style={{ color: 'var(--ember)', fontSize: '11px', marginTop: '8px' }}>{importError}</div>
              )}
            </>
          )}
        </div>

        {/* STATS VIEW */}
        {view === 'stats' && (() => {
          const stats = getReadingStats();
          const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
          const uniqueDays = new Set(days);
          // Build heatmap data for last 365 days
          const heatmapData = [];
          const today = new Date();
          for (let i = 364; i >= 0; i--) {
            const d = new Date(today - i * 86400000);
            const ds = d.toDateString();
            heatmapData.push({ date: ds, active: uniqueDays.has(ds) });
          }
          const goalMinutes = dailyGoal;
          // Real minutes read today from the per-day log (the old value was a
          // lifetime-minutes guess capped at 15, so the ring was always wrong).
          const todayMinutes = getTodayMinutes();
          const goalPercent = (todayMinutes / goalMinutes) * 100;
          const goalR = 50, goalC = 2 * Math.PI * goalR;

          return (
            <div className="stats-container" style={{ padding: 0, marginTop: 0 }}>
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-card-icon"><Flame size={18} /></div>
                  <div className="stat-card-value" style={{ color: 'var(--ember)' }}>{stats.streak}</div>
                  <div className="stat-card-label">Day Streak</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon"><Clock size={18} /></div>
                  <div className="stat-card-value">{stats.totalMinutes > 60 ? `${Math.floor(stats.totalMinutes/60)}h` : `${stats.totalMinutes}m`}</div>
                  <div className="stat-card-label">Total Reading Time</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon"><BookOpen size={18} /></div>
                  <div className="stat-card-value">{stats.booksStarted}</div>
                  <div className="stat-card-label">Books Started</div>
                </div>
                <div className="stat-card">
                  <div className="stat-card-icon"><Heart size={18} /></div>
                  <div className="stat-card-value">{stats.savedCount}</div>
                  <div className="stat-card-label">Books Saved</div>
                </div>
              </div>

              {/* Reading Heatmap */}
              <div className="heatmap-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <span className="mono" style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>READING ACTIVITY — LAST 365 DAYS</span>
                  <span className="mono" style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{stats.totalDays} ACTIVE DAYS</span>
                </div>
                <div className="heatmap-grid">
                  {heatmapData.map((d, i) => (
                    <div key={i} className={`heatmap-cell ${d.active ? 'active-3' : ''}`} title={d.date} />
                  ))}
                </div>
              </div>

              {/* Reading Goal */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', marginTop: '24px' }}>
                <div className="goal-ring-container">
                  <svg className="goal-ring" viewBox="0 0 120 120">
                    <circle className="ring-bg" cx="60" cy="60" r={goalR} />
                    <circle className="ring-fill" cx="60" cy="60" r={goalR}
                      strokeDasharray={goalC} strokeDashoffset={goalC - (goalPercent / 100) * goalC} />
                    <text className="ring-text" x="60" y="55">{Math.round(goalPercent)}%</text>
                    <text x="60" y="72" textAnchor="middle" style={{ fontSize: '8px', fill: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>DAILY GOAL</text>
                  </svg>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="mono" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>DAILY TARGET:</span>
                  <select 
                    value={dailyGoal}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setDailyGoal(val);
                      localStorage.setItem('archivum_daily_goal', val);
                      addToast(`Daily target set to ${val} minutes.`);
                    }}
                    style={{
                      background: 'var(--bg-raised)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-primary)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '11px',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {[15, 30, 45, 60, 90, 120].map(mins => (
                      <option key={mins} value={mins} style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)' }}>{mins} MINS</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })()}

        {/* SAVED BOOKS VIEW */}
        {view === 'saved' && savedBooks.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Heart size={32} /></div>
            <h3>No Saved Books Yet</h3>
            <p>Tap the heart icon on any book to save it to your reading list for later.</p>
            <button className="btn-primary" onClick={() => { setView('catalog'); scrollToPosition(0, { immediate: false }); }}>BROWSE THE CATALOG &rarr;</button>
          </div>
        )}
        
        {view === 'library' && libraryLoading && (
          <div className="mono text-secondary" style={{ textAlign: 'center', padding: '40px' }}>Loading library...</div>
        )}

        {view === 'library' && !libraryLoading && libraryBooks.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><BookOpen size={32} /></div>
            <h3>Your Library is Empty</h3>
            <p>Start reading a book from the catalog and it will appear here so you can pick up right where you left off.</p>
            <button className="btn-primary" onClick={() => { setView('catalog'); scrollToPosition(0, { immediate: false }); }}>DISCOVER YOUR FIRST BOOK &rarr;</button>
          </div>
        )}
        
        <div className="book-cards-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '24px'
        }}>
          {/* Skeleton cards during loading */}
          {loading && books.length === 0 && view === 'catalog' && (
            Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)
          )}
          {(view === 'catalog' ? [...books, ...seBooks] : view === 'saved' ? savedBooks : view === 'library' ? libraryBooks : []).map(book => {
            let authorName = book.authors?.[0]?.name || 'Unknown';
            const lang = (book.languages?.[0] || 'en').toUpperCase();
            const subjectClean = book.subjects?.[0] ? cleanSubject(book.subjects[0]) : null;
            const bookProgress = progressMap[book.id];
            const popPercent = Math.min(100, Math.round((book.download_count / 80000) * 100));
            
            return (
              <div 
                key={book.id}
                className="book-card-tilt"
                onClick={() => openBook(book)}
                style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px',
                  overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                  transform: selectedBook 
                    ? (selectedBook.id === book.id ? 'scale(1.02)' : 'scale(0.92)') 
                    : 'scale(1) translateY(0)',
                  opacity: selectedBook ? (selectedBook.id === book.id ? 1 : 0.3) : 1,
                  transition: 'transform 0.45s var(--ease-out-expo), opacity 0.35s ease, box-shadow 0.45s var(--ease-out-expo)',
                  pointerEvents: selectedBook ? 'none' : 'auto',
                  animation: 'fadeInUp 0.5s var(--ease-out-expo) both'
                }}
                onMouseEnter={e => {
                  if (selectedBook) return;
                  e.currentTarget.style.transform = 'translateY(-12px) scale(1.02)';
                  e.currentTarget.style.boxShadow = '0 24px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(224,78,42,0.12)';
                }}
                onMouseLeave={e => {
                  if (selectedBook) return;
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <div className="card-cover-wrap">
                  <DynamicCover book={book} style={{ width: '100%', aspectRatio: '2/3', background: 'var(--bg-raised)' }} />
                  <button className={`save-btn ${isBookSaved(book.id) ? 'saved' : ''} ${justSavedId === book.id ? 'just-saved' : ''}`} onClick={(e) => toggleSaveBook(book, e)} aria-label={isBookSaved(book.id) ? "Remove from saved" : "Save book"}>
                    <Heart size={14} fill={isBookSaved(book.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                  </button>
                  {bookProgress !== undefined && <ProgressRing percent={Math.min(99, bookProgress)} />}
                </div>
                <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="lang-badge">{lang}</span>
                      {book._source === 'archive' && <span className="source-badge ia">IA</span>}
                      {offlineBookIds.has(book.id) && <span className="source-badge ia" style={{ background: 'rgba(191, 155, 90, 0.15)', borderColor: 'rgba(191, 155, 90, 0.25)', color: 'var(--gold)' }} title="Available Offline">OFFLINE</span>}
                    </div>
                    {subjectClean && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{subjectClean.toUpperCase()}</span>}
                  </div>
                  <h3 className="display" style={{ fontSize: '17px', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontFamily: lang === 'HI' || lang === 'HIN' ? "'Noto Sans Devanagari', 'Playfair Display', serif" : undefined }}>{book.title}</h3>
                  <div className="mono" style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{authorName}</div>
                  <div style={{ height: '1px', background: 'var(--border)', margin: 'auto 0 12px' }}></div>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ transition: 'color 0.3s, letter-spacing 0.3s' }}>READ &rarr;</span>
                    <div className="popularity-bar">
                      <div className="popularity-bar-track"><div className="popularity-bar-fill" style={{ width: `${popPercent}%` }} /></div>
                      <span className="text-secondary" style={{ fontSize: '9px' }}>{book.download_count > 1000 ? (book.download_count/1000).toFixed(1)+'k' : book.download_count}</span>
                    </div>
                  </div>
                </div>
                {bookProgress !== undefined && <div className="card-progress-bar"><div className="card-progress-bar-fill" style={{ width: `${Math.min(99, bookProgress)}%` }} /></div>}
              </div>
            )
          })}
          {/* Skeleton cards during infinite scroll */}
          {loading && books.length > 0 && view === 'catalog' && (
            Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={`sk-more-${i}`} />)
          )}
        </div>
        
        {view === 'catalog' && (
          <div ref={loaderRef} style={{ textAlign: 'center', padding: '40px', display: loading ? 'block' : 'none' }} className="mono text-secondary">
            Loading more...
          </div>
        )}
      </section>

      {/* BOOK DETAIL PANEL */}
      <div className="detail-panel-overlay" style={{
        position: 'fixed', inset: 0, zIndex: 500, pointerEvents: selectedBook ? 'auto' : 'none',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end'
      }}>
        <div 
          onClick={closeBook}
          style={{ 
            position: 'absolute', inset: 0, backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.4)', 
            opacity: selectedBook ? 1 : 0, transition: 'opacity 0.5s' 
          }} 
        />
        <div className="detail-panel-container" ref={detailPanelRef} style={{
          position: 'relative', background: 'var(--bg-overlay)', borderTop: '1px solid var(--border)',
          height: '70vh', transform: selectedBook ? 'translateY(0)' : 'translateY(100%)', 
          transition: 'transform 0.45s cubic-bezier(0.32, 0, 0, 1)',
          display: 'flex', padding: '60px', gap: '60px'
        }}>
          {selectedBook && (
            <div className="detail-panel" style={{ opacity: detailAnim ? 1 : 0, transform: detailAnim ? 'translateY(0)' : 'translateY(20px)', transition: 'opacity 0.4s ease, transform 0.4s ease' }}>
              <button onClick={closeBook} className="detail-close-btn" style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '32px', color: 'var(--text-secondary)' }} aria-label="Close details">&times;</button>
              
              <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
                <DynamicCover 
                  book={selectedBook}
                  style={{ width: '100%', maxWidth: '280px', aspectRatio: '2/3', objectFit: 'cover', boxShadow: '20px 20px 40px rgba(0,0,0,0.6)', borderRadius: '4px' }} 
                />
              </div>

              <div className="detail-info-col" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', overflowY: 'auto', paddingBottom: '40px' }}>
                <div className="mono text-secondary" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <span>WORK № {selectedBook.id.toString().padStart(5, '0')}</span>
                  <span className="lang-badge">{(selectedBook.languages?.[0] || 'en').toUpperCase()}</span>
                  <span>~{Math.max(30, Math.round((selectedBook.download_count || 0) / 500))} MIN READ</span>
                </div>
                <h2 className="display" style={{ fontSize: 'clamp(1.8rem, 3vw, 3rem)', margin: '12px 0 8px' }}>{selectedBook.title}</h2>
                <div className="mono" style={{ color: 'var(--gold)' }}>{selectedBook.authors?.[0]?.name || 'Unknown'}</div>
                {selectedBook.authors?.[0]?.birth_year && (
                  <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '10px', marginTop: '4px' }}>{selectedBook.authors[0].birth_year}–{selectedBook.authors[0].death_year || 'present'}</div>
                )}
                
                <hr style={{ border: 'none', height: '1px', background: 'var(--ember)', width: '40px', margin: '24px 0' }} />
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                  {selectedBook.subjects?.slice(0, 6).map(sub => (
                    <span key={sub} className="detail-tag">
                      {cleanSubject(sub)}
                    </span>
                  ))}
                </div>
                {selectedBook.bookshelves?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                    {selectedBook.bookshelves.slice(0, 3).map(bs => (
                      <span key={bs} className="mono" style={{ fontSize: '9px', color: 'var(--gold)', padding: '3px 8px', border: '1px solid rgba(191,155,90,0.2)', borderRadius: '8px' }}>{bs}</span>
                    ))}
                  </div>
                )}
                
                <div className="mono text-secondary" style={{ marginBottom: '8px' }}>{selectedBook.download_count?.toLocaleString() || '0'} readers worldwide</div>
                <div style={{ flex: 1, minHeight: '24px' }}></div>
                
                <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '8px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn-primary" onClick={startReading} style={{ flex: 1, fontSize: '16px', padding: '18px' }}>
                      {progressMap[selectedBook.id] !== undefined ? 'CONTINUE READING \u2192' : 'OPEN & READ THIS BOOK \u2192'}
                    </button>
                    <button className={`detail-save-btn ${isBookSaved(selectedBook.id) ? 'saved' : ''}`} onClick={(e) => toggleSaveBook(selectedBook, e)} style={{ padding: '18px' }}>
                      <Heart size={18} fill={isBookSaved(selectedBook.id) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  {progressMap[selectedBook.id] !== undefined && (
                    <button 
                      className="btn-ghost" 
                      onClick={() => removeBookProgress(selectedBook.id)} 
                      style={{ 
                        padding: '12px', 
                        fontSize: '11px', 
                        color: 'var(--ember)', 
                        borderColor: 'rgba(224, 78, 42, 0.2)',
                        width: '100%',
                        letterSpacing: '0.05em',
                        fontFamily: "'JetBrains Mono', monospace"
                      }}
                    >
                      RESET PROGRESS &amp; REMOVE FROM LIBRARY
                    </button>
                  )}
                </div>
                
                <a href={selectedBook._source === 'archive' ? `https://archive.org/details/${selectedBook._iaIdentifier}` : `https://gutenberg.org/ebooks/${selectedBook.id}`} target="_blank" rel="noreferrer" className="mono text-secondary" style={{ textDecoration: 'none' }}>{selectedBook._source === 'archive' ? 'VIEW ON ARCHIVE.ORG' : 'VIEW ON GUTENBERG'} &nearr;</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AUTH MODAL */}
      {showAuthModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }} onClick={() => setShowAuthModal(false)}>
          <div ref={authModalRef} role="dialog" aria-modal="true" aria-label={authMode === 'login' ? 'Sign in' : 'Create account'} style={{ position: 'relative', background: 'var(--bg-surface)', padding: '40px', border: '1px solid var(--border)', borderRadius: '8px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '20px' }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowAuthModal(false)} aria-label="Close sign-in dialog" style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '24px', color: 'var(--text-secondary)' }}>&times;</button>
            <h3 className="display" style={{ fontSize: '24px', margin: 0 }}>{authMode === 'login' ? 'Sign In' : 'Create Account'}</h3>
            {authError && <div className="mono" style={{ color: 'var(--ember)', fontSize: '11px' }}>{authError}</div>}
            <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <input className="auth-input" type="email" placeholder="Email" value={authEmail} onChange={e=>setAuthEmail(e.target.value)} required />
              <input className="auth-input" type="password" placeholder="Password" value={authPassword} onChange={e=>setAuthPassword(e.target.value)} required />
              <button type="submit" className="btn-primary" style={{ padding: '14px' }}>{authLoading ? '...' : (authMode === 'login' ? 'LOGIN' : 'SIGN UP')}</button>
            </form>
            <div className="mono text-secondary" style={{ textAlign: 'center', fontSize: '11px' }}>
              {authMode === 'login' ? 'New here? ' : 'Already have an account? '}
              <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }} style={{ color: 'var(--text-primary)', textDecoration: 'underline' }}>
                {authMode === 'login' ? 'Sign up' : 'Log in'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CMD+K SEARCH OVERLAY */}
      {showSearchOverlay && (
        <div className="search-overlay-backdrop" onClick={() => setShowSearchOverlay(false)}>
          <div ref={searchOverlayRef} className="search-overlay-modal" onClick={e => e.stopPropagation()}>
            <div className="search-overlay-input-wrap">
              <Search size={20} />
              <input
                className="search-overlay-input"
                autoFocus
                type="text"
                placeholder="Search books in English, Hindi..."
                value={overlayQuery}
                onChange={e => { setOverlayQuery(e.target.value); handleOverlaySearch(e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowSearchOverlay(false);
                  if (e.key === 'ArrowDown') setActiveSearchIndex(i => Math.min(i + 1, searchResults.length - 1));
                  if (e.key === 'ArrowUp') setActiveSearchIndex(i => Math.max(i - 1, 0));
                  if (e.key === 'Enter') {
                    if (searchResults[activeSearchIndex]) {
                      openBook(searchResults[activeSearchIndex]);
                      setShowSearchOverlay(false);
                    } else {
                      setQuery(overlayQuery);
                      setView('catalog');
                      setShowSearchOverlay(false);
                      scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight);
                    }
                  }
                }}
                aria-activedescendant={searchResults[activeSearchIndex] ? `search-result-${activeSearchIndex}` : undefined}
              />
              <span className="search-overlay-hint">ESC</span>
            </div>
            {/* Language filter tabs in search */}
            <div className="search-lang-tabs">
              {[{ key: '', label: 'All' }, { key: 'en', label: 'English' }, { key: 'hi', label: 'हिन्दी' }].map(l => (
                <button
                  key={l.key}
                  className={`search-lang-tab ${searchLangFilter === l.key ? 'active' : ''}`}
                  onClick={() => { setSearchLangFilter(l.key); handleOverlaySearch(overlayQuery, l.key); }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="search-overlay-results" role="listbox" aria-label="Search results">
              {/* Local suggestion chips (instant) */}
              {localSuggestions.length > 0 && overlayQuery && (
                <div className="search-suggestions">
                  <span className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)', padding: '0 24px' }}>SUGGESTIONS</span>
                  <div className="suggestion-chips">
                    {localSuggestions.map((s, i) => (
                      <button
                        key={i}
                        className="suggestion-chip"
                        onClick={() => { setOverlayQuery(s.title); handleOverlaySearch(s.title); }}
                      >
                        {s.title}{s.author ? ` — ${s.author}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {searchLoading && <div className="search-overlay-empty"><div className="mono text-secondary">SEARCHING...</div></div>}
              {!searchLoading && searchResults.length === 0 && overlayQuery && localSuggestions.length === 0 && (
                <div className="search-overlay-empty">
                  <div className="mono text-secondary">NO RESULTS FOR "{overlayQuery.toUpperCase()}"</div>
                </div>
              )}
              {!searchLoading && searchResults.map((book, idx) => (
                <div
                  key={book.id}
                  id={`search-result-${idx}`}
                  role="option"
                  aria-selected={idx === activeSearchIndex}
                  className={`search-result-item ${idx === activeSearchIndex ? 'active' : ''}`}
                  onClick={() => { openBook(book); setShowSearchOverlay(false); }}
                  onMouseEnter={() => setActiveSearchIndex(idx)}
                >
                  <DynamicCover book={book} style={{ width: '40px', height: '60px', objectFit: 'cover', borderRadius: '4px', background: 'var(--bg-raised)', flexShrink: 0 }} />
                  <div className="search-result-info">
                    <div className="search-result-title">{book.title}</div>
                    <div className="search-result-author">
                      {book.authors?.[0]?.name || 'Unknown'}
                      {book._source === 'archive' && <span className="source-badge ia" style={{ marginLeft: '8px' }}>IA</span>}
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
              ))}
              {!overlayQuery && !searchLoading && (
                <div className="search-overlay-empty">
                  <div className="mono text-muted" style={{ fontSize: '11px', marginBottom: '16px' }}>POPULAR SEARCHES</div>
                  <div className="suggestion-chips" style={{ justifyContent: 'center' }}>
                    {['Pride and Prejudice', 'गोदान', 'Sherlock Holmes', 'रामचरितमानस', 'Shakespeare', 'Premchand'].map(s => (
                      <button key={s} className="suggestion-chip" onClick={() => { setOverlayQuery(s); handleOverlaySearch(s); }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="search-overlay-footer">
              <span><kbd>↑↓</kbd> Navigate</span>
              <span><kbd>↵</kbd> Open</span>
              <span><kbd>ESC</kbd> Close</span>
            </div>
          </div>
        </div>
      )}

      {/* BOOK OPEN CINEMATIC TRANSITION */}
      {bookOpenAnim && (
        <div className="book-open-transition">
          <img src={bookOpenAnim} className="book-open-cover" alt="" style={{ width: '200px', aspectRatio: '2/3', objectFit: 'cover' }} />
        </div>
      )}

      {/* GENRE SCROLL STRIP (visible at catalog section heading) */}
      {view === 'catalog' && (
        <div className="genre-scroll-strip" style={{ padding: '0 5vw', marginTop: '-40px', marginBottom: '20px' }}>
          {/* Language filter pills */}
          <button
            className={`genre-pill lang-pill ${langFilter === '' ? 'active' : ''}`}
            onClick={() => setLangFilter('')}
          >
            <Globe size={11} /> ALL
          </button>
          <button
            className={`genre-pill lang-pill ${langFilter === 'en' ? 'active' : ''}`}
            onClick={() => setLangFilter('en')}
          >
            ENGLISH
          </button>
          <button
            className={`genre-pill lang-pill ${langFilter === 'hi' ? 'active' : ''}`}
            onClick={() => setLangFilter('hi')}
            style={{ fontFamily: "'Noto Sans Devanagari', 'JetBrains Mono', monospace" }}
          >
            हिन्दी
          </button>
          <div style={{ width: '1px', height: '20px', background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />
          {/* Genre pills */}
          {['', 'fiction', 'drama', 'poetry', 'philosophy', 'history', 'science', 'adventure'].map(g => (
            <button
              key={g}
              className={`genre-pill ${genre === g ? 'active' : ''}`}
              onClick={() => setGenre(g)}
            >
              {g ? g.toUpperCase() : 'ALL GENRES'}
            </button>
          ))}
        </div>
      )}

      {/* FOOTER */}
      <footer className="site-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <h3>Archivum</h3>
            <p>A beautiful, distraction-free reader for millions of free books from Project Gutenberg & Internet Archive.</p>
            <div className="footer-stats">
              <div className="footer-stat">
                <span className="footer-stat-value">1M+</span>
                <span className="footer-stat-label">Books</span>
              </div>
              <div className="footer-stat">
                <span className="footer-stat-value">Free</span>
                <span className="footer-stat-label">Forever</span>
              </div>
              {streak > 0 && <div className="footer-stat">
                <span className="footer-stat-value">{streak}</span>
                <span className="footer-stat-label">Day Streak</span>
              </div>}
            </div>
          </div>
          <div className="footer-col">
            <h4>Collections</h4>
            <button onClick={() => { setGenre('fiction'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Fiction</button>
            <button onClick={() => { setGenre('philosophy'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Philosophy</button>
            <button onClick={() => { setGenre('poetry'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Poetry</button>
            <button onClick={() => { setGenre('drama'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Drama</button>
          </div>
          <div className="footer-col">
            <h4>Discover</h4>
            <button onClick={() => { setGenre('history'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>History</button>
            <button onClick={() => { setGenre('science'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Science</button>
            <button onClick={() => { setGenre('adventure'); setView('catalog'); scrollToPosition(document.getElementById('main-view')?.offsetTop || window.innerHeight); }}>Adventure</button>
            <button onClick={() => setShowSearchOverlay(true)}>Search All</button>
          </div>
          <div className="footer-col">
            <h4>About</h4>
            <a href="https://gutenberg.org" target="_blank" rel="noreferrer">Project Gutenberg</a>
              <a href="https://archive.org" target="_blank" rel="noreferrer">Internet Archive</a>
              <a href="https://gutenberg.org/donate/" target="_blank" rel="noreferrer">Donate</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>ARCHIVUM © {new Date().getFullYear()}</span>
          <span>POWERED BY PROJECT GUTENBERG & INTERNET ARCHIVE</span>
        </div>
      </footer>

      {/* MOBILE BOTTOM NAV */}
      <nav className="mobile-bottom-nav">
        <button className={`mobile-nav-item ${view === 'catalog' ? 'active' : ''}`} onClick={() => { setView('catalog'); scrollToPosition(0, { immediate: false }); }}>
          <Home size={20} />
          <span>Home</span>
        </button>
        <button className={`mobile-nav-item`} onClick={() => setShowSearchOverlay(true)}>
          <Search size={20} />
          <span>Search</span>
        </button>
        <button className={`mobile-nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>
          <Library size={20} />
          <span>Library</span>
        </button>
        <button className={`mobile-nav-item ${view === 'saved' ? 'active' : ''}`} onClick={() => setView('saved')}>
          <Heart size={20} />
          <span>Saved</span>
        </button>
        <button className={`mobile-nav-item ${view === 'stats' ? 'active' : ''}`} onClick={() => setView('stats')}>
          <BarChart3 size={20} />
          <span>Stats</span>
        </button>
        <button className={`mobile-nav-item`} onClick={() => user ? handleLogout() : setShowAuthModal(true)}>
          <User size={20} />
          <span>{user ? 'Account' : 'Sign In'}</span>
        </button>
      </nav>
    </div>
  );
}

// Wrap App in ErrorBoundary for export
const AppWithErrorBoundary = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

export default AppWithErrorBoundary;
