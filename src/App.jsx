import React, { useState, useEffect, useCallback, useRef } from 'react';
import NativeReader from './components/NativeReader';
import { Search, ChevronDown, User, Library, BookOpen, Home, Settings, ArrowRight, Command, CornerDownLeft, X } from 'lucide-react';
import { supabase } from './supabaseClient';

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
  const hue = hues[(id || 0) % hues.length];

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

  // Library State
  const [view, setView] = useState('catalog'); // 'catalog' | 'library'
  const [libraryBooks, setLibraryBooks] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Auth State
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const loaderRef = useRef(null);
  const cursorRef = useRef(null);

  // Search Overlay (Cmd+K)
  const [showSearchOverlay, setShowSearchOverlay] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  // Trending books for hero
  const [trendingBooks, setTrendingBooks] = useState([]);

  // Reading progress map { bookId: pageNum }
  const [progressMap, setProgressMap] = useState({});

  // Book-open cinematic transition
  const [bookOpenAnim, setBookOpenAnim] = useState(null);

  // Reading streak
  const [streak, setStreak] = useState(0);

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
    const handleMouseMove = (e) => {
      if (cursorRef.current) {
        cursorRef.current.style.left = e.clientX + 'px';
        cursorRef.current.style.top = e.clientY + 'px';
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
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
    if (loading || (!hasMore && isLoadMore)) return;
    setLoading(true);
    
    try {
      const currentPage = isLoadMore ? page + 1 : 1;
      let url = `https://gutendex.com/books/?page=${currentPage}`;
      if (query) url += `&search=${encodeURIComponent(query)}`;
      if (genre) url += `&topic=${encodeURIComponent(genre)}`;

      const res = await fetch(url);
      const data = await res.json();
      
      if (isLoadMore) {
        setBooks(prev => [...prev, ...data.results]);
        setPage(currentPage);
      } else {
        setBooks(data.results);
        setPage(1);
      }
      setHasMore(!!data.next);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, query, genre]);

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

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchBooks(false);
    }, 500);
    return () => clearTimeout(delayDebounce);
  }, [query, genre]); 

  useEffect(() => {
    const handleScroll = () => {
      setNavVisible(window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loading && hasMore) {
        fetchBooks(true);
      }
    }, { rootMargin: '400px' });
    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [loading, hasMore, fetchBooks]);

  // Load trending books on mount
  useEffect(() => {
    fetch('https://gutendex.com/books/?sort=popular&page=1')
      .then(r => r.json())
      .then(data => setTrendingBooks(data.results?.slice(0, 8) || []))
      .catch(() => {});
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

  // Search overlay handler
  const handleOverlaySearch = useCallback(async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSearchResults(data.results?.slice(0, 8) || []);
    } catch { setSearchResults([]); }
    setSearchLoading(false);
  }, []);

  const openBook = (book) => {
    setSelectedBook(book);
    document.body.style.overflow = 'hidden';
    document.body.classList.remove('cursor-read');
  };

  const closeBook = () => {
    setSelectedBook(null);
    document.body.style.overflow = 'auto';
  };

  const startReading = () => {
    recordReadingDay();
    setStreak(getReadingStreak());
    // Cinematic book-open transition
    const coverUrl = selectedBook.formats['image/jpeg'] || generateCover(selectedBook.title, selectedBook.authors?.[0]?.name, selectedBook.id);
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
    setAuthError('');
    if (!supabase) {
      setAuthError('Authentication service is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        setShowAuthModal(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
        setShowAuthModal(false);
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return (
    <div id="app" className="visible">
      <div id="cursor-dot" ref={cursorRef}></div>
      
      {/* NAV */}
      <header id="nav" className={navVisible ? 'visible' : ''} style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: '60px',
        background: 'rgba(6,6,10,0.92)', backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', padding: '0 40px', zIndex: 100,
        transform: navVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.4s ease'
      }}>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.2em' }}>
          ARCHIVUM <span style={{ width: 6, height: 6, background: 'var(--ember)', borderRadius: '50%' }}></span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <button onClick={() => setShowSearchOverlay(true)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 20px', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-muted)', fontFamily: 'Libre Baskerville, serif', fontSize: '14px', transition: 'border-color 0.2s' }}>
            <Search size={14} /> Search books... <span className="search-overlay-hint" style={{ marginLeft: '8px' }}>⌘K</span>
          </button>
          {streak > 0 && <span className="streak-badge"><span className="streak-fire">🔥</span> {streak} DAY STREAK</span>}
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginRight: '16px' }}>
            <button className="mono" onClick={() => { setView('catalog'); window.__lenis?.scrollTo(0, { immediate: false }) || window.scrollTo(0, 0); }} style={{ opacity: view === 'catalog' ? 1 : 0.5, borderBottom: view === 'catalog' ? '1px solid var(--gold)' : 'none' }}>CATALOG</button>
            <button className="mono" onClick={() => setView('library')} style={{ opacity: view === 'library' ? 1 : 0.5, borderBottom: view === 'library' ? '1px solid var(--gold)' : 'none', display: 'flex', alignItems: 'center', gap: '6px' }}><Library size={14}/> MY LIBRARY</button>
          </div>

          {view === 'catalog' && (
            <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
              {['', 'fiction', 'drama', 'poetry', 'philosophy'].map(g => (
                <button 
                  key={g} 
                  onClick={() => setGenre(g)}
                  style={{
                    padding: '6px 12px', borderRadius: '20px', fontFamily: 'JetBrains Mono', fontSize: '10px',
                    color: genre === g ? '#fff' : 'var(--text-secondary)',
                    background: genre === g ? 'var(--ember)' : 'transparent',
                    transition: 'background 0.3s, color 0.3s'
                  }}
                >
                  {g ? g.toUpperCase() : 'ALL'}
                </button>
              ))}
            </div>
          )}
          {user ? (
            <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span>{user.email}</span>
              <button onClick={handleLogout} style={{ color: 'var(--text-muted)' }}>LOGOUT</button>
            </div>
          ) : (
            <button className="mono" onClick={() => setShowAuthModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <User size={14} /> SIGN IN TO SAVE PROGRESS
            </button>
          )}
        </div>
      </header>

      {/* HERO - Only show in catalog view */}
      {view === 'catalog' && (
        <section id="hero" style={{ position: 'relative', height: '100vh', overflow: 'hidden', display: 'flex', alignItems: 'center' }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '60px 60px', zIndex: 1, pointerEvents: 'none'
          }} />
          <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
            <div className="display" style={{ position: 'absolute', right: '-5vw', top: '10vh', fontSize: '25vw', opacity: 0.06, color: 'var(--text-muted)', lineHeight: 1 }}>70,000</div>
            <div className="mono" style={{ position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%) rotate(-90deg)', color: 'var(--text-secondary)', transformOrigin: 'left center' }}>EST. 1971 — PROJECT GUTENBERG</div>
          </div>
          <div style={{ position: 'relative', zIndex: 3, paddingLeft: '15vw', width: '100%' }}>
            <span className="mono" style={{ color: 'var(--ember)' }}>// THE FREE LIBRARY</span>
            <h1 className="display" style={{ fontSize: 'clamp(3rem, 8vw, 9rem)', lineHeight: 0.95, margin: '20px 0' }}>
              Seventy<br />
              <em style={{ marginLeft: '8%' }}>Thousand</em><br />
              Stories.
            </h1>
            <p className="body-text" style={{ fontSize: '18px', color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '24px' }}>
              Every great book ever written. Free. Beautiful. Yours.
            </p>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
              <button className="btn-primary" onClick={() => window.__lenis?.scrollTo(window.innerHeight, { immediate: false }) || window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}>EXPLORE THE CATALOG &rarr;</button>
              <button className="btn-ghost" onClick={() => setShowSearchOverlay(true)}>SEARCH &nbsp;⌘K</button>
            </div>
            {/* Trending Strip */}
            {trendingBooks.length > 0 && (
              <div style={{ maxWidth: '600px' }}>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>POPULAR RIGHT NOW</span>
                <div className="trending-strip">
                  {trendingBooks.map(tb => (
                    <div key={tb.id} className="trending-item" onClick={(e) => { e.stopPropagation(); openBook(tb); }}>
                      <img src={tb.formats['image/jpeg'] || generateCover(tb.title, tb.authors?.[0]?.name, tb.id)} alt={tb.title} />
                      <span>{tb.title.split(':')[0].substring(0, 18)}</span>
                    </div>
                  ))}
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
            {view === 'catalog' ? `Showing ${books.length} works` : `${libraryBooks.length} books in progress`}
          </span>
        </div>
        
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
        
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '24px'
        }}>
          {/* Skeleton cards during loading */}
          {loading && books.length === 0 && view === 'catalog' && (
            Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)
          )}
          {(view === 'catalog' ? books : libraryBooks).map(book => {
            let authorName = book.authors?.[0]?.name || 'Unknown';
            let coverUrl = book.formats['image/jpeg'] || generateCover(book.title, authorName, book.id);
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
                  <img src={coverUrl} alt="Cover" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', background: 'var(--bg-raised)' }} loading="lazy" />
                  {bookProgress !== undefined && <ProgressRing percent={Math.min(99, bookProgress)} />}
                </div>
                <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
                    <span className="lang-badge">{lang}</span>
                    {subjectClean && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>{subjectClean.toUpperCase()}</span>}
                  </div>
                  <h3 className="display" style={{ fontSize: '17px', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.title}</h3>
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
      <div style={{
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
        <div style={{
          position: 'relative', background: 'var(--bg-overlay)', borderTop: '1px solid var(--border)',
          height: '70vh', transform: selectedBook ? 'translateY(0)' : 'translateY(100%)', 
          transition: 'transform 0.45s cubic-bezier(0.32, 0, 0, 1)',
          display: 'flex', padding: '60px', gap: '60px'
        }}>
          {selectedBook && (
            <>
              <button onClick={closeBook} style={{ position: 'absolute', top: '24px', right: '24px', fontSize: '32px', color: 'var(--text-secondary)' }}>&times;</button>
              
              <div style={{ flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
                <img 
                  src={selectedBook.formats['image/jpeg'] || generateCover(selectedBook.title, selectedBook.authors?.[0]?.name, selectedBook.id)} 
                  alt="Cover" 
                  style={{ width: '100%', maxWidth: '280px', aspectRatio: '2/3', objectFit: 'cover', boxShadow: '20px 20px 40px rgba(0,0,0,0.6)', borderRadius: '4px' }} 
                />
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', overflowY: 'auto', paddingBottom: '40px' }}>
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
                
                <div className="mono text-secondary" style={{ marginBottom: '8px' }}>{selectedBook.download_count.toLocaleString()} readers worldwide</div>
                <div style={{ flex: 1, minHeight: '24px' }}></div>
                
                <button className="btn-primary" onClick={startReading} style={{ width: '100%', fontSize: '16px', padding: '18px', marginBottom: '16px' }}>
                  OPEN &amp; READ THIS BOOK &rarr;
                </button>
                <a href={`https://gutenberg.org/ebooks/${selectedBook.id}`} target="_blank" rel="noreferrer" className="mono text-secondary" style={{ textDecoration: 'none' }}>VIEW ON GUTENBERG &nearr;</a>
              </div>
            </>
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
              <button type="submit" className="btn-primary" style={{ padding: '14px' }}>{authMode === 'login' ? 'LOGIN' : 'SIGN UP'}</button>
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
                placeholder="Search 70,000 books..."
                value={query}
                onChange={e => { setQuery(e.target.value); handleOverlaySearch(e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Escape') setShowSearchOverlay(false);
                  if (e.key === 'ArrowDown') setActiveSearchIndex(i => Math.min(i + 1, searchResults.length - 1));
                  if (e.key === 'ArrowUp') setActiveSearchIndex(i => Math.max(i - 1, 0));
                  if (e.key === 'Enter' && searchResults[activeSearchIndex]) {
                    openBook(searchResults[activeSearchIndex]);
                    setShowSearchOverlay(false);
                  }
                }}
              />
              <span className="search-overlay-hint">ESC</span>
            </div>
            <div className="search-overlay-results">
              {searchLoading && <div className="search-overlay-empty"><div className="mono text-secondary">SEARCHING...</div></div>}
              {!searchLoading && searchResults.length === 0 && query && (
                <div className="search-overlay-empty">
                  <div className="mono text-secondary">NO RESULTS FOR "{query.toUpperCase()}"</div>
                </div>
              )}
              {!searchLoading && searchResults.map((book, idx) => (
                <div
                  key={book.id}
                  className={`search-result-item ${idx === activeSearchIndex ? 'active' : ''}`}
                  onClick={() => { openBook(book); setShowSearchOverlay(false); }}
                  onMouseEnter={() => setActiveSearchIndex(idx)}
                >
                  <img src={book.formats['image/jpeg'] || generateCover(book.title, book.authors?.[0]?.name, book.id)} alt="" />
                  <div className="search-result-info">
                    <div className="search-result-title">{book.title}</div>
                    <div className="search-result-author">{book.authors?.[0]?.name || 'Unknown'}</div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--text-muted)' }} />
                </div>
              ))}
              {!query && !searchLoading && (
                <div className="search-overlay-empty">
                  <div className="mono text-muted" style={{ fontSize: '11px' }}>TYPE TO SEARCH TITLES, AUTHORS, SUBJECTS...</div>
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
          {['', 'fiction', 'drama', 'poetry', 'philosophy', 'history', 'science', 'adventure'].map(g => (
            <button
              key={g}
              className={`genre-pill ${genre === g ? 'active' : ''}`}
              onClick={() => setGenre(g)}
            >
              {g ? g.toUpperCase() : 'ALL'}
            </button>
          ))}
        </div>
      )}

      {/* FOOTER */}
      <footer className="site-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <h3>Archivum</h3>
            <p>A beautiful, distraction-free reader for 70,000+ free books from Project Gutenberg.</p>
            <div className="footer-stats">
              <div className="footer-stat">
                <span className="footer-stat-value">70K+</span>
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
            <a href="https://gutenberg.org/help/volunteers/" target="_blank" rel="noreferrer">Volunteer</a>
            <a href="https://gutenberg.org/donate/" target="_blank" rel="noreferrer">Donate</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>ARCHIVUM © {new Date().getFullYear()}</span>
          <span>POWERED BY PROJECT GUTENBERG</span>
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
        <button className={`mobile-nav-item ${view === 'library' ? 'active' : ''}`} onClick={() => setView('library')}>
          <Library size={20} />
          <span>Library</span>
        </button>
        <button className={`mobile-nav-item`} onClick={() => user ? handleLogout() : setShowAuthModal(true)}>
          <User size={20} />
          <span>{user ? 'Account' : 'Sign In'}</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
