import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Settings, Maximize, Columns, Square, BookmarkPlus, Edit3, X, List, Search, ChevronUp, ChevronDown, Play, Square as SquareIcon, Volume2, Type, AlignJustify, Minus, Plus } from 'lucide-react';
import { supabase } from '../supabaseClient';

const stripGutenbergBoilerplate = (doc) => {
  const textWalker = document.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
  let startNode = null;
  let endNode = null;
  let node;
  while ((node = textWalker.nextNode())) {
    const text = node.nodeValue.toUpperCase();
    if (!startNode && text.includes("START OF THE PROJECT GUTENBERG")) {
      startNode = node.parentElement;
    }
    if (!endNode && text.includes("END OF THE PROJECT GUTENBERG")) {
      endNode = node.parentElement;
    }
  }

  if (startNode) {
    let current = startNode;
    while (current && current !== doc.body) {
      let prev = current.previousSibling;
      while (prev) {
        const toRemove = prev;
        prev = prev.previousSibling;
        if (toRemove.remove) toRemove.remove();
        else if (toRemove.parentNode) toRemove.parentNode.removeChild(toRemove);
      }
      const parent = current.parentElement;
      if (current === startNode) {
        if (current.remove) current.remove();
        else if (current.parentNode) current.parentNode.removeChild(current);
      }
      current = parent;
    }
  }

  if (endNode) {
    let current = endNode;
    while (current && current !== doc.body) {
      let next = current.nextSibling;
      while (next) {
        const toRemove = next;
        next = next.nextSibling;
        if (toRemove.remove) toRemove.remove();
        else if (toRemove.parentNode) toRemove.parentNode.removeChild(toRemove);
      }
      const parent = current.parentElement;
      if (current === endNode) {
        if (current.remove) current.remove();
        else if (current.parentNode) current.parentNode.removeChild(current);
      }
      current = parent;
    }
  }
};

const fetchWithProxy = async (url, responseType = 'text') => {
  const proxies = [
    (u) => `/api/proxy?url=${encodeURIComponent(u)}`,
    (u) => u, // try direct first
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ].filter(Boolean);
  
  for (const makeUrl of proxies) {
    try {
      const proxyUrl = makeUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      if (responseType === 'arraybuffer') return await res.arrayBuffer();
      return await res.text();
    } catch (e) {
      continue; // try next proxy
    }
  }
  throw new Error(`All proxies failed for: ${url}`);
};

// Font family options
const FONT_OPTIONS = [
  { id: 'baskerville', name: 'Baskerville', family: "'Libre Baskerville', Georgia, serif" },
  { id: 'palatino', name: 'Palatino', family: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { id: 'georgia', name: 'Georgia', family: "Georgia, 'Times New Roman', serif" },
  { id: 'system', name: 'System', family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'mono', name: 'Mono', family: "'JetBrains Mono', 'Fira Code', monospace" },
];

const MARGIN_OPTIONS = [
  { id: 'compact', label: 'Compact', desktop: 40, mobile: 16 },
  { id: 'comfortable', label: 'Comfortable', desktop: 60, mobile: 24 },
  { id: 'wide', label: 'Wide', desktop: 100, mobile: 32 },
];

// Load persisted reader preferences
const loadReaderPrefs = () => {
  try {
    const saved = JSON.parse(localStorage.getItem('archivum_reader_prefs') || '{}');
    return {
      fontSize: saved.fontSize || 17,
      fontFamily: saved.fontFamily || 'baskerville',
      lineHeight: saved.lineHeight || 1.85,
      marginSize: saved.marginSize || 'comfortable',
      theme: saved.theme || 'night',
      spread: saved.spread !== undefined ? saved.spread : true,
    };
  } catch { return { fontSize: 17, fontFamily: 'baskerville', lineHeight: 1.85, marginSize: 'comfortable', theme: 'night', spread: true }; }
};

const saveReaderPrefs = (prefs) => {
  try { localStorage.setItem('archivum_reader_prefs', JSON.stringify(prefs)); } catch {}
};

const NativeReader = ({ book, onClose, user }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bookHtml, setBookHtml] = useState('');
  
  const prefs = loadReaderPrefs();
  const [page, setPage] = useState(0);
  const [spread, setSpread] = useState(prefs.spread);
  const [fontSize, setFontSize] = useState(prefs.fontSize);
  const [fontFamily, setFontFamily] = useState(prefs.fontFamily);
  const [lineHeight, setLineHeight] = useState(prefs.lineHeight);
  const [marginSize, setMarginSize] = useState(prefs.marginSize);
  const [theme, setTheme] = useState(prefs.theme);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('style'); // 'style' | 'layout'
  const [showToc, setShowToc] = useState(false);
  const [tocItems, setTocItems] = useState([]);
  const [currentChapterTitle, setCurrentChapterTitle] = useState('');

  
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [ttsVoice, setTtsVoice] = useState(null);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [showTtsPanel, setShowTtsPanel] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [showTopBar, setShowTopBar] = useState(false);

  // Sidebar annotations
  const [sidebarTab, setSidebarTab] = useState('toc'); // 'toc' | 'highlights' | 'bookmarks'
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  const sessionStartTime = useRef(Date.now());
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const contentRef = useRef(null);
  const [totalPages, setTotalPages] = useState(1);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const [selectionMenu, setSelectionMenu] = useState(null);
  
  // Storage logic
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Persist reader prefs whenever they change
  useEffect(() => {
    saveReaderPrefs({ fontSize, fontFamily, lineHeight, marginSize, theme, spread });
  }, [fontSize, fontFamily, lineHeight, marginSize, theme, spread]);

  // Load available TTS voices
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const loadVoices = () => {
      const voices = synth.getVoices();
      setAvailableVoices(voices);
      // Auto-select a Hindi voice if book is Hindi
      const bookLang = (book.languages?.[0] || '').toLowerCase();
      if (bookLang.match(/^(hi|hin|hindi)$/)) {
        const hindiVoice = voices.find(v => v.lang.startsWith('hi'));
        if (hindiVoice) setTtsVoice(hindiVoice);
      }
    };
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, []);

  // Keyboard shortcuts for reader
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      if (e.key === ' ' && !e.shiftKey) { e.preventDefault(); handleTTS(); }
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setShowShortcutsModal(v => !v); }
      if (e.key === 'Escape') { setShowShortcutsModal(false); setShowTtsPanel(false); }
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setShowSearch(v => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, totalPages, isSpeaking]);

  // Fetch initial data
  useEffect(() => {
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
      if (isMountedRef.current) {
        setPage(savedPage);
        setHighlights(savedHighlights);
        setBookmarks(savedBookmarks);
      }
      return { savedHighlights };
    };

    const loadBook = async () => {
      setLoading(true);
      const { savedHighlights } = await loadSavedData();

      // Internet Archive books: resolve actual download URLs first
      if (book._source === 'archive' && book._iaIdentifier) {
        try {
          await loadIABook(book._iaIdentifier, savedHighlights);
          return;
        } catch (err) {
          console.error('IA load error:', err);
          if (isMountedRef.current) {
            setError('Unable to load this book from Internet Archive.');
            setLoading(false);
          }
          return;
        }
      }

      await loadHtmlTier(savedHighlights);
    };

    loadBook();
    const existingTime = parseInt(localStorage.getItem(`archivum_time_${book.id}`) || '0', 10);
    setSessionTime(existingTime);
  }, [book, user]);

  // ========== Internet Archive book loader ==========
  const loadIABook = async (identifier, savedHighlights) => {
    // Fetch metadata to find downloadable files
    const metaText = await fetchWithProxy(`https://archive.org/metadata/${identifier}/files`);
    const metaData = JSON.parse(metaText);
    const files = metaData?.result || [];

    // Find text file
    let textFile = files.find(f => {
      const name = f.name?.toLowerCase() || '';
      return name.endsWith('.txt') && !name.includes('meta') && !name.includes('files');
    });
    // Find HTML file
    let htmlFile = files.find(f => {
      const name = f.name?.toLowerCase() || '';
      return (name.endsWith('.html') || name.endsWith('.htm')) && !name.includes('meta');
    });

    const baseUrl = `https://archive.org/download/${identifier}`;

    // Fallback: try HTML
    if (htmlFile) {
      const htmlUrl = `${baseUrl}/${encodeURIComponent(htmlFile.name)}`;
      const htmlText = await fetchWithProxy(htmlUrl);
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      doc.querySelectorAll('style, link, script, meta, title').forEach(el => el.remove());

      setBookHtml(doc.body.innerHTML);
      setLoading(false);
      return;
    }

    // Fallback: try text file
    if (textFile) {
      const textUrl = `${baseUrl}/${encodeURIComponent(textFile.name)}`;
      const text = await fetchWithProxy(textUrl);

      const lines = text.split('\n');
      let fullHtml = '';
      let currentParagraph = '';

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (trimmed.length > 0 && trimmed.length < 80 &&
            ((trimmed === trimmed.toUpperCase() && /[A-Z\u0900-\u097F]/.test(trimmed)) ||
            /^(CHAPTER|BOOK|PART|SECTION|VOLUME|\u0905\u0927\u094d\u092f\u093e\u092f|\u092a\u0930\u093f\u091a\u094d\u091b\u0947\u0926)\b/i.test(trimmed))) {
          if (currentParagraph.trim()) {
            fullHtml += `<p>${currentParagraph.trim()}</p>`;
            currentParagraph = '';
          }
          fullHtml += `<h2>${trimmed}</h2>`;
          continue;
        }
        if (trimmed === '') {
          if (currentParagraph.trim()) {
            fullHtml += `<p>${currentParagraph.trim()}</p>`;
            currentParagraph = '';
          }
          continue;
        }
        currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
      }
      if (currentParagraph.trim()) fullHtml += `<p>${currentParagraph.trim()}</p>`;

      setBookHtml(fullHtml);
      setLoading(false);
      return;
    }

    throw new Error('No readable format found in this Internet Archive item.');
  };

  // Tier 2: Fetch HTML version from Gutenberg
  const loadHtmlTier = async (savedHighlights) => {
    try {
      const htmlUrl = book.formats['text/html'] 
        || book.formats['text/html; charset=utf-8']
        || book.formats['text/html; charset=us-ascii'];
      
      if (!htmlUrl) {
        throw new Error("No HTML format available for this book.");
      }
      
      const htmlText = await fetchWithProxy(htmlUrl, 'text');
      const doc = new DOMParser().parseFromString(htmlText, 'text/html');

      // Line 1: Remove the entire header boilerplate
      doc.getElementById('pg-header')?.remove();

      // Line 2: Remove the entire footer boilerplate  
      doc.getElementById('pg-footer')?.remove();

      // Line 3: Remove all inline CSS from Gutenberg
      doc.querySelectorAll('style').forEach(el => el.remove());
      doc.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
      doc.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));

      // Gutenberg HTML images are absolute URLs to their CDN.
      // We resolve relative paths to absolute URLs relative to htmlUrl.
      const imgs = doc.querySelectorAll("img");
      for (const img of Array.from(imgs)) {
        const src = img.getAttribute("src");
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
           try {
             const absoluteUrl = new URL(src, htmlUrl).href;
             img.setAttribute("src", absoluteUrl);
           } catch(e) {}
        }
      }

      if (isMountedRef.current) {
        setBookHtml(doc.body.innerHTML);
        setLoading(false);
      }
    } catch (err) {
      console.error("HTML fetch error:", err);
      // Fallback: try plain text fallback
      await loadPlainTextFallback(savedHighlights);
    }
  };

  // Tier 3: Fetch plain text directly from Gutenberg
  const loadPlainTextFallback = async (savedHighlights) => {
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

      const text = await fetchWithProxy(textUrl, 'text');

      // Strip start/end headers from raw text
      let cleanedText = text;
      const startMatch = cleanedText.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*/i);
      const endMatch = cleanedText.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*/i);
      
      if (startMatch) {
        cleanedText = cleanedText.substring(startMatch.index + startMatch[0].length);
      }
      if (endMatch) {
        cleanedText = cleanedText.substring(0, endMatch.index);
      }
      cleanedText = cleanedText.trim();

      // Parse plain text into structured HTML
      const lines = cleanedText.split('\n');
      let fullHtml = '';
      let currentParagraph = '';
      let inParagraph = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trimEnd();
        const trimmed = line.trim();
        
        // Detect chapter/section headings (all caps lines, or lines starting with CHAPTER/BOOK)
        if (trimmed.length > 0 && trimmed.length < 80 && 
            ((trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed) && !/^[0-9\s\.\-_]+$/.test(trimmed)) ||
            /^(CHAPTER|BOOK|PART|SECTION|VOLUME|अध्याय)\b/i.test(trimmed))) {
          // Flush current paragraph
          if (currentParagraph.trim()) {
            let pText = currentParagraph.trim();
            pText = pText.replace(/_([^_]+)_/g, '<em>$1</em>');
            pText = pText.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
            fullHtml += `<p>${pText}</p>`;
            currentParagraph = '';
          }
          const tag = /^(CHAPTER|BOOK|PART|VOLUME|अध्याय)\b/i.test(trimmed) ? 'h2' : 'h3';
          fullHtml += `<${tag} class="chapter-heading">${trimmed}</${tag}>`;
          inParagraph = false;
          continue;
        }
        
        // Empty line = paragraph break
        if (trimmed === '') {
          if (currentParagraph.trim()) {
            let pText = currentParagraph.trim();
            pText = pText.replace(/_([^_]+)_/g, '<em>$1</em>');
            pText = pText.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
            fullHtml += `<p>${pText}</p>`;
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
        let pText = currentParagraph.trim();
        pText = pText.replace(/_([^_]+)_/g, '<em>$1</em>');
        pText = pText.replace(/\*([^\*]+)\*/g, '<strong>$1</strong>');
        fullHtml += `<p>${pText}</p>`;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(`<body>${fullHtml}</body>`, "text/html");
      stripGutenbergBoilerplate(doc);

      setBookHtml(doc.body.innerHTML);
      setLoading(false);
    } catch(e) {
      console.error("Fallback error:", e);
      setError("Unable to load this book. Please try another title.");
      setLoading(false);
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
    setIsRecalculating(false);
  }, []);

  const goToPage = (targetPage) => {
    setPage(targetPage);
    saveData(targetPage, undefined, undefined);
  };

  useEffect(() => {
    if (bookHtml && contentRef.current) {
      const injectedImgs = contentRef.current.querySelectorAll('img');
      injectedImgs.forEach(img => {
        img.onerror = () => { img.style.display = 'none'; };
        img.style.maxWidth = '100%';
        img.style.maxHeight = '35vh';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '1.5rem auto';
      });

      // APPLY OUR TYPOGRAPHY OVER GUTENBERG'S STRIPPED HTML
      contentRef.current.style.fontFamily = 'Libre Baskerville, Georgia, serif';
      contentRef.current.style.fontSize   = '17px';
      contentRef.current.style.lineHeight = '1.85';
      contentRef.current.style.color      = '#E8DFD0';

      // TOC NAVIGATION — intercept all internal anchor clicks
      const handleAnchorClick = (e) => {
        const anchor = e.target.closest('a[href^="#"]');
        if (!anchor) return;
        e.preventDefault();
        const id = anchor.getAttribute('href').slice(1);
        const target = contentRef.current.querySelector(`#${id}, [id="${id}"]`);
        if (!target) return;
        const pageNum = Math.floor(target.offsetLeft / window.innerWidth);
        goToPage(pageNum);
      };
      contentRef.current.addEventListener('click', handleAnchorClick);

      restoreHighlights(contentRef.current, highlights);
      
      // Extract TOC
      const headings = contentRef.current.querySelectorAll('.chapter-heading, h1, h2, h3');
      const items = Array.from(headings).map((h, i) => {
        if (!h.id) h.id = `toc-${i}`;
        return {
          id: h.id,
          title: h.getAttribute('data-title') || h.textContent,
          level: parseInt(h.tagName.substring(1)),
          element: h
        };
      }).filter(item => item.title.trim().length > 0);
      setTocItems(items);
      
      // Give the browser time to lay out columns before measuring
      requestAnimationFrame(() => {
        setIsRecalculating(true);
        setTimeout(calculatePages, 200);
      });

      return () => {
        if (contentRef.current) {
          contentRef.current.removeEventListener('click', handleAnchorClick);
        }
      };
    }
  }, [bookHtml, highlights, calculatePages]);

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
    // Save reading time
    const msRead = Date.now() - sessionStartTime.current;
    const mins = Math.floor(msRead / 60000);
    if (mins > 0) {
      const key = `archivum_time_${book.id}`;
      const total = parseInt(localStorage.getItem(key) || '0', 10) + mins;
      localStorage.setItem(key, total.toString());
      sessionStartTime.current = Date.now();
      setSessionTime(total);
    }

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



  // Recalculate pages when font size or spread mode changes
  useEffect(() => {
    if (!loading) {
      setIsRecalculating(true);
      const timer = setTimeout(calculatePages, 200);
      return () => clearTimeout(timer);
    }
  }, [fontSize, fontFamily, lineHeight, marginSize, spread, loading, calculatePages]);

  useEffect(() => {
    let timer;
    const handleResize = () => {
      setIsRecalculating(true);
      clearTimeout(timer);
      timer = setTimeout(calculatePages, 200);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
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
    switch (theme) {
      case 'ivory':
        return { bg: '#FAF6EE', color: '#2E2A24', accent: '#C05C3E', muted: 'rgba(46, 42, 36, 0.06)' }
      case 'sepia':
        return { bg: '#F3EAD3', color: '#4A3B2C', accent: '#A97B30', muted: 'rgba(74, 59, 44, 0.08)' }
      case 'forest':
        return { bg: '#E6ECE4', color: '#283C2C', accent: '#5A7A5D', muted: 'rgba(40, 60, 44, 0.06)' }
      case 'slate':
        return { bg: '#1F242D', color: '#E2E6EC', accent: '#6F95D2', muted: 'rgba(255, 255, 255, 0.06)' }
      case 'midnight':
      default:
        return { bg: '#0B0B0F', color: '#EBEBEE', accent: '#E25A38', muted: 'rgba(255, 255, 255, 0.07)' }
    }
  }

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const currentTheme = getThemeVars();
  
  const effectiveSpread = isMobile ? false : spread;
  // Exact math: viewportWidth = paddingLeft + col1 + gap + col2 + paddingRight
  // For spread (2 cols): colWidth = (100vw - 2*pad - gap) / 2
  // For single: colWidth = 100vw - 2*pad
  const marginOption = MARGIN_OPTIONS.find(m => m.id === marginSize) || MARGIN_OPTIONS[1];
  const pad = isMobile ? marginOption.mobile : marginOption.desktop;
  const gap = effectiveSpread ? 80 : 0;
  const numCols = effectiveSpread ? 2 : 1;
  const colWidthCalc = `calc((100vw - ${2 * pad}px - ${gap}px) / ${numCols})`;
  const activeFontFamily = FONT_OPTIONS.find(f => f.id === fontFamily)?.family || FONT_OPTIONS[0].family;

  const readerCursorRef = useRef(null);

  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice || isMobile) return;
    const handleGlobalMouseMove = (e) => {
      if (readerCursorRef.current) {
        readerCursorRef.current.style.left = e.clientX + 'px';
        readerCursorRef.current.style.top = e.clientY + 'px';
        if (readerCursorRef.current.style.display === 'none') {
          readerCursorRef.current.style.display = 'block';
        }
      }
    };
    document.addEventListener('mousemove', handleGlobalMouseMove);
    return () => document.removeEventListener('mousemove', handleGlobalMouseMove);
  }, []);

  useEffect(() => {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouchDevice) return;
    const sysDot = document.getElementById('cursor-dot');
    if (sysDot) sysDot.style.display = 'none';
    return () => { if (sysDot) sysDot.style.display = 'block'; };
  }, []);

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
    
    const wrapTextNodes = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue.trim().length > 0) {
          const mark = document.createElement('mark');
          mark.style.backgroundColor = 'var(--gold)';
          mark.style.color = 'var(--bg-void, #000)';
          mark.textContent = node.nodeValue;
          return mark;
        }
        return node.cloneNode(false);
      }
      
      const clone = node.cloneNode(false);
      Array.from(node.childNodes).forEach(child => {
        clone.appendChild(wrapTextNodes(child));
      });
      return clone;
    };

    try {
      const fragment = range.extractContents();
      const wrappedFragment = wrapTextNodes(fragment);
      range.insertNode(wrappedFragment);
    } catch(e) {
      console.error("Multi-node highlight error:", e);
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
    const anchor = e.target.closest('a');
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (href.startsWith('http')) {
        window.open(href, '_blank');
        return;
      }
      if (href.startsWith('#')) {
        const fragment = href.substring(1);
        if (!contentRef.current) return;
        let target = contentRef.current.querySelector(`#${CSS.escape(fragment)}`);
        if (!target) {
          const headings = Array.from(contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6, .chapter-heading'));
          target = headings.find(h => h.id === fragment || h.textContent.trim() === fragment);
        }
        if (target) {
          navigateToElement(target);
        }
        return;
      }
      return;
    }

    if (window.getSelection().toString().trim()) return;
    const third = window.innerWidth / 3;
    if (e.clientX < third) prev();
    else if (e.clientX > third * 2) next();
    else setShowToc(false); // click center closes toc/settings
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.changedTouches[0].screenX;
  };
  
  const handleTouchEnd = (e) => {
    touchEndX.current = e.changedTouches[0].screenX;
    handleSwipe();
  };
  
  const handleSwipe = () => {
    const threshold = 50; 
    const diff = touchEndX.current - touchStartX.current;
    
    if (diff < -threshold) next();
    else if (diff > threshold) prev();
  };

  const navigateToElement = (element) => {
    if (!contentRef.current || !element) return;
    const elemRect = element.getBoundingClientRect();
    const absoluteLeft = elemRect.left + (page * window.innerWidth);
    const targetPage = Math.floor(absoluteLeft / window.innerWidth);
    
    setPage(targetPage);
    saveData(targetPage, undefined, undefined);
  };

  const navigateToTocItem = (item) => {
    navigateToElement(item.element);
    setShowToc(false);
  };

  const clearSearch = () => {
    if (!contentRef.current) return;
    const marks = contentRef.current.querySelectorAll('mark.search-match');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    });
    contentRef.current.normalize();
    setSearchResults([]);
    setCurrentSearchIndex(-1);
  };

  const getVisibleText = () => {
    if (!contentRef.current) return '';
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let text = '';
    while ((node = walker.nextNode())) {
      if (!node.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length > 0) {
        let isVisible = false;
        for (let i = 0; i < rects.length; i++) {
          if (rects[i].right > 0 && rects[i].left < window.innerWidth) {
            isVisible = true;
            break;
          }
        }
        if (isVisible) text += node.nodeValue + ' ';
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  };

  const readCurrentPage = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    
    const text = getVisibleText();
    if (!text) {
      setIsSpeaking(false);
      setIsPaused(false);
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = ttsRate;
    if (ttsVoice) utterance.voice = ttsVoice;
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false); };
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false); };
    
    synth.speak(utterance);
    setIsSpeaking(true);
    setIsPaused(false);
  };

  const handleTTS = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    
    if (isSpeaking && !isPaused) {
      synth.pause();
      setIsPaused(true);
      return;
    }
    if (isPaused) {
      synth.resume();
      setIsPaused(false);
      return;
    }
    
    readCurrentPage();
  };

  const stopTTS = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    setIsSpeaking(false);
    setIsPaused(false);
  };

  // Delete a highlight
  const deleteHighlight = (idx) => {
    const newHighlights = highlights.filter((_, i) => i !== idx);
    setHighlights(newHighlights);
    saveData(undefined, newHighlights, undefined);
  };

  // Delete a bookmark
  const deleteBookmark = (idx) => {
    const newBookmarks = bookmarks.filter((_, i) => i !== idx);
    setBookmarks(newBookmarks);
    saveData(undefined, undefined, newBookmarks);
  };

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (isSpeaking && synth && synth.speaking) {
      synth.cancel();
      setTimeout(() => {
        readCurrentPage();
      }, 50);
    }
  }, [page]);

  const handleSearch = (e) => {
    e.preventDefault();
    clearSearch();
    if (!searchQuery.trim() || !contentRef.current) return;

    const query = searchQuery.trim().toLowerCase();
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null, false);
    const matches = [];
    let node;
    let index = 0;
    
    while ((node = walker.nextNode())) {
      if (node.parentNode.tagName === 'MARK') continue;
      
      let pos = node.nodeValue.toLowerCase().indexOf(query);
      while (pos !== -1) {
        const split1 = node.splitText(pos);
        split1.splitText(query.length);
        
        const mark = document.createElement('mark');
        mark.className = 'search-match';
        mark.id = `search-match-${index}`;
        mark.style.backgroundColor = 'var(--gold)';
        mark.style.color = '#000';
        mark.appendChild(split1.cloneNode(true));
        split1.parentNode.replaceChild(mark, split1);
        
        matches.push({ id: mark.id, element: mark });
        index++;
        
        walker.currentNode = mark.nextSibling || mark;
        node = walker.currentNode;
        if (node.nodeType === Node.TEXT_NODE) {
          pos = node.nodeValue.toLowerCase().indexOf(query);
        } else {
          pos = -1;
        }
      }
    }
    
    setSearchResults(matches);
    if (matches.length > 0) goToSearchResult(0, matches);
  };

  const goToSearchResult = (index, results = searchResults) => {
    if (index < 0 || index >= results.length) return;
    if (currentSearchIndex >= 0 && results[currentSearchIndex]) {
      results[currentSearchIndex].element.style.backgroundColor = 'var(--gold)';
    }
    const item = results[index];
    item.element.style.backgroundColor = '#ff6b6b';
    setCurrentSearchIndex(index);
    navigateToElement(item.element);
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
      className="native-reader-root"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: currentTheme.bg,
        color: currentTheme.color,
        display: 'flex', flexDirection: 'column',
        transition: 'background-color 0.4s ease, color 0.4s ease',
        overflow: 'hidden',
        cursor: 'none'
      }}
    >
      <style>{`
        .native-reader-root, .native-reader-root * {
          cursor: none !important;
        }
        .recalculating {
          opacity: 0 !important;
          transition: opacity 0.2s ease !important;
        }
        .reader-content p          { margin: 0 0 0.6em 0; text-indent: 1.5em; }
        .reader-content h1,
        .reader-content h2,
        .reader-content h3   { font-family: 'Playfair Display', serif;
                              color: #BF9B5A; text-align: center;
                              margin: 2.5rem 0 1.5rem; text-indent: 0; }
        .reader-content blockquote { font-style: italic; margin: 1rem 2rem;
                                      opacity: 0.85; }
        .reader-content hr         { border: none; border-top: 1px solid rgba(255,255,255,0.1);
                                      margin: 2rem auto; width: 40%; }
        .reader-content a          { color: #BF9B5A; text-decoration: none; }
        .reader-content table      { margin: 1rem auto; }
      `}</style>
      <div 
        ref={readerCursorRef}
        style={{
          position: 'fixed',
          top: '-10px',
          left: '-10px',
          width: '8px',
          height: '8px',
          backgroundColor: 'var(--ember)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 9999,
          transform: 'translate(-50%, -50%)',
          display: 'none'
        }}
      />
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

      {/* Top bar */}
      <div 
        className="reader-topbar"
        onMouseEnter={() => setShowTopBar(true)}
        onMouseLeave={() => { setShowTopBar(false); setShowSettings(false); setShowToc(false); setShowTtsPanel(false); if (showSearch) { setShowSearch(false); clearSearch(); } }}
      >
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            <ArrowLeft size={16} /> <span className="mono" style={{ fontSize: '10px' }}>{!isMobile && "LIBRARY"}</span>
          </button>
          {!isMobile && (
            <>
              <div style={{ width: '1px', height: '16px', background: 'var(--border)' }}></div>
              <button onClick={() => setShowToc(!showToc)} style={{ color: showToc ? 'var(--ember)' : 'var(--text-secondary)' }}>
                <List size={16} />
              </button>
              <button onClick={() => { 
                const newState = !showSearch; 
                setShowSearch(newState); 
                if (!newState) clearSearch(); 
              }} style={{ color: showSearch ? 'var(--ember)' : 'var(--text-secondary)' }}>
                <Search size={16} />
              </button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* TTS Controls */}
          <button onClick={handleTTS} style={{ color: isSpeaking ? currentTheme.accent : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }} title={isSpeaking ? (isPaused ? 'Resume' : 'Pause') : 'Read aloud'}>
            {isSpeaking ? (isPaused ? <Play size={16} /> : <SquareIcon size={14} />) : <Volume2 size={16} />}
            {isSpeaking && <span className="mono" style={{ fontSize: '9px' }}>{isPaused ? 'RESUME' : 'PAUSE'}</span>}
          </button>
          {isSpeaking && (
            <button onClick={stopTTS} style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }} title="Stop">
              <X size={14} />
            </button>
          )}
          <button onClick={() => setShowTtsPanel(v => !v)} style={{ color: showTtsPanel ? currentTheme.accent : 'var(--text-secondary)' }} title="TTS settings">
            <Volume2 size={14} style={{ opacity: 0.6 }} />
            <span className="mono" style={{ fontSize: '8px', marginLeft: '2px' }}>{ttsRate}×</span>
          </button>
          {!isMobile && (
            <>
              <div style={{ width: '1px', height: '16px', background: 'var(--border)' }}></div>
              {/* Session time */}
              <span className="mono" style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                {sessionTime > 0 ? `${sessionTime}m` : ''}
              </span>
            </>
          )}
          <button onClick={() => { setShowSettings(!showSettings); setShowSearch(false); setShowToc(false); setShowTtsPanel(false); }} style={{ color: showSettings ? currentTheme.accent : 'var(--text-secondary)' }}>
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* SEARCH BAR */}
      {showSearch && (
        <div className="reader-settings" style={{ background: currentTheme.bg, top: '60px', right: '160px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
            <input 
              autoFocus
              className="mono auth-input"
              type="text" 
              placeholder="Search..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ background: 'transparent', border: 'none', borderBottom: `1px solid ${currentTheme.muted}`, outline: 'none', color: currentTheme.color, width: '160px', padding: '4px' }}
            />
            <button type="submit" style={{ opacity: 0.6 }}><Search size={16}/></button>
          </form>
          {searchResults.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="mono" style={{ fontSize: '10px', opacity: 0.6 }}>{currentSearchIndex + 1} OF {searchResults.length}</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => goToSearchResult(currentSearchIndex - 1)} disabled={currentSearchIndex <= 0} style={{ opacity: currentSearchIndex <= 0 ? 0.3 : 0.8 }}><ChevronUp size={16}/></button>
                <button onClick={() => goToSearchResult(currentSearchIndex + 1)} disabled={currentSearchIndex >= searchResults.length - 1} style={{ opacity: currentSearchIndex >= searchResults.length - 1 ? 0.3 : 0.8 }}><ChevronDown size={16}/></button>
              </div>
            </div>
          )}
          {searchResults.length === 0 && searchQuery && (
            <span className="mono" style={{ fontSize: '10px', opacity: 0.5 }}>NO RESULTS</span>
          )}
        </div>
      )}

      {/* SETTINGS PANEL — Redesigned */}
      {showSettings && (
        <div className="reader-settings-v2" style={{ background: currentTheme.bg, borderColor: currentTheme.muted }}>
          {/* Settings Tabs */}
          <div className="settings-tabs">
            <button 
              className={`settings-tab ${settingsTab === 'style' ? 'active' : ''}`}
              onClick={() => setSettingsTab('style')}
              style={{ color: settingsTab === 'style' ? currentTheme.accent : 'inherit', borderColor: settingsTab === 'style' ? currentTheme.accent : 'transparent' }}
            >
              <Type size={14} /> Style
            </button>
            <button 
              className={`settings-tab ${settingsTab === 'layout' ? 'active' : ''}`}
              onClick={() => setSettingsTab('layout')}
              style={{ color: settingsTab === 'layout' ? currentTheme.accent : 'inherit', borderColor: settingsTab === 'layout' ? currentTheme.accent : 'transparent' }}
            >
              <AlignJustify size={14} /> Layout
            </button>
          </div>

          {settingsTab === 'style' && (
            <div className="settings-content">
              {/* Theme */}
              <div className="settings-group">
                <div className="settings-label">THEME</div>
                <div className="settings-row">
                  {[
                    { key: 'ivory', bg: '#FAF6EE', fg: '#2E2A24', label: 'Ivory' },
                    { key: 'sepia', bg: '#F3EAD3', fg: '#4A3B2C', label: 'Sepia' },
                    { key: 'forest', bg: '#E6ECE4', fg: '#283C2C', label: 'Forest' },
                    { key: 'slate', bg: '#1F242D', fg: '#E2E6EC', label: 'Slate' },
                    { key: 'midnight', bg: '#0B0B0F', fg: '#EBEBEE', label: 'Midnight' }
                  ].map(t => (
                    <button 
                      key={t.key}
                      onClick={() => setTheme(t.key)} 
                      className={`theme-swatch ${theme === t.key ? 'active' : ''}`}
                      style={{ 
                        background: t.bg,
                        color: t.fg,
                        borderColor: theme === t.key ? currentTheme.accent : currentTheme.muted
                      }}
                    >
                      <span style={{ fontSize: '14px', fontFamily: "'Libre Baskerville', serif" }}>Aa</span>
                      <span className="mono" style={{ fontSize: '8px', opacity: 0.7 }}>{t.label.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Family */}
              <div className="settings-group">
                <div className="settings-label">FONT</div>
                <div className="font-picker">
                  {FONT_OPTIONS.map(f => (
                    <button
                      key={f.id}
                      className={`font-option ${fontFamily === f.id ? 'active' : ''}`}
                      onClick={() => setFontFamily(f.id)}
                      style={{ 
                        fontFamily: f.family,
                        borderColor: fontFamily === f.id ? currentTheme.accent : currentTheme.muted,
                        background: fontFamily === f.id ? `${currentTheme.accent}12` : 'transparent'
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>Ag</span>
                      <span className="mono" style={{ fontSize: '8px', opacity: 0.6 }}>{f.name.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size */}
              <div className="settings-group">
                <div className="settings-label">SIZE</div>
                <div className="settings-slider-row">
                  <button onClick={() => setFontSize(f => Math.max(12, f - 1))} className="settings-btn"><Minus size={14} /></button>
                  <div className="settings-slider-track">
                    <div className="settings-slider-fill" style={{ width: `${((fontSize - 12) / 16) * 100}%`, background: currentTheme.accent }} />
                    <span className="settings-slider-value">{fontSize}</span>
                  </div>
                  <button onClick={() => setFontSize(f => Math.min(28, f + 1))} className="settings-btn"><Plus size={14} /></button>
                </div>
              </div>
            </div>
          )}

          {settingsTab === 'layout' && (
            <div className="settings-content">
              {/* Line Height */}
              <div className="settings-group">
                <div className="settings-label">LINE HEIGHT</div>
                <div className="settings-slider-row">
                  <button onClick={() => setLineHeight(h => Math.max(1.4, +(h - 0.1).toFixed(1)))} className="settings-btn"><Minus size={14} /></button>
                  <div className="settings-slider-track">
                    <div className="settings-slider-fill" style={{ width: `${((lineHeight - 1.4) / 0.8) * 100}%`, background: currentTheme.accent }} />
                    <span className="settings-slider-value">{lineHeight.toFixed(1)}×</span>
                  </div>
                  <button onClick={() => setLineHeight(h => Math.min(2.2, +(h + 0.1).toFixed(1)))} className="settings-btn"><Plus size={14} /></button>
                </div>
              </div>

              {/* Margins */}
              <div className="settings-group">
                <div className="settings-label">MARGINS</div>
                <div className="settings-row">
                  {MARGIN_OPTIONS.map(m => (
                    <button
                      key={m.id}
                      className={`margin-option ${marginSize === m.id ? 'active' : ''}`}
                      onClick={() => setMarginSize(m.id)}
                      style={{ borderColor: marginSize === m.id ? currentTheme.accent : currentTheme.muted, background: marginSize === m.id ? `${currentTheme.accent}12` : 'transparent' }}
                    >
                      <div className="margin-preview" style={{ borderColor: currentTheme.muted }}>
                        <div style={{ background: currentTheme.muted, height: '2px', width: m.id === 'compact' ? '90%' : m.id === 'comfortable' ? '70%' : '50%', borderRadius: '1px' }} />
                        <div style={{ background: currentTheme.muted, height: '2px', width: m.id === 'compact' ? '85%' : m.id === 'comfortable' ? '65%' : '45%', borderRadius: '1px' }} />
                        <div style={{ background: currentTheme.muted, height: '2px', width: m.id === 'compact' ? '88%' : m.id === 'comfortable' ? '68%' : '48%', borderRadius: '1px' }} />
                      </div>
                      <span className="mono" style={{ fontSize: '8px', opacity: 0.6 }}>{m.label.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Spread toggle (desktop only) */}
              {!isMobile && (
                <div className="settings-group">
                  <div className="settings-label">COLUMNS</div>
                  <div className="settings-row">
                    <button
                      className={`margin-option ${!spread ? 'active' : ''}`}
                      onClick={() => setSpread(false)}
                      style={{ borderColor: !spread ? currentTheme.accent : currentTheme.muted, background: !spread ? `${currentTheme.accent}12` : 'transparent' }}
                    >
                      <Square size={16} style={{ opacity: 0.5 }} />
                      <span className="mono" style={{ fontSize: '8px', opacity: 0.6 }}>SINGLE</span>
                    </button>
                    <button
                      className={`margin-option ${spread ? 'active' : ''}`}
                      onClick={() => setSpread(true)}
                      style={{ borderColor: spread ? currentTheme.accent : currentTheme.muted, background: spread ? `${currentTheme.accent}12` : 'transparent' }}
                    >
                      <Columns size={16} style={{ opacity: 0.5 }} />
                      <span className="mono" style={{ fontSize: '8px', opacity: 0.6 }}>SPREAD</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Live Preview */}
          <div className="settings-preview" style={{ background: currentTheme.muted, color: currentTheme.color, fontFamily: activeFontFamily, fontSize: `${Math.min(fontSize, 15)}px`, lineHeight: lineHeight }}>
            The quick brown fox jumps over the lazy dog. In a quiet village, under the vast canopy of ancient trees…
          </div>
        </div>
      )}

      {/* TTS SETTINGS PANEL */}
      {showTtsPanel && (
        <div className="reader-settings" style={{ background: currentTheme.bg, top: '60px', right: '280px', display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', minWidth: '220px' }}>
          <div className="mono" style={{ fontSize: '10px', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '4px' }}>SPEECH SETTINGS</div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span className="mono" style={{ fontSize: '10px', opacity: 0.6, minWidth: '40px' }}>RATE</span>
            <input 
              type="range" 
              min="0.5" max="2.5" step="0.1" 
              value={ttsRate}
              onChange={e => setTtsRate(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: currentTheme.accent }}
            />
            <span className="mono" style={{ fontSize: '11px', minWidth: '30px' }}>{ttsRate}×</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span className="mono" style={{ fontSize: '10px', opacity: 0.6 }}>VOICE</span>
            <select 
              value={ttsVoice?.name || ''}
              onChange={e => {
                const v = availableVoices.find(v => v.name === e.target.value);
                setTtsVoice(v || null);
              }}
              style={{
                background: 'transparent',
                border: `1px solid ${currentTheme.muted}`,
                color: currentTheme.color,
                padding: '6px 8px',
                borderRadius: '4px',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '10px',
                outline: 'none',
                cursor: 'pointer',
                maxWidth: '200px'
              }}
            >
              <option value="">Default</option>
              {availableVoices.map(v => (
                <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* SIDEBAR — Tabbed (TOC / Highlights / Bookmarks) */}
      <div style={{
        position: 'absolute', top: '60px', left: 0, bottom: 0, width: '320px',
        background: currentTheme.bg, zIndex: 1000,
        borderRight: `1px solid ${currentTheme.muted}`,
        transform: showToc ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex', flexDirection: 'column',
        boxShadow: showToc ? '20px 0 40px rgba(0,0,0,0.5)' : 'none'
      }}>
        {/* Sidebar tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${currentTheme.muted}` }}>
          {[
            { key: 'toc', label: 'CONTENTS' },
            { key: 'highlights', label: `HIGHLIGHTS (${highlights.length})` },
            { key: 'bookmarks', label: `MARKS (${bookmarks.length})` }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className="mono"
              style={{
                flex: 1,
                padding: '14px 8px',
                fontSize: '9px',
                letterSpacing: '0.08em',
                borderBottom: sidebarTab === tab.key ? `2px solid ${currentTheme.accent}` : '2px solid transparent',
                color: sidebarTab === tab.key ? currentTheme.accent : currentTheme.color,
                opacity: sidebarTab === tab.key ? 1 : 0.5,
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {/* TOC Tab */}
          {sidebarTab === 'toc' && (
            tocItems.length === 0 ? (
              <div className="mono" style={{ padding: '24px', opacity: 0.5, fontSize: '10px' }}>NO HEADINGS FOUND</div>
            ) : (
              tocItems.map((item, idx) => (
                <div 
                  key={idx} 
                  onClick={() => navigateToTocItem(item)}
                  style={{ 
                    padding: `12px 24px 12px ${24 + (item.level - 1) * 16}px`,
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontFamily: "'Libre Baskerville', serif",
                    lineHeight: 1.4,
                    opacity: 0.8,
                    transition: 'background 0.2s, opacity 0.2s',
                    borderBottom: `1px solid ${currentTheme.muted}30`
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = currentTheme.muted; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = 0.8; e.currentTarget.style.background = 'transparent'; }}
                >
                  {item.title}
                </div>
              ))
            )
          )}

          {/* Highlights Tab */}
          {sidebarTab === 'highlights' && (
            highlights.length === 0 ? (
              <div className="mono" style={{ padding: '24px', opacity: 0.5, fontSize: '10px' }}>NO HIGHLIGHTS YET<br/><span style={{ opacity: 0.6, fontSize: '9px' }}>Select text and tap HIGHLIGHT to add one.</span></div>
            ) : (
              highlights.map((hl, idx) => (
                <div 
                  key={idx}
                  style={{
                    padding: '14px 20px',
                    borderBottom: `1px solid ${currentTheme.muted}30`,
                    display: 'flex', alignItems: 'flex-start', gap: '12px',
                    cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = currentTheme.muted}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ width: '3px', minHeight: '24px', background: 'var(--gold)', borderRadius: '2px', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontFamily: "'Libre Baskerville', serif", lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                      "{hl.text}"
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteHighlight(idx); }} style={{ opacity: 0.4, flexShrink: 0 }} title="Delete highlight">
                    <X size={12} />
                  </button>
                </div>
              ))
            )
          )}

          {/* Bookmarks Tab */}
          {sidebarTab === 'bookmarks' && (
            bookmarks.length === 0 ? (
              <div className="mono" style={{ padding: '24px', opacity: 0.5, fontSize: '10px' }}>NO BOOKMARKS YET<br/><span style={{ opacity: 0.6, fontSize: '9px' }}>Select text and tap BOOKMARK to add one.</span></div>
            ) : (
              bookmarks.map((bm, idx) => (
                <div 
                  key={idx}
                  onClick={() => { setPage(bm.page); saveData(bm.page, undefined, undefined); setShowToc(false); }}
                  style={{
                    padding: '14px 20px',
                    borderBottom: `1px solid ${currentTheme.muted}30`,
                    display: 'flex', alignItems: 'center', gap: '12px',
                    cursor: 'pointer',
                    transition: 'background 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = currentTheme.muted}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <BookmarkPlus size={14} style={{ opacity: 0.5, flexShrink: 0, color: currentTheme.accent }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontFamily: "'Libre Baskerville', serif", lineHeight: 1.5 }}>
                      {bm.excerpt}
                    </div>
                    <div className="mono" style={{ fontSize: '9px', opacity: 0.4, marginTop: '4px' }}>
                      PAGE {bm.page + 1} · {new Date(bm.time).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); deleteBookmark(idx); }} style={{ opacity: 0.4, flexShrink: 0 }} title="Delete bookmark">
                    <X size={12} />
                  </button>
                </div>
              ))
            )
          )}
        </div>
      </div>

      {/* KEYBOARD SHORTCUTS MODAL */}
      {showShortcutsModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)'
        }} onClick={() => setShowShortcutsModal(false)}>
          <div style={{
            background: currentTheme.bg,
            border: `1px solid ${currentTheme.muted}`,
            borderRadius: '12px',
            padding: '32px',
            maxWidth: '400px',
            width: '90vw',
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
          }} onClick={e => e.stopPropagation()}>
            <div className="mono" style={{ fontSize: '12px', letterSpacing: '0.1em', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              KEYBOARD SHORTCUTS
              <button onClick={() => setShowShortcutsModal(false)} style={{ opacity: 0.5 }}><X size={16} /></button>
            </div>
            {[
              ['← →', 'Navigate pages'],
              ['Space', 'Play / Pause speech'],
              ['Ctrl+F', 'Search in book'],
              ['?', 'Toggle this help'],
              ['Esc', 'Close panels']
            ].map(([key, desc]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${currentTheme.muted}30` }}>
                <span style={{ fontSize: '13px', opacity: 0.8 }}>{desc}</span>
                <kbd style={{
                  background: currentTheme.muted,
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '11px',
                  border: `1px solid ${currentTheme.muted}`
                }}>{key}</kbd>
              </div>
            ))}
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
      <div 
        style={{ flex: 1, position: 'relative' }} 
        onMouseUp={handleMouseUp} 
        onClick={handlePageClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        
        {/* Chapter headers for spread */}
        {effectiveSpread ? (
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

        {/* BOOK CONTENT — CSS multi-column layout */}
        <div style={{
          width: '100vw', height: '100vh', 
          overflow: 'hidden', position: 'relative',
          perspective: '2500px'
        }}>
          {/* Optional Spine for Spread */}
          {effectiveSpread && (
            <div className="spread-spine" />
          )}    
          <div 
            className="page-slider"
            style={{
              transform: `translateX(-${page * 100}vw)`,
              transition: 'transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)',
              width: 'max-content',
              height: '100%',
            }}
          >
            <div 
              ref={contentRef}
              className={`reader-content ${isRecalculating ? 'recalculating' : ''}`}
              style={{
                height: 'calc(100vh - 140px)',
                marginTop: '70px',
                columnWidth: colWidthCalc,
                columnCount: numCols,
                columnGap: `${gap}px`,
                columnFill: 'auto',
                paddingLeft: `${pad}px`,
                paddingRight: `${pad}px`,
                fontSize: `${fontSize}px`,
                lineHeight: lineHeight,
                color: currentTheme.color,
                fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                  ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                  : activeFontFamily,
                boxSizing: 'border-box',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
              dangerouslySetInnerHTML={{ __html: bookHtml }}
            />
          </div>
        </div>

        {/* Left turn zone */}
        <div 
          className="turn-indicator-zone turn-left" 
          onClick={(e) => { e.stopPropagation(); prev(); }}
          style={{ left: 0 }}
        >
          <ArrowLeft size={20} style={{ opacity: 0 }} className="turn-indicator-icon" />
        </div>

        {/* Right turn zone */}
        <div 
          className="turn-indicator-zone turn-right" 
          onClick={(e) => { e.stopPropagation(); next(); }}
          style={{ right: 0 }}
        >
          <ArrowRight size={20} style={{ opacity: 0 }} className="turn-indicator-icon" />
        </div>

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
