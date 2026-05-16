# ✦ MASTER PROMPT: ARCHIVUM — AN IMMERSIVE FREE LIBRARY
*A single index.html. Drop on Vercel. Open browser. Start reading.*

---

## ◈ WHAT YOU ARE BUILDING

A **single self-contained `index.html` file** — no build step, no framework, no backend, no API key, no server. Drag it into Vercel and it is live. Open it in a browser and within 3 seconds you are reading Moby Dick, Dracula, or The Art of War in the most beautiful reading environment ever built for the open web.

**The entire data layer is free and external:**
- **Catalog + metadata + covers** → Gutendex API: `https://gutendex.com/books/`
- **Book content (reading)** → Project Gutenberg HTML pages loaded in a full-screen iframe overlay
- **User data (bookmarks, progress, highlights)** → browser localStorage only

Nothing is stored on your server. Nothing costs money. Nothing breaks.

---

## ◈ THE SINGLE GOLDEN RULE

> The moment the user clicks a book, they should be **reading it within one second** — full screen, distraction-free, beautiful. Discovery is fast. Reading is instant. This is the whole point.

---

## ◈ TECHNICAL ARCHITECTURE

```
index.html  (single file on Vercel)
│
├── Catalog Layer
│   └── fetch('https://gutendex.com/books/?page=1')
│       Returns: title, author, subjects, cover image URL, format URLs
│
├── Reading Layer  
│   └── Open book.formats['text/html'] in a full-screen styled iframe
│       Inject custom CSS into iframe for beautiful typography
│       Fallback: link to gutenberg.org/ebooks/{id} if iframe blocked
│
└── Persistence Layer
    └── localStorage only
        Keys: 'archivum_bookmarks', 'archivum_progress_{id}', 'archivum_history'
```

### Gutendex API Reference
```javascript
// Fetch catalog (paginated, 32 books per page)
GET https://gutendex.com/books/
GET https://gutendex.com/books/?page=2
GET https://gutendex.com/books/?search=sherlock+holmes
GET https://gutendex.com/books/?topic=fiction
GET https://gutendex.com/books/?languages=en
GET https://gutendex.com/books/?ids=84,1342,11   // specific books

// Each book object shape:
{
  id: 84,
  title: "Frankenstein",
  authors: [{ name: "Shelley, Mary Wollstonecraft", birth_year: 1797 }],
  subjects: ["Horror tales", "Science fiction"],
  bookshelves: ["Gothic Fiction"],
  languages: ["en"],
  download_count: 94000,
  formats: {
    "image/jpeg": "https://...cover.jpg",         // cover art
    "text/html": "https://gutenberg.org/...",      // READ THIS
    "application/epub+zip": "https://...epub",    // download
    "text/plain": "https://..."                    // plain text
  }
}
```

---

## ◈ VISUAL DESIGN SYSTEM

### The Aesthetic
**Dark luxury editorial.** The feeling of a private library at 2am. Candlelight on leather. The weight of old paper. But built with razor-sharp modern precision. Think: a Criterion Collection bluray menu crossed with a high-end publishing house website. Every element feels considered, weighted, intentional.

Reference touchpoints:
- enerblock.net — technical precision, architectural grid, numbered systems
- unseen.co — theatrical reveals, spatial navigation, letter-by-letter choreography  
- pixel.melbourne — oversized type bleeding off edges, full-bleed darkness

### Color Tokens
```css
:root {
  /* Backgrounds */
  --bg-void:      #06060A;   /* deepest background — almost black */
  --bg-surface:   #0E0E15;   /* card and panel surfaces */
  --bg-raised:    #16161F;   /* elevated elements */
  --bg-overlay:   #1C1C28;   /* modals, tooltips */

  /* Text */
  --text-primary:   #EDE8DF;  /* warm off-white — main text */
  --text-secondary: #7A7A8A;  /* metadata, captions */
  --text-muted:     #3A3A4A;  /* disabled, decorative */

  /* Accents */
  --ember:   #E04E2A;   /* primary CTA, active states — use sparingly */
  --gold:    #BF9B5A;   /* literary luxury, hover states */
  --slate:   #4A6FA5;   /* links, secondary actions */

  /* Structural */
  --border:  rgba(255,255,255,0.06);
  --glow:    rgba(224, 78, 42, 0.15);
}
```

### Typography
```html
<!-- Load from Google Fonts CDN — single request -->
<link href="https://fonts.googleapis.com/css2?
  family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&
  family=JetBrains+Mono:wght@300;400&
  family=Libre+Baskerville:ital,wght@0,400;1,400&
  display=swap" rel="stylesheet">
```

```css
/* Usage rules — follow exactly */

/* Hero titles, book titles in detail view */
.display { font-family: 'Playfair Display', Georgia, serif; }

/* ALL metadata: dates, indices, labels, counts, tags */
.mono { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }

/* Body text, descriptions, all reading UI labels */
.body-text { font-family: 'Libre Baskerville', Georgia, serif; line-height: 1.75; }
```

### 3D System
```css
/* Every interactive card lives in 3D space */
.book-card {
  transform-style: preserve-3d;
  transform: perspective(800px) rotateX(0deg) rotateY(0deg) translateZ(0);
  transition: transform 0.5s cubic-bezier(0.23, 1, 0.32, 1),
              box-shadow 0.5s cubic-bezier(0.23, 1, 0.32, 1);
  will-change: transform;
}

.book-card:hover {
  /* JS injects --rx and --ry from mouse position relative to card center */
  transform: perspective(800px)
             rotateX(calc(var(--rx, 0) * 1deg))
             rotateY(calc(var(--ry, 0) * 1deg))
             translateZ(20px);
  box-shadow:
    0 30px 60px rgba(0,0,0,0.6),
    0 0 0 1px var(--border),
    inset 0 1px 0 rgba(255,255,255,0.08);
}

/* Shimmer highlight that follows mouse on card surface */
.book-card::after {
  content: '';
  position: absolute; inset: 0;
  background: radial-gradient(
    circle at calc(var(--mx, 50%) * 1%) calc(var(--my, 50%) * 1%),
    rgba(255,255,255,0.08) 0%,
    transparent 60%
  );
  pointer-events: none;
}
```

---

## ◈ FULL PAGE STRUCTURE

### APP SHELL
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Archivum — 70,000 Free Books</title>
  <!-- Google Fonts -->
  <!-- All CSS in <style> tag -->
</head>
<body>
  <div id="cursor-dot"></div>        <!-- custom cursor -->
  <div id="loader"></div>            <!-- loading screen -->
  
  <div id="app">
    <header id="nav"></header>
    <section id="hero"></section>
    <section id="catalog"></section>
    <div id="book-detail"></div>     <!-- slide-up panel -->
    <div id="reader"></div>          <!-- full-screen reading mode -->
  </div>

  <!-- All JS in <script> tag -->
</body>
</html>
```

---

### SCREEN 1 — LOADER (0–2.5 seconds)
```
Full screen #06060A background.

Sequence (use setTimeout chains, not CSS animation-delay):

  t=0ms    — Single ember dot appears center. Scale 0→1, 300ms ease-out.
  t=400ms  — Dot becomes horizontal line. Width 4px→60vw, 400ms.
  t=900ms  — Line fades. "ARCHIVUM" appears letter by letter.
             Each letter: opacity 0→1, translateY 8px→0, 60ms stagger.
  t=1500ms — Below title: mono text types out char by char:
             "LOADING 70,000 WORKS FROM PROJECT GUTENBERG..."
  t=1800ms — API call fires. Counter appears: "000,000"
             Counts to 070,000 in 500ms (eased).
  t=2400ms — Entire loader: opacity 1→0, 300ms.
             App underneath fades in simultaneously.
```

---

### SCREEN 2 — HERO (100vh)
```
Layout: Full viewport. Dark background. Three depth layers (parallax on scroll).

LAYER 1 (background, scrolls at 0.15x speed):
  — Faint grid lines: 1px rgba(255,255,255,0.03), 60px spacing
  — CSS only. background-image: linear-gradient lines trick.

LAYER 2 (midground, scrolls at 0.4x):
  — Decorative large numeral "70,000" in --text-muted color
    Font: Playfair Display, 25vw, opacity 0.06, positioned right side
  — Vertical mono text: "EST. 1971 — PROJECT GUTENBERG" rotated -90deg, left edge

LAYER 3 (foreground, scrolls at 1x):
  — Main headline, left-aligned, starts at 20% from top:

    <span class="mono" style="color:var(--ember)">// THE FREE LIBRARY</span>
    <h1 style="font-size: clamp(3rem, 8vw, 9rem); line-height: 0.95">
      Seventy<br>
      <em>Thousand</em><br>   ← italic, slightly indented
      Stories.
    </h1>
    
  — Below h1: "Playfair Display" 18px body description:
    "Every great book ever written. Free. Beautiful. Yours."
    
  — Below that: Two buttons side by side:
    [EXPLORE THE CATALOG →]  ← ember filled, Libre Baskerville
    [OPEN RANDOM BOOK]       ← ghost border only

  — Bottom of hero: animated down-chevron SVG, bounces gently
  — Bottom-right: small mono label "SCROLL"
```

---

### SCREEN 3 — NAVIGATION BAR
```
Appears ONLY after hero scrolls out of view (IntersectionObserver).
Slides down from top: translateY(-100%) → translateY(0), 400ms.

Background: rgba(6,6,10,0.92) + backdrop-filter: blur(20px) saturate(180%)
Height: 60px
Border-bottom: 1px solid var(--border)

Layout (flex, space-between):
  LEFT:   "ARCHIVUM" in JetBrains Mono 12px tracking-widest + ember dot
  CENTER: Search input — no border, no background, just bottom border 1px
          Placeholder: "search titles, authors, subjects..."
          Live search: debounce 400ms, hits Gutendex API
  RIGHT:  Genre filter pills (horizontal scroll on mobile):
          [ALL] [FICTION] [DRAMA] [POETRY] [PHILOSOPHY] [SCIENCE] [HISTORY]
          Active state: ember background, bone text
          
          + small icon buttons: [⊞ GRID] [≡ LIST]
```

---

### SCREEN 4 — CATALOG GRID
```
Below hero. Padding: 80px 5vw.

Section header:
  <span class="mono">01 — CATALOG</span>
  <h2 style="font-size: clamp(2rem, 4vw, 3.5rem)">The Archive</h2>
  <span class="mono" id="result-count">Showing 32 of 70,000 works</span>

Grid layout:
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 24px;
  
Each BOOK CARD:
  Width: 100% of column. Height: auto.
  Background: var(--bg-surface)
  Border: 1px solid var(--border)
  Border-radius: 4px
  Overflow: hidden
  Cursor: pointer (custom cursor expands)

  CARD ANATOMY (top to bottom):
  ┌─────────────────────────┐
  │                         │
  │   COVER IMAGE           │  → aspect-ratio: 2/3, object-fit: cover
  │   (or generated canvas) │    If no cover: generate gradient cover
  │                         │    using title hash for color seed
  │                         │
  ├─────────────────────────┤
  │ 01847           FICTION │  ← mono 10px: index left, genre right
  │                         │
  │ Frankenstein            │  ← Playfair Display, 17px, 2-line clamp
  │                         │
  │ Mary Shelley · 1818     │  ← mono, --text-secondary
  │                         │
  │ ━━━━━━━━━━━━━━━━━━━━━━  │  ← 1px ember line
  │                         │
  │ READ →        94k reads │  ← mono 10px
  └─────────────────────────┘

  ON HOVER:
  - Card lifts: translateZ(20px), 3D tilt from mouse JS
  - Cover image: scale(1.04), 500ms
  - Ember line: width animates 0→100%
  - "READ →" becomes ember colored
  - Shadow: 0 20px 60px rgba(0,0,0,0.5)

Generated Cover (canvas, when no image):
  - Background gradient seeded from title char codes → unique per book
  - Title text rendered on canvas in Playfair Display
  - Author name in smaller mono text
  - A thin decorative rule
  - Result looks like a real minimal book cover

INFINITE SCROLL:
  - Load first 32 books on mount
  - IntersectionObserver on last card
  - When visible: fetch next page, append cards with staggered fade-in
  - Show subtle "Loading more..." mono text at bottom while fetching
```

---

### SCREEN 5 — BOOK DETAIL PANEL
```
Triggered by: clicking any book card.
Animation: slides up from bottom (translateY(100%) → translateY(0)), 500ms cubic.
Covers bottom 70% of screen. Top 30% shows catalog with blur overlay.

Background: var(--bg-overlay)
Border-top: 1px solid var(--border)
Backdrop: blur(4px) on the catalog behind

Layout (two columns on desktop, stacked on mobile):

LEFT COLUMN (40%):
  - Book cover, large (max 280px wide)
  - 3D effect: slight rotateY(-5deg) perspective, drop shadow right
  - Below cover: [DOWNLOAD EPUB ↓] button — mono, ghost border

RIGHT COLUMN (60%):
  - Small mono label: "WORK № 00084"
  - Title: Playfair Display, clamp(1.8rem, 3vw, 3rem)
  - Author + birth year: mono, --gold color
  - Published year: mono, --text-secondary
  - Thin ember rule (40px wide)
  - Description/subjects as tags: pill buttons, --bg-raised bg
  - Download count: mono "94,231 readers"
  - Spacer
  - PRIMARY CTA: large ember button full width
    "OPEN & READ THIS BOOK →"
    On click → opens reader mode
  - Secondary: "VIEW ON GUTENBERG ↗" — mono link, opens new tab

CLOSE BUTTON: top-right × — morphs from + on hover, 300ms rotation
```

---

### SCREEN 6 — READER MODE (THE WHOLE POINT)
```
THIS IS THE MOST IMPORTANT SCREEN. Get this right above everything else.

Triggered by: clicking "OPEN & READ THIS BOOK →"
Animation: book detail slides down, reader expands from center, 600ms.

READER LAYOUT:
  Position: fixed, inset: 0. Full screen takeover. z-index: 1000.
  Background: var(--bg-void)

TOP READER BAR (48px, fixed at top):
  Background: rgba(6,6,10,0.95) + blur
  Left:   ← back arrow + book title (truncated, Playfair, 14px)
  Center: progress bar — thin 1px ember line, width% = scroll progress
  Right:  [Aa] font size toggle | [☾] night/sepia/paper mode | [⊡] fullscreen

IFRAME CONTAINER:
  Width: min(720px, 90vw)   ← optimal reading width
  Margin: 0 auto
  Padding: 60px 0
  
  iframe src = book.formats['text/html']  (Gutenberg HTML version)
  iframe style:
    width: 100%
    height: 100vh  
    border: none
    background: transparent

  CSS INJECTED INTO IFRAME via onload:
  document.querySelector('iframe').onload = function() {
    const style = this.contentDocument.createElement('style');
    style.textContent = `
      body {
        background: #06060A !important;
        color: #EDE8DF !important;
        font-family: 'Libre Baskerville', Georgia, serif !important;
        font-size: 18px !important;
        line-height: 1.8 !important;
        max-width: 680px !important;
        margin: 0 auto !important;
        padding: 40px 20px 120px !important;
      }
      h1, h2, h3 {
        font-family: 'Playfair Display', Georgia, serif !important;
        color: #EDE8DF !important;
      }
      a { color: #BF9B5A !important; }
      img { max-width: 100% !important; }
      pre, code { font-family: 'JetBrains Mono', monospace !important; font-size: 14px !important; }
    `;
    this.contentDocument.head.appendChild(style);
  };

READING MODES (toggled by [Aa] button):
  Night  → bg: #06060A, text: #EDE8DF  (default)
  Sepia  → bg: #1A1209, text: #D4B896
  Paper  → bg: #F5F0E8, text: #2C2416

FONT SIZE (toggled by [Aa] slider):
  Small: 16px | Medium: 18px (default) | Large: 21px | XL: 24px
  Injected as CSS variable into iframe

PROGRESS TRACKING:
  iframe scroll position → saved to localStorage every 5 seconds
  key: 'archivum_progress_{bookId}'
  On next open: iframe scrolls to saved position instantly

KEYBOARD SHORTCUTS (shown in minimal help overlay):
  ESC → close reader, back to catalog
  F   → toggle fullscreen (document.documentElement.requestFullscreen())
  +/- → font size up/down
  M   → cycle reading modes
```

---

## ◈ MICRO-INTERACTIONS SPECIFICATION

### Custom Cursor
```javascript
// Replace system cursor entirely
const dot = document.getElementById('cursor-dot');
document.body.style.cursor = 'none';

document.addEventListener('mousemove', e => {
  // Smooth follow with lerp
  dot.style.left = e.clientX + 'px';
  dot.style.top  = e.clientY + 'px';
});

// States:
// Default: 8px ember circle
// Hover link/button: expands to 40px ring, mix-blend-mode: difference
// Hover book card: changes to "READ" text label
// Hover CTA button: becomes arrow →
// In reader mode: hidden (restore system cursor)
```

### 3D Card Tilt (Magnetic)
```javascript
document.querySelectorAll('.book-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect  = card.getBoundingClientRect();
    const cx    = rect.left + rect.width / 2;
    const cy    = rect.top  + rect.height / 2;
    const rx    = ((e.clientY - cy) / (rect.height / 2)) * -8;  // -8 to +8
    const ry    = ((e.clientX - cx) / (rect.width  / 2)) *  10; // -10 to +10
    const mx    = ((e.clientX - rect.left) / rect.width)  * 100;
    const my    = ((e.clientY - rect.top)  / rect.height) * 100;

    card.style.setProperty('--rx', rx);
    card.style.setProperty('--ry', ry);
    card.style.setProperty('--mx', mx);
    card.style.setProperty('--my', my);
    card.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(16px)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) translateZ(0)';
  });
});
```

### Smooth Scroll with Lerp
```javascript
let currentY = 0, targetY = 0;

window.addEventListener('wheel', e => {
  targetY = Math.max(0, Math.min(targetY + e.deltaY, document.body.scrollHeight - window.innerHeight));
});

function lerp(a, b, t) { return a + (b - a) * t; }

(function tick() {
  currentY = lerp(currentY, targetY, 0.09);
  window.scrollTo(0, currentY);
  requestAnimationFrame(tick);
})();
```

### Section Entrance
```javascript
// Every section element with class "reveal" animates in on scroll
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
```
```css
.reveal {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}
.reveal.visible { opacity: 1; transform: translateY(0); }

/* Stagger children automatically */
.reveal-group .reveal:nth-child(1) { transition-delay: 0.05s; }
.reveal-group .reveal:nth-child(2) { transition-delay: 0.10s; }
.reveal-group .reveal:nth-child(3) { transition-delay: 0.15s; }
/* etc. */
```

---

## ◈ GENERATED BOOK COVERS

When `book.formats['image/jpeg']` is missing, generate a canvas cover:

```javascript
function generateCover(title, author, id) {
  const canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 300;
  const ctx = canvas.getContext('2d');

  // Deterministic color from book ID
  const hues = [210, 340, 160, 25, 280, 50, 190, 310];
  const hue  = hues[id % hues.length];

  // Rich dark gradient background
  const grad = ctx.createLinearGradient(0, 0, 200, 300);
  grad.addColorStop(0, `hsl(${hue}, 35%, 18%)`);
  grad.addColorStop(1, `hsl(${hue}, 20%, 8%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 200, 300);

  // Thin top/bottom decorative lines
  ctx.strokeStyle = `hsl(${hue}, 60%, 55%)`;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(20, 24); ctx.lineTo(180, 24); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(20, 276); ctx.lineTo(180, 276); ctx.stroke();

  // Title (word-wrapped)
  ctx.fillStyle = '#EDE8DF';
  ctx.font = 'bold 15px Georgia';
  ctx.textAlign = 'center';
  const words = title.split(' ');
  let line = '', y = 100;
  words.forEach(word => {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > 160 && line) {
      ctx.fillText(line.trim(), 100, y); line = word + ' '; y += 22;
    } else { line = test; }
  });
  ctx.fillText(line.trim(), 100, y);

  // Author
  ctx.font = '11px monospace';
  ctx.fillStyle = `hsl(${hue}, 50%, 65%)`;
  ctx.fillText(author.split(',')[0].toUpperCase(), 100, 250);

  return canvas.toDataURL();
}
```

---

## ◈ STATE MANAGEMENT

```javascript
// Single global state object — no framework needed
const state = {
  books:        [],
  currentPage:  1,
  totalCount:   0,
  searchQuery:  '',
  activeGenre:  'all',
  selectedBook: null,
  loading:      false,
  readerOpen:   false,
};

// Render functions — called whenever state changes
function render() {
  renderCatalog();
  renderNav();
  if (state.selectedBook) renderDetail();
  if (state.readerOpen)   renderReader();
}
```

---

## ◈ LOCAL STORAGE — PERSONAL LIBRARY

```javascript
const Storage = {
  getHistory:    () => JSON.parse(localStorage.getItem('archivum_history') || '[]'),
  addToHistory:  (book) => { /* prepend to history array, max 50 */ },
  getProgress:   (id) => localStorage.getItem(`archivum_progress_${id}`),
  saveProgress:  (id, scrollY) => localStorage.setItem(`archivum_progress_${id}`, scrollY),
  getBookmarks:  () => JSON.parse(localStorage.getItem('archivum_bookmarks') || '[]'),
  toggleBookmark:(book) => { /* toggle book in bookmarks array */ },
  isBookmarked:  (id) => Storage.getBookmarks().some(b => b.id === id),
};
```

Show a subtle **"Recently Read"** shelf above the main catalog when history exists:
- Horizontal scroll, smaller cards, ember "CONTINUE →" badge if progress saved

---

## ◈ PERFORMANCE RULES

```
✓ Load first 32 books immediately — no skeleton screens, real content fast
✓ Cover images: loading="lazy" on every img tag
✓ Infinite scroll: IntersectionObserver on sentinel element at list bottom
✓ Search: debounce 400ms, cancel previous fetch with AbortController
✓ Animations: always use transform + opacity only — never animate layout properties
✓ will-change: transform — only on actively animating elements, remove after
✓ RequestAnimationFrame: cursor and lerp scroll only — nothing else uses rAF loops
✓ Prefers-reduced-motion: @media check disables all transitions if user prefers
✓ No jQuery, no lodash, no dependencies — vanilla JS only
✓ Total JS: target under 400 lines. Total CSS: target under 500 lines.
```

---

## ◈ RESPONSIVE BREAKPOINTS

```css
/* Mobile first */
.catalog-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }

/* Tablet */
@media (min-width: 640px) {
  .catalog-grid { grid-template-columns: repeat(3, 1fr); }
}

/* Desktop */
@media (min-width: 1024px) {
  .catalog-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
}

/* Mobile reader: full width, smaller font, hidden top bar extras */
@media (max-width: 640px) {
  #reader-bar .extras { display: none; }
  .reader-frame { padding: 20px 0; }
}
```

---

## ◈ DEPLOYMENT

```
1. Save as: index.html
2. Go to: vercel.com
3. Drag index.html onto the deploy area
   OR: vercel.com/new → "Deploy without Git" → upload file
4. Get URL like: archivum-abc123.vercel.app
5. Open URL. Start reading.

Optional custom domain: add in Vercel dashboard → free with any domain registrar
```

---

## ◈ THE EXPERIENCE IN 30 SECONDS

```
User opens site
  → 2.5s beautiful loader
  → Hero with 70,000 in oversized Playfair italic
  → Scrolls into catalog grid
  → Sees Dracula. Clicks it.
  → Detail panel slides up. Reads synopsis. Sees 1897.
  → Clicks "OPEN & READ THIS BOOK →"
  → Full screen. Dark background. Perfect serif typography.
  → Reading Dracula in the most beautiful interface they've ever seen.
  → Progress auto-saved.
  → Closes tab. Opens tomorrow. Continues exactly where they left off.

Total cost to user: $0
Total cost to you: $0
Total servers maintained: 0
Total dependencies: 0
```

---

## ◈ DELIVER

**One file: `index.html`**
All CSS in `<style>`. All JS in `<script>`. Google Fonts via CDN link.
Works offline after first load (fonts cached). Works on any device.
No console errors. No CORS issues (Gutendex is open, Gutenberg HTML is iframeable).

*Open it. Read everything ever written. Free. Beautiful. Forever.*