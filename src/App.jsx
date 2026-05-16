import React, { useState, useEffect, useCallback, useRef } from 'react';
import NativeReader from './components/NativeReader';
import { Search, ChevronDown, User } from 'lucide-react';
import { supabase } from './supabaseClient';

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

  // Auth State
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'signup'
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const loaderRef = useRef(null);
  const cursorRef = useRef(null);

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
    setReaderOpen(true);
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
          <Search size={16} color="var(--text-muted)" />
          <input 
            type="text" 
            placeholder="search titles, authors, subjects..." 
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{
              background: 'none', border: 'none', borderBottom: '1px solid var(--text-muted)',
              color: 'var(--text-primary)', fontFamily: 'Libre Baskerville, serif', fontSize: '16px',
              padding: '8px 0', width: '300px', textAlign: 'center', outline: 'none'
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
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

      {/* HERO */}
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
          <p className="body-text" style={{ fontSize: '18px', color: 'var(--text-secondary)', maxWidth: '400px', marginBottom: '40px' }}>
            Every great book ever written. Free. Beautiful. Yours.
          </p>
          <div style={{ display: 'flex', gap: '16px' }}>
            <button className="btn-primary" onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}>EXPLORE THE CATALOG &rarr;</button>
          </div>
          <div style={{ position: 'absolute', bottom: '40px', right: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', opacity: 0.5 }}>
            <ChevronDown size={20} className="bounce" />
            <span className="mono">SCROLL</span>
          </div>
        </div>
      </section>

      {/* CATALOG */}
      <section id="catalog" style={{ padding: '80px 5vw', minHeight: '100vh', position: 'relative' }}>
        <div style={{ marginBottom: '60px' }}>
          <span className="mono">01 — CATALOG</span>
          <h2 className="display" style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', margin: '8px 0' }}>The Archive</h2>
          <span className="mono text-secondary">Showing {books.length} works</span>
        </div>
        
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '24px'
        }}>
          {books.map(book => {
            let authorName = book.authors?.[0]?.name || 'Unknown';
            let coverUrl = book.formats['image/jpeg'] || generateCover(book.title, authorName, book.id);
            
            return (
              <div 
                key={book.id} 
                onClick={() => openBook(book)}
                style={{
                  background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '4px',
                  overflow: 'hidden', cursor: 'none', display: 'flex', flexDirection: 'column',
                  transform: selectedBook 
                    ? (selectedBook.id === book.id ? 'scale(1.02)' : 'scale(0.92)') 
                    : 'scale(1) translateY(0)',
                  opacity: selectedBook ? (selectedBook.id === book.id ? 1 : 0.3) : 1,
                  transition: 'transform 0.3s ease, opacity 0.3s ease, box-shadow 0.3s',
                  pointerEvents: selectedBook ? 'none' : 'auto'
                }}
                onMouseEnter={e => {
                  if (selectedBook) return;
                  e.currentTarget.style.transform = 'translateY(-10px)';
                  e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.5)';
                  document.body.classList.add('cursor-read');
                }}
                onMouseLeave={e => {
                  if (selectedBook) return;
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                  document.body.classList.remove('cursor-read');
                }}
              >
                <img src={coverUrl} alt="Cover" style={{ width: '100%', aspectRatio: '2/3', objectFit: 'cover', background: 'var(--bg-raised)' }} loading="lazy" />
                <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                    <span>{book.id.toString().padStart(5, '0')}</span>
                    <span>{book.subjects?.[0]?.split(' ')[0].toUpperCase() || 'LIT'}</span>
                  </div>
                  <h3 className="display" style={{ fontSize: '17px', marginBottom: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{book.title}</h3>
                  <div className="mono" style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{authorName.split(',')[0]}</div>
                  <div style={{ height: '1px', background: 'var(--border)', margin: 'auto 0 12px' }}></div>
                  <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ transition: 'color 0.3s' }}>READ &rarr;</span>
                    <span className="text-secondary">{book.download_count > 1000 ? (book.download_count/1000).toFixed(1)+'k' : book.download_count} reads</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <div ref={loaderRef} style={{ textAlign: 'center', padding: '40px', display: loading ? 'block' : 'none' }} className="mono text-secondary">
          Loading more...
        </div>
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
                <div className="mono text-secondary">WORK № {selectedBook.id.toString().padStart(5, '0')}</div>
                <h2 className="display" style={{ fontSize: 'clamp(1.8rem, 3vw, 3rem)', margin: '12px 0 8px' }}>{selectedBook.title}</h2>
                <div className="mono" style={{ color: 'var(--gold)' }}>{selectedBook.authors?.[0]?.name || 'Unknown'}</div>
                
                <hr style={{ border: 'none', height: '1px', background: 'var(--ember)', width: '40px', margin: '24px 0' }} />
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '24px' }}>
                  {selectedBook.subjects?.slice(0, 4).map(sub => (
                    <span key={sub} style={{ background: 'var(--bg-raised)', padding: '6px 12px', borderRadius: '20px', fontFamily: 'JetBrains Mono', fontSize: '10px', color: 'var(--text-secondary)' }}>
                      {sub}
                    </span>
                  ))}
                </div>
                
                <div className="mono text-secondary">{selectedBook.download_count.toLocaleString()} readers</div>
                <div style={{ flex: 1, minHeight: '40px' }}></div>
                
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
    </div>
  );
}

export default App;
