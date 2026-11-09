// The plain-text formatting engine, extracted from NativeReader so local
// file imports can share it without a component module exporting functions
// (react-refresh requires that split).

// OCR'd plain text (Internet Archive dumps) is full of noise: bare page
// numbers, symbol garble (".'X\"", "S ^T^ ^"), and running headers/footers
// ("34 CHAPTER IV", "INTRODUCTION 13") that would otherwise be rendered as
// book content. Filter conservative patterns only — real prose must survive.
export const isOcrJunkLine = (line) => {
  if (!line) return false;
  // Bare page number (arabic or roman), optionally decorated
  if (/^[\s\u2014\u2013_=*·.-]*([0-9]{1,4}|[ivxlcdm]{1,7})[\s\u2014\u2013_=*·.-]*$/i.test(line)) return true;
  // Line dominated by punctuation/symbols (OCR artifacts)
  const chars = line.replace(/\s/g, '');
  if (chars.length === 0) return false;
  const wordChars = chars.replace(/[^a-zA-Z0-9\u0900-\u097F\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/g, '');
  if (wordChars.length / chars.length < 0.5) return true;
  // Running header with LEADING page number ("34 CHAPTER IV", "XII PREFACE.")
  if (/^(?:[0-9]{1,4}|[ivxlcdm]{1,7})\s+[A-Z][A-Za-z\s:,'.\-]{2,60}$/.test(line)) return true;
  // Trailing page number ("INTRODUCTION 13", "PREFACE. xi") — but a leading
  // structural keyword ("CHAPTER IV") is a real heading, not a header.
  if (/^(CHAPTER|BOOK|PART|VOLUME|CANTO|ACT|SCENE)\b/i.test(line)) return false;
  if (/^[A-Za-z][A-Za-z\s:,'.\-]{2,60}\s(?:[0-9]{1,4}|[ivxlcdm]{1,7})$/.test(line)) return true;
  return false;
};

// Real chapter divisions — drive the TOC, drop caps and front-matter cutoff.
const CHAPTER_PATTERNS = [
  /^(CHAPTER|BOOK|PART|VOLUME|CANTO|STANZA|ACT|SCENE)\b/i,
  /^(\u0905\u0927\u094d\u092f\u093e\u092f|\u092a\u0930\u093f\u091a\u094d\u091b\u0947\u0926|\u092d\u093e\u0917)(\s|:|\.|$)/, // अध्याय / परिच्छेद / भाग
  /^[IVXLCDM]{1,8}$/, // a bare roman-numeral line is a chapter number
];
export const isChapterLine = (line) => CHAPTER_PATTERNS.some((re) => re.test(line));

// "[Illustration: …]" markers (OCR dumps / Gutenberg text) mean a scanned
// image we cannot show — render them as a muted caption instead of leaking
// raw markup into the text flow.
const escapeHtmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Convert raw plain text (IA OCR dumps, Gutenberg .txt) into book HTML.
// - Front matter (title page: short centered lines before the first chapter)
//   is wrapped in <section class="reader-front-matter"> instead of being
//   scattered across the book as fake headings.
// - Illustration markers become muted captions in front matter, are dropped
//   in the body.
// - Junk OCR lines are filtered; _emphasis_/*strong* markers are applied.
// Exported for the smart-formatting pass (src/lib/smartFormat.js): which
// line indices are ambiguous enough to need the model — short all-caps
// lines (speaker vs heading) and verse-candidate blocks.
export const detectFormatCandidates = (rawText) => {
  const lines = rawText.split('\n');
  const firstChapterIdx = lines.findIndex((l) => isChapterLine(l.trim()));
  const verseCandidates = new Set();
  if (firstChapterIdx >= 0) {
    const INLINE_SPEAKER_RE = /^([A-Z][A-Z\s.'\u2019&-]{0,30}[A-Z.]?)\s*:\s+\S/;
    const considerBlock = (start, end) => {
      const idxs = [];
      for (let k = start; k < end; k++) if (lines[k].trim()) idxs.push(k);
      if (idxs.length < 3) return;
      const texts = idxs.map((k) => lines[k].trim());
      if (texts.filter((l) => INLINE_SPEAKER_RE.test(l)).length / texts.length >= 0.4) return;
      const lens = texts.map((l) => l.length);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const std = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
      const max = Math.max(...lens);
      if (mean < 55 && (std > 5 || max < 60) && max < 75) idxs.forEach((k) => verseCandidates.add(k));
    };
    let runStart = -1;
    for (let i = firstChapterIdx; i < lines.length; i++) {
      if (lines[i].trim()) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        considerBlock(runStart, i);
        runStart = -1;
      }
    }
    if (runStart >= 0) considerBlock(runStart, lines.length);
  }
  const ambiguous = [];
  lines.forEach((l, idx) => {
    const t = l.trim();
    if (!t) return;
    if (t.length < 80 && /[A-Z]/.test(t) && !/[\u0900-\u097F]/.test(t) && t === t.toUpperCase()) ambiguous.push(idx);
    else if (verseCandidates.has(idx)) ambiguous.push(idx);
  });
  return { lines, verseCandidates, ambiguous };
};

// Exported for local-file imports (.txt rendering in src/lib/localBook.js)
export const textToBookHtml = (rawText, aiHints = null) => {
  const lines = rawText.split('\n');
  let html = '';
  let inFrontMatter = true;
  // Lines accumulate as an array and join once at flush — string
    // concatenation over a growing multi-MB paragraph is quadratic.
  let paragraphParts = [];
  let paragraphLen = 0;
  let illustrationOpen = false;
  let fmLineCount = 0;
  let consecutiveProseLines = 0;
  // Front matter lines are buffered so a prose run detected mid-block can
  // pull its first lines back out of the centered block.
  let fmBuffer = [];
  // Scanned IA dumps bury the real title page under pages of OCR noise
  // (cover-art text, library stamps, sticker labels). A real title page is
  // short; beyond this cap, stop rendering front matter and drop garbage.
  const FM_LINE_CAP = 60;
  // Title-page lines are short, all-caps or decorative; wrapped body prose is
  // mixed-case with several lowercase words. A run of prose-like lines means
  // the front matter is over.
  const isProseLikeLine = (line) => {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 4) return false;
    const lower = words.filter(w => /^[a-z\u0900-\u097F]/.test(w));
    return lower.length >= 3;
  };

  const pushParagraphLine = (line) => {
    if (!line) return;
    const last = paragraphParts[paragraphParts.length - 1];
    // OCR wraps words with a line-end hyphen ("distinc-" / "tion") — rejoin
    // lowercase continuations without the hyphen; keep real compounds.
    if (last && /[A-Za-z\u0900-\u097F]-$/.test(last) && /^[a-z\u0900-\u097F]/.test(line)) {
      paragraphParts[paragraphParts.length - 1] = last.slice(0, -1) + line;
      paragraphLen += line.length;
      return;
    }
    paragraphParts.push(line);
    paragraphLen += line.length + 1;
  };

  const fmtInline = (t) => t
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    // Unpaired underscores are OCR emphasis artifacts, not content
    .replace(/_/g, '');

  const flushParagraph = (cls = '') => {
    if (!paragraphLen) return;
    const t = fmtInline(paragraphParts.join(' ').trim());
    paragraphParts = [];
    paragraphLen = 0;
    // A paragraph seeded with a speaker span is a dialogue turn
    const isDialogue = t.startsWith('<span class="speaker"');
    html += `<p${isDialogue ? ' class="dialogue"' : cls ? ` class="${cls}"` : ''}>${t}</p>`;
  };

  // Verse rendering: open block lazily, one span per line, closed on the
  // first non-verse line or blank line (stanza break).
  let verseOpen = false;
  const closeVerse = () => {
    if (verseOpen) {
      html += '</div>';
      verseOpen = false;
    }
  };
  const appendVerseLine = (line) => {
    if (!verseOpen) {
      flushParagraph();
      html += '<div class="verse">';
      verseOpen = true;
    }
    html += `<span class="verse-line">${fmtInline(escapeHtmlText(line))}</span>`;
  };

  // Close the buffered section; any accumulated paragraph stays front-matter.
  // The section is committed BEFORE the pending paragraph, matching the
  // original line order (buffered lines came first).
  const closeFrontMatterSection = () => {
    if (fmBuffer.length > 0) {
      html += '<section class="reader-front-matter">' + fmBuffer.join('') + '</section>';
      fmBuffer = [];
    }
    flushParagraph('fm-p');
    inFrontMatter = false;
  };

  // Exit because real prose started. Pulls the last `proseLinesBack` centered
  // lines (the start of the prose run) back into a justified body paragraph,
  // keeping their original order; the remaining buffered title lines commit
  // as the section BEFORE the prose paragraph.
  const exitFrontMatterToProse = (proseLinesBack) => {
    const take = Math.min(proseLinesBack, fmBuffer.length);
    const pulled = fmBuffer.splice(fmBuffer.length - take, take);
    if (fmBuffer.length > 0) {
      html += '<section class="reader-front-matter">' + fmBuffer.join('') + '</section>';
      fmBuffer = [];
    }
    pulled.forEach((last) => {
      const text = last.replace(/^<div class="fm-line">([\s\S]*)<\/div>$/, '$1')
        .replace(/<em>/g, '_').replace(/<\/em>/g, '_').replace(/_/g, '');
      pushParagraphLine(text);
      fmLineCount--;
    });
    flushParagraph('');
    inFrontMatter = false;
  };

  const looksLikeOcrGarbage = (line) => {
    if (isOcrJunkLine(line)) return true;
    const wordish = line.match(/[A-Za-z\u0900-\u097F]{2,}/g) || [];
    return wordish.length < 2 && line.length < 25;
  };

  // --- Dialogue/speaker detection (plays, transcripts, dialogue textbooks) ---
  // Speaker labels ("HAMLET", "ANDREW:") are short ALL-CAPS lines that the
  // generic all-caps-heading rule would turn into fake headings, shredding
  // the conversation into heading/paragraph/heading fragments. A trailing
  // colon is an explicit label signal; bare names are only trusted when the
  // same name recurs across the book — real speakers speak many times,
  // one-off headings don't.
  const HEADING_WORDS = /^(THE\s+END|FINIS|CONTENTS|INDEX|PREFACE|FOREWORD|PROLOGUE|EPILOGUE|INTRODUCTION|ACKNOWLEDGEMENTS|ACKNOWLEDGMENTS|APPENDIX|GLOSSARY|BIBLIOGRAPHY|AFTERWORD|ABOUT\s+THE\s+AUTHOR|EXERCISES?|SUMMARY|NOTES?|REFERENCES?|ANSWERS?|REVIEW|DISCUSSION|QUESTIONS?|ACTIVITY|VOCABULARY|KEY\s+\w+)\b/;
  const isSpeakerLabelLine = (line) =>
    line.length >= 2 && line.length <= 34 &&
    /^[A-Z][A-Z\s.'\u2019&-]*[A-Z.]:?$/.test(line) &&
    !isChapterLine(line) && !HEADING_WORDS.test(line);

  const speakerCounts = new Map();
  for (const l of lines) {
    const t = l.trim();
    if (isSpeakerLabelLine(t)) {
      // "ANDREW:" and "ANDREW" are the same voice — count both toward the
      // frequency gate so mixed OCR formats still reach the threshold.
      const name = t.replace(/:$/, '');
      speakerCounts.set(name, (speakerCounts.get(name) || 0) + 1);
    }
  }
  // Recall over precision on purpose: a false positive still renders as a
  // readable small-caps lead paragraph, while a miss recreates the
  // heading/paragraph/heading shredding the rule exists to fix. Two turns
  // per voice is a common minimum in short textbook dialogues.
  const SPEAKER_MIN_USES = 2;
  const speakerNames = new Set(
    [...speakerCounts.entries()].filter(([, n]) => n >= SPEAKER_MIN_USES).map(([name]) => name)
  );

  // --- Verse block detection (poetry, songs, inscribed stanzas) ---
  // Gutenberg plaintext keeps poem line breaks. A blank-line-delimited block
  // of mostly-short lines with few sentence-final line ends is a stanza, not
  // a wrapped paragraph — merging it into justified prose destroys the poem.
  // Body only: title pages are also short centered lines.
  const firstChapterIdx = lines.findIndex((l) => isChapterLine(l.trim()));
  const verseLines = new Set();
  if (firstChapterIdx >= 0) {
    const INLINE_SPEAKER_RE = /^([A-Z][A-Z\s.'\u2019&-]{0,30}[A-Z.]?)\s*:\s+\S/;
    const considerBlock = (start, end) => {
      const idxs = [];
      for (let k = start; k < end; k++) if (lines[k].trim()) idxs.push(k);
      if (idxs.length < 3) return;
      const texts = idxs.map((k) => lines[k].trim());
      // Dialogue-heavy blocks are speakers, not poetry
      if (texts.filter((l) => INLINE_SPEAKER_RE.test(l)).length / texts.length >= 0.4) return;
      // Wrapped prose hugs the column width (tight variance, mean ~75);
      // verse varies freely and stays well under it.
      const lens = texts.map((l) => l.length);
      const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
      const std = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
      const max = Math.max(...lens);
      if (mean < 55 && (std > 5 || max < 60) && max < 75) idxs.forEach((k) => verseLines.add(k));
    };
    let runStart = -1;
    for (let i = firstChapterIdx; i < lines.length; i++) {
      if (lines[i].trim()) {
        if (runStart < 0) runStart = i;
      } else if (runStart >= 0) {
        considerBlock(runStart, i);
        runStart = -1;
      }
    }
    if (runStart >= 0) considerBlock(runStart, lines.length);
  }
  // AI hints (smart formatting) can add or veto verse lines by index.
  const finalVerseLines = new Set(verseLines);
  if (aiHints?.verse) aiHints.verse.forEach((k) => finalVerseLines.add(k));
  if (aiHints?.notVerse) aiHints.notVerse.forEach((k) => finalVerseLines.delete(k));

  for (let i = 0; i < lines.length; i++) {
    let trimmed = lines[i].trim();

    // Consume multi-line [Illustration: ...] markers
    if (illustrationOpen) {
      const endIdx = trimmed.indexOf(']');
      if (endIdx === -1) continue;
      illustrationOpen = false;
      trimmed = trimmed.slice(endIdx + 1).trim();
      if (!trimmed) continue;
    }
    if (/^\[?\s*illustration\b/i.test(trimmed)) {
      if (trimmed.includes(']')) {
        const caption = trimmed.replace(/^\[?\s*illustration\b\s*:?\s*/i, '').replace(/\]\s*$/, '').trim();
        if (inFrontMatter && caption && fmLineCount <= FM_LINE_CAP) fmBuffer.push(`<div class="fm-caption">${escapeHtmlText(caption)}</div>`);
      } else {
        illustrationOpen = true;
      }
      continue;
    }

    if (isOcrJunkLine(trimmed)) continue;

    // Front matter ends at the first chapter division, or at the first
    // substantial prose paragraph (title pages are short lines; a preface
    // with real paragraphs must not be rendered centered).
    if (inFrontMatter && (isChapterLine(trimmed) || trimmed.length > 280 || paragraphLen > 280)) {
      const chapterStart = isChapterLine(trimmed);
      closeFrontMatterSection();
      if (chapterStart) {
        html += `<h2 class="chapter-heading">${escapeHtmlText(trimmed)}</h2>`;
        continue;
      }
      // otherwise fall through: this long line continues as body prose
    }

    if (inFrontMatter) {
      if (trimmed === '') { consecutiveProseLines = 0; continue; }
      if (trimmed.length < 80) {
        if (isProseLikeLine(trimmed)) {
          consecutiveProseLines++;
          if (consecutiveProseLines >= 3) {
            // Wrapped prose (a preface, an introduction) — pull the two
            // preceding centered lines back and continue as body text.
            exitFrontMatterToProse(2);
            // fall through: this line and the rest flow as body prose
          }
        } else {
          consecutiveProseLines = 0;
        }
        if (inFrontMatter) {
          if (fmLineCount >= FM_LINE_CAP) {
            if (looksLikeOcrGarbage(trimmed)) continue;
            closeFrontMatterSection();
          } else {
            fmBuffer.push(`<div class="fm-line">${escapeHtmlText(trimmed).replace(/_([^_]{1,60})_/g, '<em>$1</em>').replace(/_/g, '')}</div>`);
            fmLineCount++;
            continue;
          }
        }
      } else {
        pushParagraphLine(trimmed);
        continue;
      }
    }

    // --- Normal body ---
    if (trimmed === '') {
      closeVerse();
      flushParagraph();
      continue;
    }

    // Verse lines (poetry/songs) keep their line breaks — never merged into
    // justified paragraphs, never headings/speakers.
    if (finalVerseLines.has(i)) {
      appendVerseLine(trimmed);
      continue;
    }
    closeVerse();

    // Dialogue turns. Inline label ("ANDREW: What do you mean?") or a
    // standalone speaker line ("ANDREW" / "ANDREW:") followed by its speech.
    // Both render as a small-caps speaker lead inside the paragraph — never
    // a heading. Chapter keywords ("ACT I: THE COURT") stay headings.
    // The smart-format model can force or veto speaker treatment per line.
    if (!isChapterLine(trimmed) && !aiHints?.notSpeaker?.has(i)) {
      const speakerMatch = trimmed.match(/^([A-Z][A-Z\s.'\u2019&-]{0,30}[A-Z.]?)\s*:\s+(\S.*)$/) ||
        // Single Titlecase word + colon ("Andrew: …") — multi-word Titlecase
        // is too ambiguous ("The Following: …"), all-caps handles those.
        trimmed.match(/^([A-Z][a-z'\u2019-]{1,14})\s*:\s+(\S.*)$/);
      const standaloneSpeaker = aiHints?.speaker?.has(i) || speakerNames.has(trimmed) ||
        (/^[A-Z][A-Z\s.'\u2019&-]{0,30}:$/.test(trimmed) && !HEADING_WORDS.test(trimmed));
      if (speakerMatch || standaloneSpeaker) {
        flushParagraph();
        const speaker = speakerMatch ? speakerMatch[1] : trimmed.replace(/:$/, '');
        const speech = speakerMatch ? speakerMatch[2] : '';
        paragraphParts = [`<span class="speaker">${escapeHtmlText(speaker)}</span>${speech ? ` ${speech}` : ''}`];
    paragraphLen = speech.length + 24;
        continue;
      }
    }

    const isHeading = trimmed.length > 0 && trimmed.length < 80 && (
      (/[A-Z]/.test(trimmed) && !/[\u0900-\u097F]/.test(trimmed) && trimmed === trimmed.toUpperCase()) ||
      isChapterLine(trimmed) ||
      /^(\u0905\u0927\u094d\u092f\u093e\u092f|\u092a\u0930\u093f\u091a\u094d\u091b\u0947\u0926|\u092d\u0942\u092e\u093f\u0915\u093e|\u092a\u094d\u0930\u0938\u094d\u0924\u093e\u0935\u0928\u093e)(\s|:|$)/.test(trimmed)
    );
    if (isHeading) {
      flushParagraph();
      // Only real chapter divisions become h2 (TOC prominence + drop caps);
      // other short all-caps lines ("THE END", "EPILOGUE") become h3.
      const isRealChapter = isChapterLine(trimmed);
      const tag = isRealChapter ? 'h2' : 'h3';
      html += `<${tag} class="chapter-heading">${escapeHtmlText(trimmed)}</${tag}>`;
      continue;
    }

    pushParagraphLine(trimmed);
    // Sources without blank lines (machine dumps, some OCR) otherwise merge
    // into one multi-megabyte paragraph — bound it at sentence-ish breaks.
    if (paragraphLen > 3000) flushParagraph();
  }
  closeVerse();
  flushParagraph();
  if (inFrontMatter) closeFrontMatterSection(); // books without chapter divisions
  return html;
};

export default { textToBookHtml, detectFormatCandidates, isChapterLine, isOcrJunkLine };
