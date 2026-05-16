import React, { useEffect, useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, Settings, Maximize, Columns, Square, BookmarkPlus, Edit3 } from 'lucide-react';
import { supabase } from '../supabaseClient';

const NativeReader = ({ book, onClose, user }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  
  const [page, setPage] = useState(0);
  const [spread, setSpread] = useState(true);
  const [fontSize, setFontSize] = useState(16);
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
        const { data } = await supabase.from('reading_progress').select('*').eq('user_id', user.id).eq('book_id', book.id).single();
        if (data) {
          savedPage = data.current_page || 0;
          savedHighlights = data.highlights || [];
          savedBookmarks = data.bookmarks || [];
        }
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
        await loadFallback();
        return;
      }

      try {
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(epubUrl)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("Fetch failed");
        const arrayBuffer = await res.arrayBuffer();

        const JSZip = window.JSZip;
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
        
        let fullHtml = '';

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
                const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
                img.setAttribute("src", `data:${mime};base64,${base64}`);
              }
            }
            img.removeAttribute("class");
            img.removeAttribute("style");
          }

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

  const loadFallback = async (savedHighlights) => {
    setFallbackLoading(true);
    try {
      const res = await fetch(`http://localhost:8000/api/book/${book.id}`);
      if (!res.ok) throw new Error("Backend fallback failed");
      const d = await res.json();
      
      let fullHtml = '';
      d.chapters.forEach((ch, idx) => {
        fullHtml += `<div class="chapter-break"></div>`;
        fullHtml += `<h2 class="chapter-heading" data-title="${ch.title}" style="text-align:center;margin-top:40px;margin-bottom:60px;font-family:'Playfair Display',serif;font-size:2em;">${ch.title}</h2>`;
        ch.paragraphs.forEach((p, i) => {
          fullHtml += `<p style="text-indent:${i===0?'0':'2em'};text-align:justify;">${p}</p>`;
        });
      });
      htmlToInject.current = fullHtml;
      highlightsToRestore.current = savedHighlights || highlights;
    } catch(e) {
      setError("Error loading book content. Please try again later.");
    } finally {
      setFallbackLoading(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !fallbackLoading && contentRef.current && htmlToInject.current) {
      contentRef.current.innerHTML = htmlToInject.current;
      restoreHighlights(contentRef.current, highlightsToRestore.current);
      setTimeout(calculatePages, 50);
      
      // Clear refs to prevent re-injecting on other re-renders
      htmlToInject.current = '';
      highlightsToRestore.current = [];
    }
  }, [loading, fallbackLoading]);

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
            const split2 = split1.splitText(hlText.length);
            
            const mark = document.createElement('mark');
            mark.style.backgroundColor = 'var(--gold)';
            mark.style.color = '#111';
            mark.style.borderRadius = '2px';
            mark.style.padding = '0 2px';
            
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
      await supabase.from('reading_progress').upsert({
        user_id: user.id,
        book_id: book.id,
        book_title: book.title,
        current_page: newPage ?? page,
        highlights: newHighlights ?? highlights,
        bookmarks: newBookmarks ?? bookmarks,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,book_id' });
    } else {
      if (newPage !== undefined) localStorage.setItem(`archivum_progress_${book.id}`, newPage);
      if (newHighlights !== undefined) localStorage.setItem(`archivum_highlights_${book.id}`, JSON.stringify(newHighlights));
      if (newBookmarks !== undefined) localStorage.setItem(`archivum_bookmarks_${book.id}`, JSON.stringify(newBookmarks));
    }
  };

  const calculatePages = () => {
    if (contentRef.current) {
      const scrollWidth = contentRef.current.scrollWidth;
      const viewWidth = window.innerWidth;
      const pages = Math.ceil(scrollWidth / viewWidth);
      setTotalPages(pages || 1);
      
      setPage(p => Math.min(Math.max(p, 0), (pages || 1) - 1));
    }
  };

  useEffect(() => {
    window.addEventListener('resize', calculatePages);
    return () => window.removeEventListener('resize', calculatePages);
  }, [spread, fontSize]);

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

  const next = () => {
    const newPage = Math.min(totalPages - 1, page + 1);
    setPage(newPage);
    saveData(newPage, undefined, undefined);
  };
  const prev = () => {
    const newPage = Math.max(0, page - 1);
    setPage(newPage);
    saveData(newPage, undefined, undefined);
  };

  useEffect(() => {
    const handleKey = (e) => {
      if(e.key === 'ArrowRight') next();
      if(e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keyup', handleKey);
    return () => window.removeEventListener('keyup', handleKey);
  });

  const getThemeVars = () => {
    if (theme === 'night') return { bg: '#06060A', color: '#EDE8DF', accent: '#E04E2A' };
    if (theme === 'sepia') return { bg: '#1A1209', color: '#D4B896', accent: '#BF9B5A' };
    return { bg: '#F5F0E8', color: '#2C2416', accent: '#E04E2A' };
  };

  const currentTheme = getThemeVars();
  const colWidth = spread ? '40vw' : '60vw';
  const colGap = spread ? '10vw' : '40vw';
  const paddingLeft = spread ? '5vw' : '20vw';

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
    mark.style.backgroundColor = 'var(--gold)';
    mark.style.color = '#111';
    mark.style.borderRadius = '2px';
    mark.style.padding = '0 2px';
    
    // Fallback if range spans multiple elements
    try {
      range.surroundContents(mark);
    } catch(e) {
      // If it fails to surround, extract contents and wrap (basic handling for complex selections)
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

  if (loading || fallbackLoading) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#06060A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px' }}>
        <div className="mono text-secondary" style={{ animation: 'pulse 1.5s infinite' }}>
          {fallbackLoading ? 'TYPESETTING PLAIN TEXT...' : 'PARSING EPUB...'}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#06060A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '20px' }}>
        <div className="mono text-secondary">{error}</div>
        <button className="btn-ghost" onClick={onClose}>CLOSE</button>
      </div>
    );
  }

  return (
    <div 
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: currentTheme.bg,
        color: currentTheme.color,
        display: 'flex', flexDirection: 'column',
        transition: 'background-color 0.4s ease',
        overflow: 'hidden'
      }}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px',
        zIndex: 100, opacity: 0, transition: 'opacity 0.3s'
      }} onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', cursor: 'none' }}><ArrowLeft size={16} /></button>
          <span className="mono" style={{ color: 'var(--text-secondary)' }}>BACK TO LIBRARY</span>
        </div>
        <div style={{ display: 'flex', gap: '24px' }}>
          <button onClick={() => setSpread(!spread)} style={{ cursor: 'none' }}>
            {spread ? <Square size={16} /> : <Columns size={16} />}
          </button>
          <button onClick={() => setShowSettings(!showSettings)} style={{ cursor: 'none' }}>
            <Settings size={16} />
          </button>
          <button onClick={() => document.documentElement.requestFullscreen()} style={{ cursor: 'none' }}>
            <Maximize size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <div style={{
          position: 'absolute', top: '70px', right: '40px', background: currentTheme.bg,
          padding: '24px', border: `1px solid ${theme==='night' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, zIndex: 1001,
          display: 'flex', flexDirection: 'column', gap: '16px', boxShadow: '0 10px 40px rgba(0,0,0,0.5)'
        }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setTheme('night')} className="mono" style={{ color: theme==='night'?currentTheme.accent:'inherit' }}>NIGHT</button>
            <button onClick={() => setTheme('sepia')} className="mono" style={{ color: theme==='sepia'?currentTheme.accent:'inherit' }}>SEPIA</button>
            <button onClick={() => setTheme('paper')} className="mono" style={{ color: theme==='paper'?currentTheme.accent:'inherit' }}>PAPER</button>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button onClick={() => setFontSize(f => Math.max(12, f - 2))} className="mono">A-</button>
            <span className="mono">{fontSize}px</span>
            <button onClick={() => setFontSize(f => Math.min(32, f + 2))} className="mono">A+</button>
          </div>
        </div>
      )}

      {selectionMenu && (
        <div style={{
          position: 'absolute',
          left: selectionMenu.x,
          top: selectionMenu.y,
          transform: 'translate(-50%, -100%)',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          padding: '8px',
          borderRadius: '4px',
          display: 'flex',
          gap: '12px',
          zIndex: 2000,
          boxShadow: '0 10px 20px rgba(0,0,0,0.5)'
        }}>
          <button onClick={handleHighlight} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-primary)' }} className="mono"><Edit3 size={12}/> HIGHLIGHT</button>
          <div style={{ width: '1px', background: 'var(--border)' }}></div>
          <button onClick={handleBookmark} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-primary)' }} className="mono"><BookmarkPlus size={12}/> BOOKMARK</button>
        </div>
      )}

      <div style={{ flex: 1, position: 'relative' }} onMouseUp={handleMouseUp}>
        
        {spread ? (
          <>
            <div style={{ position: 'absolute', top: '40px', left: '5vw', width: '40vw', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {book.title}
            </div>
            <div style={{ position: 'absolute', top: '40px', right: '5vw', width: '40vw', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {currentChapterTitle || book.title}
            </div>
          </>
        ) : (
          <div style={{ position: 'absolute', top: '40px', left: 0, right: 0, textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.15em', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10, padding: '0 20vw', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentChapterTitle || book.title}
          </div>
        )}

        <button onClick={prev} style={{ position: 'absolute', left: '1vw', top: '50%', transform: 'translateY(-50%)', zIndex: 20, padding: '20px', opacity: 0, cursor: 'none', transition: 'opacity 0.2s' }} onMouseEnter={e=>e.currentTarget.style.opacity=0.3} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
          <ArrowLeft size={32} />
        </button>

        <div style={{
          width: '100vw', height: '100vh', 
          overflow: 'hidden', position: 'relative',
        }}>
          <div 
            ref={contentRef}
            style={{
              height: 'calc(100vh - 140px)',
              marginTop: '80px',
              width: 'max-content',
              columnWidth: colWidth,
              columnGap: colGap,
              columnFill: 'auto',
              paddingLeft: paddingLeft,
              paddingRight: paddingLeft,
              transform: `translateX(-${page * 100}vw)`,
              transition: loading ? 'none' : 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
              fontFamily: "'Libre Baskerville', Georgia, serif",
              fontSize: `${fontSize}px`,
              lineHeight: 1.8
            }}
          >
          </div>
        </div>

        <button onClick={next} style={{ position: 'absolute', right: '1vw', top: '50%', transform: 'translateY(-50%)', zIndex: 20, padding: '20px', opacity: 0, cursor: 'none', transition: 'opacity 0.2s' }} onMouseEnter={e=>e.currentTarget.style.opacity=0.3} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
          <ArrowRight size={32} />
        </button>

        {spread ? (
          <>
            <div style={{ position: 'absolute', bottom: '30px', left: '5vw', width: '40vw', textAlign: 'center', fontSize: '11px', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10 }}>
              {page * 2 + 1}
            </div>
            <div style={{ position: 'absolute', bottom: '30px', right: '5vw', width: '40vw', textAlign: 'center', fontSize: '11px', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10 }}>
              {page * 2 + 2}
            </div>
          </>
        ) : (
          <div style={{ position: 'absolute', bottom: '30px', left: 0, right: 0, textAlign: 'center', fontSize: '11px', opacity: 0.4, fontFamily: 'JetBrains Mono', zIndex: 10 }}>
            {page + 1}
          </div>
        )}

      </div>
    </div>
  );
};

export default NativeReader;
