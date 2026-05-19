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
    (u) => window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? null : `/api/proxy?url=${encodeURIComponent(u)}`,
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
  const [isFlipping, setIsFlipping] = useState(false);
  const [flipDirection, setFlipDirection] = useState('');
  const [flipPage, setFlipPage] = useState(0);
  const [flipHtml, setFlipHtml] = useState('');
  
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [sessionTime, setSessionTime] = useState(0);
  const [showTopBar, setShowTopBar] = useState(false);

  const sessionStartTime = useRef(Date.now());
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const contentRef = useRef(null);
  const htmlToInject = useRef('');
  const highlightsToRestore = useRef([]);
  const [totalPages, setTotalPages] = useState(1);
  const [isRecalculating, setIsRecalculating] = useState(false);

  const [selectionMenu, setSelectionMenu] = useState(null);
  
  // Storage logic
  const [highlights, setHighlights] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);

  // Persist reader prefs whenever they change
  useEffect(() => {
    saveReaderPrefs({ fontSize, fontFamily, lineHeight, marginSize, theme, spread });
  }, [fontSize, fontFamily, lineHeight, marginSize, theme, spread]);

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

      // Internet Archive books: resolve actual download URLs first
      if (book._source === 'archive' && book._iaIdentifier) {
        try {
          await loadIABook(book._iaIdentifier, savedHighlights);
          return;
        } catch (err) {
          console.error('IA load error:', err);
          if (isMounted) {
            setError('Unable to load this book from Internet Archive. The book may only be available as scanned PDF.');
            setLoading(false);
          }
          return;
        }
      }

      const epubUrl = book.formats['application/epub+zip'];
      if (!epubUrl) {
        await loadHtmlTier(savedHighlights);
        return;
      }

      try {
        const arrayBuffer = await fetchWithProxy(epubUrl, 'arraybuffer');

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
          
          stripGutenbergBoilerplate(chapterDoc);

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
            const safeStyles = [];
            if (el.style.textAlign) safeStyles.push(`text-align: ${el.style.textAlign}`);
            if (el.style.fontStyle) safeStyles.push(`font-style: ${el.style.fontStyle}`);
            if (el.style.fontWeight) safeStyles.push(`font-weight: ${el.style.fontWeight}`);
            
            el.removeAttribute("style");
            if (safeStyles.length > 0) {
              el.setAttribute("style", safeStyles.join('; '));
            }
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
        if (isMounted) await loadHtmlTier(savedHighlights);
      }
    };

    loadBook();
    const existingTime = parseInt(localStorage.getItem(`archivum_time_${book.id}`) || '0', 10);
    setSessionTime(existingTime);

    return () => { isMounted = false; };
  }, [book, user]);

  // ========== Internet Archive book loader ==========
  const loadIABook = async (identifier, savedHighlights) => {
    // Fetch metadata to find downloadable files
    const metaRes = await fetch(`https://archive.org/metadata/${identifier}/files`);
    const metaData = await metaRes.json();
    const files = metaData?.result || [];

    // Find EPUB file
    let epubFile = files.find(f => f.name?.toLowerCase().endsWith('.epub'));
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

    if (epubFile) {
      try {
        const epubUrl = `${baseUrl}/${encodeURIComponent(epubFile.name)}`;
        const arrayBuffer = await fetch(epubUrl).then(r => {
          if (!r.ok) throw new Error('EPUB fetch failed');
          return r.arrayBuffer();
        });

        const JSZip = window.JSZip;
        if (!JSZip) throw new Error('JSZip not loaded');
        const zip = await JSZip.loadAsync(arrayBuffer);

        // Parse container.xml
        const containerFile = zip.file('META-INF/container.xml');
        if (!containerFile) throw new Error('No container.xml');
        const containerXml = await containerFile.async('string');
        const parser = new DOMParser();
        const containerDoc = parser.parseFromString(containerXml, 'application/xml');
        const rootfile = Array.from(containerDoc.getElementsByTagName('*')).find(el => el.localName === 'rootfile');
        const opfPath = rootfile.getAttribute('full-path');

        const opfBaseDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
        const resolveOpfPath = (href) => opfBaseDir + href;

        const opfFile = zip.file(opfPath);
        if (!opfFile) throw new Error('OPF not found');
        const opfXml = await opfFile.async('string');
        const opfDoc = parser.parseFromString(opfXml, 'application/xml');

        const manifest = {};
        const items = Array.from(opfDoc.getElementsByTagName('*')).filter(el => el.localName === 'item');
        for (const item of items) {
          manifest[item.getAttribute('id')] = item.getAttribute('href');
        }

        const itemrefs = Array.from(opfDoc.getElementsByTagName('*')).filter(el => el.localName === 'itemref');
        const spineIds = itemrefs.map(itemref => itemref.getAttribute('idref'));

        let finalHtml = '';
        for (const id of spineIds) {
          const href = manifest[id];
          if (!href) continue;
          const fullPath = resolveOpfPath(decodeURIComponent(href));
          const chapterFile = zip.file(fullPath);
          if (!chapterFile) continue;

          const chapterHtml = await chapterFile.async('string');
          const chapterDoc = parser.parseFromString(chapterHtml, 'text/html');
          chapterDoc.querySelectorAll('style, link, script').forEach(el => el.remove());

          // Skip Gutenberg boilerplate stripping for IA books

          chapterDoc.body.querySelectorAll('*').forEach(el => {
            const safeStyles = [];
            if (el.style.textAlign) safeStyles.push(`text-align: ${el.style.textAlign}`);
            if (el.style.fontStyle) safeStyles.push(`font-style: ${el.style.fontStyle}`);
            if (el.style.fontWeight) safeStyles.push(`font-weight: ${el.style.fontWeight}`);
            el.removeAttribute('style');
            if (safeStyles.length > 0) el.setAttribute('style', safeStyles.join('; '));
          });

          finalHtml += `<div class="chapter-break"></div>${chapterDoc.body.innerHTML}`;
        }

        htmlToInject.current = finalHtml;
        highlightsToRestore.current = savedHighlights;
        setLoading(false);
        return;
      } catch (epubErr) {
        console.warn('IA EPUB parse failed, trying text:', epubErr);
      }
    }

    // Fallback: try text file
    if (textFile) {
      const textUrl = `${baseUrl}/${encodeURIComponent(textFile.name)}`;
      const text = await fetch(textUrl).then(r => r.text());

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

      htmlToInject.current = fullHtml;
      highlightsToRestore.current = savedHighlights || [];
      setLoading(false);
      return;
    }

    // Fallback: try HTML
    if (htmlFile) {
      const htmlUrl = `${baseUrl}/${encodeURIComponent(htmlFile.name)}`;
      const htmlText = await fetch(htmlUrl).then(r => r.text());
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, 'text/html');
      doc.querySelectorAll('style, link, script, meta, title').forEach(el => el.remove());

      htmlToInject.current = doc.body.innerHTML;
      highlightsToRestore.current = savedHighlights || [];
      setLoading(false);
      return;
    }

    throw new Error('No readable format found in this Internet Archive item.');
  };

  // Tier 2: Fetch HTML version from Gutenberg
  const loadHtmlTier = async (savedHighlights) => {
    try {
      const htmlUrl = book.formats['text/html'] || book.formats['text/html; charset=utf-8'];
      if (!htmlUrl) {
        await loadPlainTextFallback(savedHighlights);
        return;
      }
      
      const htmlText = await fetchWithProxy(htmlUrl, 'text');
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      
      doc.querySelectorAll("style, link, script, meta, title, header, footer").forEach(el => el.remove());
      
      stripGutenbergBoilerplate(doc);

      const imgs = doc.querySelectorAll("img");
      for (const img of Array.from(imgs)) {
        const src = img.getAttribute("src");
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
           try {
             const absoluteUrl = new URL(src, htmlUrl).href;
             img.setAttribute("src", absoluteUrl);
           } catch(e) {}
        }
        img.removeAttribute("class");
        img.removeAttribute("style");
      }
      
      doc.body.querySelectorAll("*").forEach(el => {
        const safeStyles = [];
        if (el.style.textAlign) safeStyles.push(`text-align: ${el.style.textAlign}`);
        if (el.style.fontStyle) safeStyles.push(`font-style: ${el.style.fontStyle}`);
        if (el.style.fontWeight) safeStyles.push(`font-weight: ${el.style.fontWeight}`);
        
        el.removeAttribute("style");
        if (safeStyles.length > 0) {
          el.setAttribute("style", safeStyles.join('; '));
        }
        // Keep classes so structural CSS rules (like .chapter) can be applied if needed.
      });
      
      htmlToInject.current = doc.body.innerHTML;
      highlightsToRestore.current = savedHighlights || [];
      setLoading(false);
      
    } catch (err) {
      console.error("HTML fetch error:", err);
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

      htmlToInject.current = doc.body.innerHTML;
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
      
      const injectedImgs = contentRef.current.querySelectorAll('img');
      injectedImgs.forEach(img => {
        img.onerror = () => { img.style.display = 'none'; };
        img.style.maxWidth = '100%';
        img.style.maxHeight = '40vh';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '1rem auto';
      });

      restoreHighlights(contentRef.current, highlightsToRestore.current);
      
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
    if (isFlipping) return;
    setPage(p => {
      const newPage = Math.min(totalPages - 1, p + 1);
      if (newPage !== p) {
        if (contentRef.current) {
          setFlipHtml(contentRef.current.innerHTML);
        }
        setFlipPage(p);
        setFlipDirection('next');
        setIsFlipping(true);
        setTimeout(() => {
          setIsFlipping(false);
          setFlipDirection('');
        }, 550);
      }
      saveData(newPage, undefined, undefined);
      return newPage;
    });
  }, [totalPages, isFlipping]);

  const prev = useCallback(() => {
    if (isFlipping) return;
    setPage(p => {
      const newPage = Math.max(0, p - 1);
      if (newPage !== p) {
        if (contentRef.current) {
          setFlipHtml(contentRef.current.innerHTML);
        }
        setFlipPage(p);
        setFlipDirection('prev');
        setIsFlipping(true);
        setTimeout(() => {
          setIsFlipping(false);
          setFlipDirection('');
        }, 550);
      }
      saveData(newPage, undefined, undefined);
      return newPage;
    });
  }, [isFlipping]);

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
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    synth.speak(utterance);
    setIsSpeaking(true);
  };

  const handleTTS = () => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    
    if (isSpeaking) {
      synth.cancel();
      setIsSpeaking(false);
      return;
    }
    
    readCurrentPage();
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
        onMouseLeave={() => { setShowTopBar(false); setShowSettings(false); setShowToc(false); setShowSearch(false); }}
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
              <button onClick={() => setShowSearch(!showSearch)} style={{ color: showSearch ? 'var(--ember)' : 'var(--text-secondary)' }}>
                <Search size={16} />
              </button>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          {/* TTS Button */}
          <button onClick={handleTTS} style={{ color: isSpeaking ? currentTheme.accent : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Volume2 size={16} />
            {isSpeaking && <span className="mono" style={{ fontSize: '9px' }}>STOP</span>}
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
          <button onClick={() => { setShowSettings(!showSettings); setShowSearch(false); setShowToc(false); }} style={{ color: showSettings ? currentTheme.accent : 'var(--text-secondary)' }}>
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

      {/* TOC SIDEBAR */}
      <div style={{
        position: 'absolute', top: '60px', left: 0, bottom: 0, width: '300px',
        background: currentTheme.bg, zIndex: 1000,
        borderRight: `1px solid ${currentTheme.muted}`,
        transform: showToc ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex', flexDirection: 'column',
        boxShadow: showToc ? '20px 0 40px rgba(0,0,0,0.5)' : 'none'
      }}>
        <div className="mono" style={{ padding: '24px', fontSize: '12px', letterSpacing: '0.1em', borderBottom: `1px solid ${currentTheme.muted}` }}>
          TABLE OF CONTENTS
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {tocItems.length === 0 ? (
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
          )}
        </div>
      </div>

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

        {/* Left arrow */}
        <button className="nav-arrow" onClick={(e) => { e.stopPropagation(); prev(); }} style={{ left: '1vw' }}
          onMouseEnter={e=>e.currentTarget.style.opacity=0.3} onMouseLeave={e=>e.currentTarget.style.opacity=0}>
          <ArrowLeft size={28} />
        </button>

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
              transition: isFlipping ? 'none' : 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              width: 'max-content',
              height: '100%',
              opacity: isFlipping ? 0 : 1,
              pointerEvents: isFlipping ? 'none' : 'auto'
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
            >
            </div>
          </div>

          {/* 3D Page Flip Overlay */}
          {isFlipping && (
            <div 
              className="book-flip-overlay"
              style={{
                backgroundColor: currentTheme.bg,
                color: currentTheme.color,
              }}
            >
              {effectiveSpread ? (
                <>
                  {/* Static Left Page (Fixed) */}
                  <div className="book-page">
                    <div 
                      className="book-page-content"
                      style={{
                        columnWidth: colWidthCalc,
                        columnCount: numCols,
                        columnGap: `${gap}px`,
                        paddingLeft: `${pad}px`,
                        paddingRight: `${pad}px`,
                        fontSize: `${fontSize}px`,
                        lineHeight: lineHeight,
                        color: currentTheme.color,
                        fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                          ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                          : activeFontFamily,
                        transform: `translateX(-${(flipDirection === 'next' ? flipPage : page) * 100}vw)`,
                        left: 0
                      }}
                      dangerouslySetInnerHTML={{ __html: flipHtml }}
                    />
                  </div>

                  {/* Static Right Page (Fixed) */}
                  <div className="book-page">
                    <div 
                      className="book-page-content"
                      style={{
                        columnWidth: colWidthCalc,
                        columnCount: numCols,
                        columnGap: `${gap}px`,
                        paddingLeft: `${pad}px`,
                        paddingRight: `${pad}px`,
                        fontSize: `${fontSize}px`,
                        lineHeight: lineHeight,
                        color: currentTheme.color,
                        fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                          ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                          : activeFontFamily,
                        transform: `translateX(-${(flipDirection === 'next' ? page : flipPage) * 100}vw)`,
                        left: '-50vw'
                      }}
                      dangerouslySetInnerHTML={{ __html: flipHtml }}
                    />
                  </div>

                  {/* Flipping Page */}
                  <div className={`flipping-page-wrapper ${flipDirection === 'next' ? 'flip-next' : 'flip-prev'}`}>
                    <div className="flipping-page-flipper">
                      {/* Front Face */}
                      <div className="flipping-page-face face-front">
                        <div 
                          className="book-page-content"
                          style={{
                            columnWidth: colWidthCalc,
                            columnCount: numCols,
                            columnGap: `${gap}px`,
                            paddingLeft: `${pad}px`,
                            paddingRight: `${pad}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: lineHeight,
                            color: currentTheme.color,
                            fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                              ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                              : activeFontFamily,
                            transform: `translateX(-${flipPage * 100}vw)`,
                            left: flipDirection === 'next' ? '-50vw' : '0'
                          }}
                          dangerouslySetInnerHTML={{ __html: flipHtml }}
                        />
                      </div>
                      {/* Back Face */}
                      <div className="flipping-page-face face-back">
                        <div 
                          className="book-page-content"
                          style={{
                            columnWidth: colWidthCalc,
                            columnCount: numCols,
                            columnGap: `${gap}px`,
                            paddingLeft: `${pad}px`,
                            paddingRight: `${pad}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: lineHeight,
                            color: currentTheme.color,
                            fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                              ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                              : activeFontFamily,
                            transform: `translateX(-${page * 100}vw)`,
                            left: flipDirection === 'next' ? '0' : '-50vw'
                          }}
                          dangerouslySetInnerHTML={{ __html: flipHtml }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="spread-spine" />
                </>
              ) : (
                <>
                  {/* Static Underneath Page */}
                  <div className="book-page single">
                    <div 
                      className="book-page-content"
                      style={{
                        columnWidth: colWidthCalc,
                        columnCount: numCols,
                        columnGap: `${gap}px`,
                        paddingLeft: `${pad}px`,
                        paddingRight: `${pad}px`,
                        fontSize: `${fontSize}px`,
                        lineHeight: lineHeight,
                        color: currentTheme.color,
                        fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                          ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                          : activeFontFamily,
                        transform: `translateX(-${page * 100}vw)`,
                        left: 0
                      }}
                      dangerouslySetInnerHTML={{ __html: flipHtml }}
                    />
                  </div>

                  {/* Flipping Page */}
                  <div className={`flipping-page-wrapper single ${flipDirection === 'next' ? 'flip-next' : 'flip-prev'}`}>
                    <div className="flipping-page-flipper">
                      {/* Front Face */}
                      <div className="flipping-page-face face-front">
                        <div 
                          className="book-page-content"
                          style={{
                            columnWidth: colWidthCalc,
                            columnCount: numCols,
                            columnGap: `${gap}px`,
                            paddingLeft: `${pad}px`,
                            paddingRight: `${pad}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: lineHeight,
                            color: currentTheme.color,
                            fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                              ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                              : activeFontFamily,
                            transform: `translateX(-${flipPage * 100}vw)`,
                            left: 0
                          }}
                          dangerouslySetInnerHTML={{ __html: flipHtml }}
                        />
                      </div>
                      {/* Back Face */}
                      <div className="flipping-page-face face-back">
                        <div 
                          className="book-page-content"
                          style={{
                            columnWidth: colWidthCalc,
                            columnCount: numCols,
                            columnGap: `${gap}px`,
                            paddingLeft: `${pad}px`,
                            paddingRight: `${pad}px`,
                            fontSize: `${fontSize}px`,
                            lineHeight: lineHeight,
                            color: currentTheme.color,
                            fontFamily: (book.languages?.[0] || '').match(/^(hi|hin|hindi)$/i)
                              ? "'Noto Sans Devanagari', 'Libre Baskerville', Georgia, serif"
                              : activeFontFamily,
                            transform: `translateX(-${page * 100}vw)`,
                            left: 0
                          }}
                          dangerouslySetInnerHTML={{ __html: flipHtml }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
