import React, { useState, useEffect, useCallback, useRef, Component } from 'react';
import NativeReader from './components/NativeReader';
import { Search, ChevronDown, User, Library, BookOpen, Home, Settings, ArrowRight, Command, CornerDownLeft, X, Globe, Filter, Heart, BarChart3, Clock, Flame, BookMarked } from 'lucide-react';
import { supabase } from './supabaseClient';
import { motion, AnimatePresence } from 'framer-motion';
import Lenis from 'lenis';

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

const getReadingStreak = () => {
  try {
    const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
    const today = new Date().toDateString();
    const uniqueDays = [...new Set(days)];
    if (!uniqueDays.includes(today)) return uniqueDays.length > 0 ? uniqueDays.length : 0;
    let streak = 0;
    const d = new Date();
    for (let i = 0; i < 365; i++) {
      const ds = new Date(d - i * 86400000).toDateString();
      if (uniqueDays.includes(ds)) streak++;
      else if (i > 0) break;
    }
    return streak;
  } catch { return 0; }
};

const recordReadingDay = () => {
  try {
    const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
    const today = new Date().toDateString();
    if (!days.includes(today)) {
      days.push(today);
      if (days.length > 365) days.shift();
      localStorage.setItem('archivum_reading_days', JSON.stringify(days));
    }
  } catch {}
};

const getReadingProgress = () => {
  const progress = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('archivum_progress_')) {
      const bookId = key.replace('archivum_progress_', '');
      progress[bookId] = parseInt(localStorage.getItem(key)) || 0;
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

  const fallback = generateCover(book.title, book.authors?.[0]?.name || 'Unknown', book.id);
  const finalSrc = coverUrl && coverUrl !== 'notfound' ? coverUrl : fallback;

  return (
    <div style={{ position: 'relative', display: 'flex', ...style }} className={className}>
      {loading && <div className="image-shimmer" style={{ position: 'absolute', inset: 0, borderRadius: style?.borderRadius || 0 }} aria-hidden="true" />}
      <img 
        src={finalSrc} 
        alt={book.title} 
        style={{ width: '100%', height: '100%', objectFit: style?.objectFit || 'cover', borderRadius: style?.borderRadius || 0, display: 'block' }} 
        loading="lazy" 
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
      />
    </div>
  );
};

// ========== INTERNET ARCHIVE API ==========

const IA_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const IA_COVER_URL = 'https://archive.org/services/img';

const normalizeIABook = (doc) => {
  const identifier = doc.identifier;
  const creatorRaw = doc.creator;
  const authorName = Array.isArray(creatorRaw) ? creatorRaw[0] : (creatorRaw || 'Unknown');
  const langRaw = doc.language;
  const lang = Array.isArray(langRaw) ? langRaw[0] : (langRaw || 'hin');
  const langCode = lang.length <= 3 ? lang.toLowerCase() : (lang.toLowerCase() === 'hindi' ? 'hi' : 'en');
  const subjects = Array.isArray(doc.subject) ? doc.subject : (doc.subject ? [doc.subject] : []);

  return {
    id: `ia_${identifier}`,
    _iaIdentifier: identifier,
    _source: 'archive',
    title: doc.title || 'Untitled',
    authors: [{ name: authorName }],
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

const fetchWithProxy = async (url, responseType = 'json') => {
  const proxyMakers = [
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
      if (responseType === 'json') {
        const text = await res.text();
        return JSON.parse(text);
      }
      return await res.text();
    } catch (e) {
      continue;
    }
  }
  throw new Error(`All proxies failed for: ${url}`);
};

const fetchIABooks = async (searchQuery = '', pageNum = 1, langFilter = '', genreFilter = '') => {
  // Filter for actual books: require 'texts' mediatype + book-related collections
  // Exclude known non-book collections (policies, reports, government docs)
  let q = 'mediatype:texts AND (collection:opensource OR collection:books OR collection:gutenberg OR collection:additional_collections)';
  q += ' AND NOT collection:governmentpublications AND NOT collection:usgovernmentdocuments';
  q += ' AND NOT title:(policy OR "terms of use" OR "privacy policy" OR "annual report" OR "financial statement")';
  
  if (langFilter === 'hi') {
    q += ' AND language:(Hindi OR hin)';
  } else if (langFilter === 'en') {
    q += ' AND language:(English OR eng OR en)';
  }
  if (searchQuery) {
    q += ` AND (title:(${searchQuery}) OR creator:(${searchQuery}))`;
  } else {
    // Default: popular Hindi + multilingual literature
    if (!langFilter) q += ' AND language:(Hindi OR hin OR English OR eng)';
  }
  
  if (genreFilter) {
    q += ` AND subject:(${genreFilter})`;
  }

  const rows = 20;
  const url = `${IA_SEARCH_URL}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&fl[]=date&fl[]=subject&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&page=${pageNum}&output=json`;

  const data = await fetchWithProxy(url, 'json');
  const docs = data?.response?.docs || [];
  const numFound = data?.response?.numFound || 0;
  
  // Post-filter: remove items that look like non-books
  const junkPatterns = /policy|terms of (use|service)|privacy|annual report|financial|memorandum|regulation|guideline|compliance/i;
  const filtered = docs.filter(doc => {
    const title = doc.title || '';
    return !junkPatterns.test(title) && title.length > 1;
  });
  
  return {
    results: filtered.map(normalizeIABook),
    hasMore: (pageNum * rows) < numFound,
    total: numFound,
  };
};

const fetchIASearch = async (query) => {
  if (!query.trim()) return [];
  const url = `${IA_SEARCH_URL}?q=mediatype:texts+AND+(title:(${encodeURIComponent(query)})+OR+creator:(${encodeURIComponent(query)}))&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=language&fl[]=downloads&sort[]=downloads+desc&rows=6&page=1&output=json`;
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
  const cursorRef = useRef(null);
  const scrollPositionRef = useRef(0);
  const currentFetchId = useRef(0);
  const loadingRef = useRef(false);

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
        const bookId = parseInt(key.split('_').pop(), 10);
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
      await supabase.from('reading_progress').upsert(rows, { onConflict: 'user_id,book_id' });
      // Clear migrated items
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key.startsWith('archivum_highlights_') || key.startsWith('archivum_bookmarks_') || key.startsWith('archivum_progress_')) {
          localStorage.removeItem(key);
        }
      }
    }
  };

  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) {
      if (cursorRef.current) cursorRef.current.style.display = 'none';
      return;
    }

    const handleMouseMove = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      }
    };
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.body.style.cursor = 'none';

    // Hover logic
    const handleMouseOver = (e) => {
      if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        document.body.classList.add('cursor-hover');
      } else {
        document.body.classList.remove('cursor-hover');
      }
    };
    document.addEventListener('mouseover', handleMouseOver);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseover', handleMouseOver);
      document.body.style.cursor = 'auto';
    };
  }, []);

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
          results: (data.results || []).filter(b => b && b.title),
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, [hasMore, page, iaPage, query, genre, langFilter]);

  const fetchLibrary = useCallback(async () => {
    setLibraryLoading(true);
    let ids = [];
    if (user && supabase) {
      try {
        const { data } = await supabase.from('reading_progress').select('book_id').eq('user_id', user.id);
        if (data) ids = data.map(d => d.book_id);
      } catch (e) { console.error(e); }
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('archivum_progress_')) {
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
    
    try {
      const res = await fetch(`https://gutendex.com/books?ids=${ids.join(',')}`);
      const data = await res.json();
      setLibraryBooks(data.results);
    } catch(e) { console.error(e); }
    setLibraryLoading(false);
  }, [user]);

  useEffect(() => {
    if (view === 'library') fetchLibrary();
  }, [view, fetchLibrary]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, []);

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
    if (!q.trim()) { setSearchResults([]); setLocalSuggestions([]); return; }
    
    // Instant local suggestions
    const activeLang = forceLang !== null ? forceLang : searchLangFilter;
    setLocalSuggestions(getLocalSuggestions(q, activeLang));
    
    // Check cache
    const cacheKey = `${q.toLowerCase().trim()}|${activeLang}`;
    if (searchCache.has(cacheKey)) {
      setSearchResults(searchCache.get(cacheKey));
      return;
    }

    setSearchLoading(true);
    try {
      // Parallel search: Gutenberg + Internet Archive
      const fetchers = [];
      
      if (activeLang !== 'hi') {
        fetchers.push(
          fetch(`https://gutendex.com/books/?search=${encodeURIComponent(q)}`)
            .then(r => r.json())
            .then(data => data.results?.slice(0, 5) || [])
            .catch(() => [])
        );
      }
      
      if (activeLang !== 'en') {
        fetchers.push(
          fetchIASearch(q).catch(() => [])
        );
      }

      const allResults = await Promise.all(fetchers);
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
    setSearchLoading(false);
  }, [searchLangFilter]);

  const openBook = (book) => {
    scrollPositionRef.current = window.scrollY;
    window.__lenis?.stop();
    setSelectedBook(book);
    document.body.style.overflow = 'hidden';
    document.body.classList.remove('cursor-read');
    setTimeout(() => setDetailAnim(true), 10);
  };

  const closeBook = () => {
    setDetailAnim(false);
    setTimeout(() => {
      setSelectedBook(null);
      document.body.style.overflow = 'auto';
      window.__lenis?.start();
      window.scrollTo(0, scrollPositionRef.current);
      window.__lenis?.scrollTo(scrollPositionRef.current, { immediate: true });
    }, 400);
  };

  const startReading = () => {
    recordReadingDay();
    setStreak(getReadingStreak());
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
        <div id="cursor-dot" ref={cursorRef}></div>
        <NativeReader 
          book={selectedBook}
          onClose={() => { setReaderOpen(false); document.body.style.overflow = 'auto'; }} 
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
      <div id="cursor-dot" ref={cursorRef}></div>
      
      {/* FLOATING NAV */}
      <div className="floating-nav-wrap">
        <div className={`floating-nav ${navVisible ? 'hidden' : ''}`}>
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.2em' }}>
            ARCHIVUM <span style={{ width: 6, height: 6, background: 'var(--ember)', borderRadius: '50%' }}></span>
          </div>
          <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
          
          <button className="mono" onClick={() => { setView('catalog'); window.__lenis?.scrollTo(0, { immediate: false }) || window.scrollTo(0, 0); }} style={{ color: view === 'catalog' ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 0.2s' }}>CATALOG</button>
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
        <section id="hero" style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }} />
          <motion.div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            <div className="mono" style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%) rotate(-90deg)', color: 'var(--text-secondary)', transformOrigin: 'left center' }}>GUTENBERG + INTERNET ARCHIVE</div>
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
              <MagneticButton className="btn-primary" onClick={() => window.__lenis?.scrollTo(window.innerHeight, { immediate: false }) || window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}>EXPLORE THE CATALOG &rarr;</MagneticButton>
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
      <section id="main-view" style={{ padding: '80px 5vw', minHeight: '100vh', position: 'relative', marginTop: view === 'library' ? '80px' : '0' }}>
        <div style={{ marginBottom: '60px' }}>
          <span className="mono">{view === 'catalog' ? '01 — CATALOG' : '02 — MY LIBRARY'}</span>
          <h2 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', margin: '8px 0' }}>{view === 'catalog' ? 'The Archive' : 'Continue Reading'}</h2>
          <span className="mono text-secondary">
            {view === 'catalog' ? `Showing ${books.length} works` : view === 'saved' ? `${savedBooks.length} saved books` : view === 'stats' ? 'Your reading journey' : `${libraryBooks.length} books in progress`}
          </span>
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
          const todayMinutes = Math.min(goalMinutes, stats.totalMinutes > 0 ? Math.min(goalMinutes, 15) : 0); // approximate
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
                      <option key={mins} value={mins}>{mins} MINS</option>
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
            <button className="btn-primary" onClick={() => { setView('catalog'); window.__lenis?.scrollTo(0, { immediate: false }) || window.scrollTo(0, 0); }}>BROWSE THE CATALOG &rarr;</button>
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
            <button className="btn-primary" onClick={() => { setView('catalog'); window.__lenis?.scrollTo(0, { immediate: false }) || window.scrollTo(0, 0); }}>DISCOVER YOUR FIRST BOOK &rarr;</button>
          </div>
        )}
        
        <div className="book-cards-grid" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '24px'
        }}>
          {/* Skeleton cards during loading */}
          {loading && books.length === 0 && view === 'catalog' && (
            Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)
          )}
          {(view === 'catalog' ? books : view === 'saved' ? savedBooks : libraryBooks).map(book => {
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
                  overflow: 'hidden', cursor: 'none', display: 'flex', flexDirection: 'column',
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
                  document.body.classList.add('cursor-read');
                }}
                onMouseLeave={e => {
                  if (selectedBook) return;
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                  document.body.classList.remove('cursor-read');
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
                    </div>
                    {subjectClean && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{subjectClean.toUpperCase()}</span>}
                  </div>
                  <h3 className="display" style={{ fontSize: '17px', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontFamily: lang === 'HI' || lang === 'HIN' ? "'Noto Sans Devanagari', 'Playfair Display', serif" : undefined }}>{book.title}</h3>
                  <div className="mono" style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{authorName.split(',')[0]}</div>
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
        <div className="detail-panel-container" style={{
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
                  <span>~{Math.max(30, Math.round(selectedBook.download_count / 500))} MIN READ</span>
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
                
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <button className="btn-primary" onClick={startReading} style={{ flex: 1, fontSize: '16px', padding: '18px' }}>
                    OPEN &amp; READ THIS BOOK &rarr;
                  </button>
                  <button className={`detail-save-btn ${isBookSaved(selectedBook.id) ? 'saved' : ''}`} onClick={(e) => toggleSaveBook(selectedBook, e)} style={{ padding: '18px' }}>
                    <Heart size={18} fill={isBookSaved(selectedBook.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <a href={selectedBook._source === 'archive' ? `https://archive.org/details/${selectedBook._iaIdentifier}` : `https://gutenberg.org/ebooks/${selectedBook.id}`} target="_blank" rel="noreferrer" className="mono text-secondary" style={{ textDecoration: 'none' }}>{selectedBook._source === 'archive' ? 'VIEW ON ARCHIVE.ORG' : 'VIEW ON GUTENBERG'} &nearr;</a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AUTH MODAL */}
      {showAuthModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)' }}>
          <div style={{ position: 'relative', background: 'var(--bg-surface)', padding: '40px', border: '1px solid var(--border)', borderRadius: '8px', width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <button onClick={() => setShowAuthModal(false)} style={{ position: 'absolute', top: '16px', right: '16px', fontSize: '24px', color: 'var(--text-secondary)' }}>&times;</button>
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
          <div className="search-overlay-modal" onClick={e => e.stopPropagation()}>
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
                      window.__lenis?.scrollTo(window.innerHeight, { immediate: false }) || window.scrollTo({ top: window.innerHeight, behavior: 'smooth' });
                    }
                  }
                }}
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
            <div className="search-overlay-results">
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
            <button onClick={() => { setGenre('fiction'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Fiction</button>
            <button onClick={() => { setGenre('philosophy'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Philosophy</button>
            <button onClick={() => { setGenre('poetry'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Poetry</button>
            <button onClick={() => { setGenre('drama'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Drama</button>
          </div>
          <div className="footer-col">
            <h4>Discover</h4>
            <button onClick={() => { setGenre('history'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>History</button>
            <button onClick={() => { setGenre('science'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Science</button>
            <button onClick={() => { setGenre('adventure'); setView('catalog'); window.__lenis?.scrollTo(window.innerHeight) || window.scrollTo(0, window.innerHeight); }}>Adventure</button>
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
        <button className={`mobile-nav-item ${view === 'catalog' ? 'active' : ''}`} onClick={() => { setView('catalog'); window.__lenis?.scrollTo(0, { immediate: false }) || window.scrollTo(0, 0); }}>
          <Home size={20} />
          <span>Home</span>
        </button>
        <button className={`mobile-nav-item`} onClick={() => setShowSearchOverlay(true)}>
          <Search size={20} />
          <span>Search</span>
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
