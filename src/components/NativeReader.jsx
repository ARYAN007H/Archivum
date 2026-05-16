import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Settings, Maximize, Columns, Square, BookmarkPlus, Edit3, X } from 'lucide-react';
import { supabase } from '../supabaseClient';

const NativeReader = ({ book, onClose, user }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const [page, setPage] = useState(0);
  const [spread, setSpread] = useState(true);
  const [fontSize, setFontSize] = useState(17);
  const [theme, setTheme] = useState('night');
  const [showSettings, setShowSettings] = useState(false);
  const [currentChapterTitle, setCurrentChapterTitle] = useState('');

  const contentRef = useRef(null);
  const htmlToInject = useRef('');
  const highlightsToRestore = useRef([]);
  const [totalPages, setTotalPages] = useState(1);

  const [selectionMenu, setSelectionMenu] = useState(null);
  
  // Storage logic
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  // Fetch initial data
  useEffect(() => {
    let isMounted = true;
    
    const loadSavedData = async () => {
      let savedPage = 0;
      let savedHighlights = [];
      let savedBookmarks = [];
      if (user && supabase) {
        try {
          const { data } = await supabase.from('reading_progress').select('*').eq('user_id', user.id).eq('book_id', book.id).single();
          if (data) {
            savedPage = data.current_page || 0;
            savedHighlights = data.highlights || [];
            savedBookmarks = data.bookmarks || [];
          }
        } catch(e) { /* no saved data yet */ }
      } else {
        savedPage = parseInt(localStorage.getItem(`archivum_progress_${book.id}`)) || 0;
        try { savedHighlights = JSON.parse(localStorage.getItem(`archivum_highlights_${book.id}`)) || []; } catch(e){}
        try { savedBookmarks = JSON.parse(localStorage.getItem(`archivum_bookmarks_${book.id}`)) || []; } catch(e){}
      }
      if (isMounted) {
        setPage(savedPage);
        setHighlights(savedHighlights);
        setBookmarks(savedBookmarks);
      }
      return { savedHighlights };
    };

    const loadBook = async () => {
      setLoading(true);
      const { savedHighlights } = await loadSavedData();

      const epubUrl = book.formats['application/epub+zip'];
      if (!epubUrl) {
        await loadFallback(savedHighlights);
        return;
      }

      try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(epubUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("Fetch failed");
        const arrayBuffer = await res.arrayBuffer();

        const JSZip = window.JSZip;
        if (!JSZip) throw new Error("JSZip not loaded");
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Parse container.xml
        const containerFile = zip.file("META-INF/container.xml");
        if (!containerFile) throw new Error("No container.xml");
        const containerXml = await containerFile.async("string");
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, "application/xml");
        const rootfile = Array.from(containerDoc.getElementsByTagName("*")).find(el => el.localName === "rootfile");
        const opfPath = rootfile.getAttribute("full-path");

        const opfBaseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        const resolveOpfPath = (href) => opfBaseDir + href;

        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error("OPF not found");
        const opfXml = await opfFile.async("string");
        const opfDoc = parser.parseFromString(opfXml, "application/xml");

        // Parse manifest and spine
        const manifest = {};
        const items = Array.from(opfDoc.getElementsByTagName("*")).filter(el => el.localName === "item");
        for (let i = 0; i < items.length; i++) {
          manifest[items[i].getAttribute("id")] = items[i].getAttribute("href");
        }

        const itemrefs = Array.from(opfDoc.getElementsByTagName("*")).filter(el => el.localName === "itemref");
        const spineIds = itemrefs.map(itemref => itemref.getAttribute("idref"));

        let finalHtml = '';
        for (const id of spineIds) {
          const href = manifest[id];
          if (!href) continue;
          const fullPath = resolveOpfPath(decodeURIComponent(href));
          const chapterFile = zip.file(fullPath);
          if (!chapterFile) continue;

          const chapterHtml = await chapterFile.async("string");
          const chapterDoc = parser.parseFromString(chapterHtml, "text/html");

          chapterDoc.querySelectorAll("style, link, script").forEach(el => el.remove());
          
          const chapterBaseDir = fullPath.includes('/') ? fullPath.substring(0, fullPath.lastIndexOf('/') + 1) : '';
          const resolveChapterPath = (src) => {
            if (src.startsWith('http') || src.startsWith('data:')) return src;
            const parts = chapterBaseDir.split('/').filter(Boolean);
            const srcParts = decodeURIComponent(src).split('/');
            for (const p of srcParts) {
              if (p === '..') parts.pop();
              else if (p !== '.') parts.push(p);
            }
            return parts.join('/');
          };

          const imgs = chapterDoc.querySelectorAll("img");
          for (const img of Array.from(imgs)) {
            const src = img.getAttribute("src");
            if (src) {
              const imgPath = resolveChapterPath(src);
              const imgFile = zip.file(imgPath);
              if (imgFile) {
                const base64 = await imgFile.async("base64");
                const ext = imgPath.split('.').pop().toLowerCase();
                const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
                img.setAttribute("src", `data:${mime};base64,${base64}`);
              }
            }
            img.removeAttribute("class");
            img.removeAttribute("style");
          }

          // Strip inline styles/classes but keep semantic tags
          chapterDoc.body.querySelectorAll("*").forEach(el => {
            el.removeAttribute("class");
            el.removeAttribute("style");
          });

          finalHtml += `<div class="chapter-break"></div>${chapterDoc.body.innerHTML}`;
        }

        if (isMounted) {
          htmlToInject.current = finalHtml;
          highlightsToRestore.current = savedHighlights;
          setLoading(false);
        }

      } catch (err) {
        console.error("EPUB Parse Error:", err);
        if (isMounted) await loadFallback(savedHighlights);
      }
    };

    loadBook();

    return () => { isMounted = false; };
  }, [book, user]);

  // Fallback: fetch plain text directly from Gutenberg
  const loadFallback = async (savedHighlights) => {
    try {
      // Try to get plain text from Gutenberg
      const textUrl = book.formats['text/plain; charset=utf-8'] 
        || book.formats['text/plain'] 
        || book.formats['text/plain; charset=us-ascii'];
      
      if (!textUrl) {
        setError("No readable format available for this book.");
        setLoading(false);
        return;
      }

      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(textUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error("Text fetch failed");
      const text = await res.text();

      // Parse plain text into structured HTML
      const lines = text.split('\n');
      let fullHtml = '';
      let currentParagraph = '';
      let inParagraph = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        const trimmed = line.trim();
        
        // Detect chapter/section headings (all caps lines, or lines starting with CHAPTER/BOOK)
        if (trimmed.length > 0 && trimmed.length < 80 && 
            (trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/^[0-9\s\.\-_]+$/.test(trimmed)) ||
            /^(CHAPTER|BOOK|PART|SECTION|VOLUME)\b/i.test(trimmed)) {
          // Flush current paragraph
          if (currentParagraph.trim()) {
            fullHtml += `<p>${currentParagraph.trim()}</p>`;
            currentParagraph = '';
          }
          const tag = /^(CHAPTER|BOOK|PART|VOLUME)\b/i.test(trimmed) ? 'h2' : 'h3';
          fullHtml += `<${tag}>${trimmed}</${tag}>`;
          inParagraph = false;
          continue;
        }
        
        // Empty line = paragraph break
        if (trimmed === '') {
          if (currentParagraph.trim()) {
            fullHtml += `<p>${currentParagraph.trim()}</p>`;
            currentParagraph = '';
          }
          inParagraph = false;
          continue;
        }
        
        // Regular text line
        if (currentParagraph) {
          currentParagraph += ' ' + trimmed;
        } else {
          currentParagraph = trimmed;
        }
        inParagraph = true;
      }
      
      // Flush remaining
      if (currentParagraph.trim()) {
        fullHtml += `<p>${currentParagraph.trim()}</p>`;
      }

      htmlToInject.current = fullHtml;
      highlightsToRestore.current = savedHighlights || [];
      setLoading(false);
    } catch(e) {
      console.error("Fallback error:", e);
      setError("Unable to load this book. Please try another title.");
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && contentRef.current && htmlToInject.current) {
      contentRef.current.innerHTML = htmlToInject.current;
      restoreHighlights(contentRef.current, highlightsToRestore.current);
      
      // Give the browser time to lay out columns before measuring
      requestAnimationFrame(() => {
        setTimeout(calculatePages, 100);
      });
      
      // Clear refs to prevent re-injecting on other re-renders
      htmlToInject.current = '';
      highlightsToRestore.current = [];
    }
  }, [loading]);

  const restoreHighlights = (container, savedHighlights) => {
    if (!savedHighlights || savedHighlights.length === 0) return;
    
    savedHighlights.forEach(hl => {
      let occurrenceCount = 0;
      const hlText = hl.text;
      const targetIndex = hl.index;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentNode.tagName === 'MARK') continue;
        
        const text = node.nodeValue;
        let pos = text.indexOf(hlText);
        while (pos !== -1) {
          if (occurrenceCount === targetIndex) {
            const split1 = node.splitText(pos);
            split1.splitText(hlText.length);
            
            const mark = document.createElement('mark');
            mark.appendChild(split1.cloneNode(true));
            split1.parentNode.replaceChild(mark, split1);
            
            walker.currentNode = mark;
            return;
          }
          occurrenceCount++;
          pos = text.indexOf(hlText, pos + 1);
        }
      }
    });
  };

  const saveData = async (newPage, newHighlights, newBookmarks) => {
    if (user && supabase) {
      try {
        await supabase.from('reading_progress').upsert({
          user_id: user.id,
          book_id: book.id,
          book_title: book.title,
          current_page: newPage ?? page,
          highlights: newHighlights ?? highlights,
          bookmarks: newBookmarks ?? bookmarks,
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,book_id' });
      } catch(e) { console.error('Save error:', e); }
    } else {
      if (newPage !== undefined) localStorage.setItem(`archivum_progress_${book.id}`, newPage);
      if (newHighlights !== undefined) localStorage.setItem(`archivum_highlights_${book.id}`, JSON.stringify(newHighlights));
      if (newBookmarks !== undefined) localStorage.setItem(`archivum_bookmarks_${book.id}`, JSON.stringify(newBookmarks));
    }
  };

  const calculatePages = useCallback(() => {
    if (contentRef.current) {
      const scrollWidth = contentRef.current.scrollWidth;
      const viewWidth = window.innerWidth;
      const pages = Math.max(1, Math.ceil(scrollWidth / viewWidth));
      setTotalPages(pages);
      setPage(p => Math.min(Math.max(p, 0), pages - 1));
    }
  }, []);

  // Recalculate pages when font size or spread mode changes
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(calculatePages, 150);
      return () => clearTimeout(timer);
    }
  }, [fontSize, spread, loading, calculatePages]);

  useEffect(() => {
    window.addEventListener('resize', calculatePages);
    return () => window.removeEventListener('resize', calculatePages);
  }, [calculatePages]);

  useEffect(() => {
    if (loading) return;
    const headings = contentRef.current?.querySelectorAll('.chapter-heading, h1, h2, h3');
    if (!headings) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const title = entry.target.getAttribute('data-title') || entry.target.textContent;
          setCurrentChapterTitle(title);
        }
      });
    }, { root: null, rootMargin: '0px', threshold: 0.1 });

    headings.forEach(h => observer.observe(h));
    return () => observer.disconnect();
  }, [loading, page, spread]);

  const next = useCallback(() => {
    setPage(p => {
      const newPage = Math.min(totalPages - 1, p + 1);
      saveData(newPage, undefined, undefined);
      return newPage;
    });
  }, [totalPages]);

  const prev = useCallback(() => {
    setPage(p => {
      const newPage = Math.max(0, p - 1);
      saveData(newPage, undefined, undefined);
      return newPage;
    });
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if(e.key === 'ArrowRight') next();
      if(e.key === 'ArrowLeft') prev();
      if(e.key === 'Escape') onClose();
    };
    window.addEventListener('keyup', handleKey);
    return () => window.removeEventListener('keyup', handleKey);
  }, [next, prev, onClose]);

  const getThemeVars = () => {
    if (theme === 'night') return { bg: '#06060A', color: '#EDE8DF', accent: '#E04E2A', muted: 'rgba(255,255,255,0.08)' };
    if (theme === 'sepia') return { bg: '#1A1209', color: '#D4B896', accent: '#BF9B5A', muted: 'rgba(255,255,255,0.06)' };
    return { bg: '#F5F0E8', color: '#2C2416', accent: '#E04E2A', muted: 'rgba(0,0,0,0.06)' };
  };

  const currentTheme = getThemeVars();
  
  // Column layout parameters — carefully tuned for book-like feel
  const colWidth = spread ? '38vw' : '55vw';
  const colGap = spread ? '14vw' : '45vw';
  const padLeft = spread ? '5vw' : '22.5vw';

  const handleMouseUp = (e) => {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (text) {
      if (sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setSelectionMenu({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
        text: text,
        range: sel.getRangeAt(0)
      });
    } else {
      setSelectionMenu(null);
    }
  };

  const handleHighlight = () => {
    if (!selectionMenu) return;
    
    const { text, range } = selectionMenu;
    
    let occurrenceIndex = 0;
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) break;
      let pos = node.nodeValue.indexOf(text);
      while (pos !== -1) {
        occurrenceIndex++;
        pos = node.nodeValue.indexOf(text, pos + 1);
      }
    }
    
    let pos = range.startContainer.nodeValue?.indexOf(text);
    while (pos !== undefined && pos !== -1 && pos < range.startOffset) {
      occurrenceIndex++;
      pos = range.startContainer.nodeValue.indexOf(text, pos + 1);
    }

    const hlObj = { text, index: occurrenceIndex, bookId: book.id };
    const newHighlights = [...highlights, hlObj];
    setHighlights(newHighlights);
    
    const mark = document.createElement('mark');
    
    try {
      range.surroundContents(mark);
    } catch(e) {
      const fragment = range.extractContents();
      mark.appendChild(fragment);
      range.insertNode(mark);
    }
    
    window.getSelection().removeAllRanges();
    setSelectionMenu(null);
    saveData(undefined, newHighlights, undefined);
  };

  const handleBookmark = () => {
    if (!selectionMenu) return;
    const { text } = selectionMenu;
    const excerpt = text.substring(0, 40) + (text.length > 40 ? '...' : '');
    const bmObj = { page, excerpt, time: new Date().toISOString() };
    const newBookmarks = [...bookmarks, bmObj];
    setBookmarks(newBookmarks);
    window.getSelection().removeAllRanges();
    setSelectionMenu(null);
    saveData(undefined, undefined, newBookmarks);
  };

  // Click on left/right third of page to navigate
  const handlePageClick = (e) => {
    // Don't navigate if text is selected
    if (window.getSelection().toString().trim()) return;
    const third = window.innerWidth / 3;
    if (e.clientX < third) prev();
    else if (e.clientX > third * 2) next();
  };

  // --- LOADING STATE ---
  if (loading) {
    return (
      <div className="reader-loading">
        <div className="reader-loading-spinner"></div>
        <div className="mono text-secondary reader-loading-text">
          PARSING BOOK...
        </div>
      </div>
    );
  }

  // --- ERROR STATE ---
  if (error) {
    return (
      <div className="reader-loading">
        <div className="mono text-secondary" style={{ maxWidth: '400px', textAlign: 'center', lineHeight: 1.6 }}>{error}</div>
        <button className="btn-ghost" onClick={onClose} style={{ marginTop: '16px' }}>BACK TO LIBRARY</button>
      </div>
    );
  }

  const progress = totalPages > 1 ? ((page / (totalPages - 1)) * 100).toFixed(0) : 100;

  return (
    <div 
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: currentTheme.bg,
        color: currentTheme.color,
        display: 'flex', flexDirection: 'column',
        transition: 'background-color 0.4s ease, color 0.4s ease',
        overflow: 'hidden'
      }}
    >
      {/* Progress bar at very top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px', zIndex: 200,
        background: currentTheme.muted,
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: currentTheme.accent,
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* TOP BAR — auto-hide, shows on hover */}
      <div className="reader-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ArrowLeft size={16} />
            <span className="mono" style={{ color: 'inherit', opacity: 0.6 }}>LIBRARY</span>
          </button>
        </div>
        <div className="mono" style={{ opacity: 0.5, fontSize: '10px', maxWidth: '40%', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {book.title}
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button onClick={() => setSpread(!spread)} title={spread ? 'Single page' : 'Two-page spread'}>
            {spread ? <Square size={16} /> : <Columns size={16} />}
          </button>
          <button onClick={() => setShowSettings(!showSettings)} title="Settings">
            <Settings size={16} />
          </button>
          <button onClick={() => {
            try { document.documentElement.requestFullscreen(); } catch(e) {}
          }} title="Fullscreen">
            <Maximize size={16} />
          </button>
        </div>
      </div>

      {/* SETTINGS PANEL */}
      {showSettings && (
        <div className="reader-settings" style={{ background: currentTheme.bg }}>
          <div className="mono" style={{ fontSize: '10px', opacity: 0.5, marginBottom: '4px' }}>THEME</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['night', 'sepia', 'paper'].map(t => (
              <button 
                key={t}
                onClick={() => setTheme(t)} 
                className="mono theme-btn" 
                style={{ 
                  color: theme === t ? currentTheme.accent : 'inherit',
                  background: theme === t ? `${currentTheme.accent}15` : 'transparent',
                  borderRadius: '4px'
                }}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ height: '1px', background: currentTheme.muted }} />
          <div className="mono" style={{ fontSize: '10px', opacity: 0.5, marginBottom: '4px' }}>FONT SIZE</div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button onClick={() => setFontSize(f => Math.max(12, f - 1))} className="mono font-btn">A−</button>
            <span className="mono" style={{ minWidth: '40px', textAlign: 'center' }}>{fontSize}PX</span>
            <button onClick={() => setFontSize(f => Math.min(28, f + 1))} className="mono font-btn">A+</button>
          </div>
        </div>
      )}

      {/* SELECTION MENU */}
      {selectionMenu && (
        <div className="selection-menu" style={{ left: selectionMenu.x, top: selectionMenu.y }}>
          <button onClick={handleHighlight} className="mono">
            <Edit3 size={12}/> HIGHLIGHT
          </button>
          <div style={{ width: '1px', background: 'var(--border)' }}></div>
          <button onClick={handleBookmark} className="mono">
            <BookmarkPlus size={12}/> BOOKMARK
          </button>
        </div>
      )}

      {/* MAIN READING AREA */}
      <div style={{ flex: 1, position: 'relative' }} onMouseUp={handleMouseUp} onClick={handlePageClick}>
        
        {/* Chapter headers for spread */}
        {spread ? (
          <>
            <div className="page-number" style={{ top: '40px', bottom: 'auto', left: '5vw', width: '38vw', fontSize: '10px', letterSpacing: '0.15em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {book.title.length > 40 ? book.title.substring(0, 40) + '…' : book.title}
            </div>
            <div className="page-number" style={{ top: '40px', bottom: 'auto', right: '5vw', width: '38vw', fontSize: '10px', letterSpacing: '0.15em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentChapterTitle || book.title}
            </div>
          </>
        ) : (
          <div className="page-number" style={{ top: '40px', bottom: 'auto', left: 0, right: 0, fontSize: '10px', letterSpacing: '0.15em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 20vw' }}>
            {currentChapterTitle || book.title}
          </div>
        )}

        {/* Left arrow */}
        <button className="nav-arrow" onClick={(e) => { e.stopPropagation(); prev(); }} style={{ left: '1vw' }}
          onMouseEnter={e=>e.currentTarget.style.opacity=0.3} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
          <ArrowLeft size={28} />
        </button>

        {/* BOOK CONTENT — CSS multi-column layout */}
        <div style={{
          width: '100vw', height: '100vh', 
          overflow: 'hidden', position: 'relative',
        }}>
          {/* Spine shadow for spread mode */}
          {spread && <div className="spread-spine" />}
          
          <div 
            ref={contentRef}
            className="reader-content"
            style={{
              height: 'calc(100vh - 140px)',
              marginTop: '70px',
              width: 'max-content',
              columnWidth: colWidth,
              columnGap: colGap,
              columnFill: 'auto',
              paddingLeft: padLeft,
              paddingRight: padLeft,
              transform: `translateX(-${page * 100}vw)`,
              transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
              fontSize: `${fontSize}px`,
              color: currentTheme.color,
            }}
          >
          </div>
        </div>

        {/* Right arrow */}
        <button className="nav-arrow" onClick={(e) => { e.stopPropagation(); next(); }} style={{ right: '1vw' }}
          onMouseEnter={e=>e.currentTarget.style.opacity=0.3} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
          <ArrowRight size={28} />
        </button>

        {/* Page numbers */}
        {spread ? (
          <>
            <div className="page-number" style={{ left: '5vw', width: '38vw' }}>
              {page * 2 + 1}
            </div>
            <div className="page-number" style={{ right: '5vw', width: '38vw' }}>
              {Math.min(page * 2 + 2, totalPages * 2)}
            </div>
          </>
        ) : (
          <div className="page-number" style={{ left: 0, right: 0 }}>
            {page + 1} / {totalPages}
          </div>
        )}

      </div>
    </div>
  );
};

export default NativeReader;
