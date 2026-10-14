/* =====================================================================
   measure.js — the "brim engine"
   ---------------------------------------------------------------------
   Works out how much of one printed CV line a bullet fills.

   How it works — benchmarked against real Skynet (IIM Mumbai) PDFs:
   1. Skynet's PDF engine (iText) measures a line by adding up each
      character's width from the EB Garamond font file. No kerning,
      no ligatures. We do exactly the same, using the width table in
      js/metrics.js, so our numbers match the Skynet PDF to ±0.01pt.
   2. Wrap the words onto lines the same greedy way iText does.
   3. Compare against the "capacity" (usable width) of the bullet column,
      also measured from Skynet PDFs.

   A bullet is at the "brim" when it fills 98%–100% of one line.

   Marks inside a bullet: **bold**, _italic_ and ^superscript^ (the "th" in
   "10^th^"). Skynet prints superscript at 1/1.2 of the size (8.125pt),
   raised by 33% of the font size, so it is narrower than normal text.
   ===================================================================== */

// ---- Font + page geometry (all in points, 1pt = 1/72 inch) ----------
const CV_FONT_FAMILY = 'EB Garamond';
const CV_FONT_SIZE_PT = 9.75;
const PX_PER_PT = 4 / 3; // browsers draw 96px per inch, 72pt per inch

const LAYOUT = {
  pageWidthPt: 595.28,   // A4 width
  pageHeightPt: 841.89,  // A4 height
  // Everything below is measured from Skynet-generated CV PDFs.
  boxLeftPt: 21.75,      // left edge of every section box (outer border)
  boxInnerWidthPt: 550,  // width inside the 0.75pt side borders
  borderPt: 0.75,        // every table line is 0.75pt thick
  categoryWidthPt: 82.125, // grey "Roles & Responsibilities" column (border not included)
  bulletIndentPt: 12,    // from the category border to the first letter (■ sits in here)
  markerOffsetPt: 4.65,  // from the category border to the ■ marker
  rightPadPt: 3,         // gap between the text and the right border (no-year rows)
  yearWidthPt: 31.5,     // year column (border not included)
  // Gap between the text and the year column's border: none. Text may run right
  // up to the border (a Skynet line of 422.83pt printed on one line, and the year
  // border starts 422.875pt after the text start).
  yearGapPt: 0,
};

// Superscript ("10^th^") is printed at 1/1.2 of the normal size (CSS "smaller"):
// 9.75pt → 8.125pt in Skynet PDFs, raised by 33% of the font size.
const SUP_SCALE = 1 / 1.2;

// The "brim" band: a bullet should fill at least 98% of its line
// but never go past 100% (that would wrap onto a second line).
const BRIM_MIN = 98;
const BRIM_MAX = 100;

// Average width of one lowercase letter, used to turn px into "~N chars".
const AVG_CHAR_PX = 5.4;

/**
 * Usable width of a bullet's text, in points — Skynet's real line widths:
 * 550 − 82.125 − 0.75 − 12 − 3         = 452.125pt  (Internship / Projects)
 * 550 − 82.125 − 0.75 − 12 − 0.75 − 31.5 = 422.875pt  (POR / Awards, with year)
 * Proof from Skynet PDFs (all 14 on file): the widest one-line bullets are
 * 452.08pt and 422.83pt; the narrowest year-row bullet that wrapped needed 428.1pt.
 */
function bulletCapacityPt(hasCategory, hasYear) {
  let width = LAYOUT.boxInnerWidthPt - LAYOUT.bulletIndentPt;
  if (hasCategory) width -= LAYOUT.categoryWidthPt + LAYOUT.borderPt;
  if (hasYear) width -= LAYOUT.yearGapPt + LAYOUT.borderPt + LAYOUT.yearWidthPt;
  else width -= LAYOUT.rightPadPt;
  return Math.round(width * 1000) / 1000;
}

// ---- Font loading ----------------------------------------------------
// The meter does NOT need the font (it uses the width table in metrics.js),
// but the preview does: until EB Garamond downloads, the preview is drawn
// in Georgia and won't look like the Skynet PDF.
let fontStatus = 'loading'; // 'loading' | 'ready' | 'fallback'

async function loadCvFont() {
  // Sample text so the browser also fetches the extra-character files (₹, ’ …)
  const sample = 'AaZz09₹’–—%&';
  const regular = `400 13px "${CV_FONT_FAMILY}"`;
  const bold = `700 13px "${CV_FONT_FAMILY}"`;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
    await Promise.race([
      Promise.all([document.fonts.load(regular, sample), document.fonts.load(bold, sample)]),
      timeout,
    ]);
    const ok = document.fonts.check(regular) && document.fonts.check(bold);
    fontStatus = ok ? 'ready' : 'fallback';
  } catch (err) {
    fontStatus = 'fallback';
  }
  widthCache.clear(); // old widths may have been measured with the fallback font
  return fontStatus;
}

// ---- Measuring one piece of text --------------------------------------
let measureCtx = null;            // invisible canvas, only for rare characters
const widthCache = new Map();     // remembers widths we already measured

/**
 * Width of ONE character in 1/1000ths of the font size.
 * Normally read from the table in metrics.js. A character that isn't in the
 * table (an emoji, say) is measured with a canvas instead — close, not exact.
 */
function charUnits(ch, isBold, isItalic) {
  const table = isItalic
    ? (isBold ? CV_METRICS.boldItalic : CV_METRICS.italic)
    : (isBold ? CV_METRICS.bold : CV_METRICS.regular);
  const units = table[ch.codePointAt(0)];
  if (units !== undefined) return units;

  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${isItalic ? 'italic ' : ''}${isBold ? 700 : 400} 100px "${CV_FONT_FAMILY}", "DejaVu Sans", Georgia, serif`;
  if ('fontKerning' in measureCtx) measureCtx.fontKerning = 'none';
  return measureCtx.measureText(ch).width * 10; // 100px font → ×10 = units per 1000
}

/**
 * Width in px of `text` in the CV font (regular/bold, upright/italic), the way Skynet adds it up.
 * isSup = superscript: same letters, drawn at the smaller superscript size.
 */
function measureWidthPx(text, isBold, isItalic = false, isSup = false) {
  if (!text) return 0;
  const key = (isBold ? 'b' : 'r') + (isItalic ? 'i' : '') + (isSup ? 's|' : '|') + text;
  if (widthCache.has(key)) return widthCache.get(key);

  let units = 0;
  for (const ch of text) units += charUnits(ch, isBold, isItalic); // for…of walks real characters (₹, emoji…)
  const sizePt = isSup ? CV_FONT_SIZE_PT * SUP_SCALE : CV_FONT_SIZE_PT;
  const widthPt = (units / 1000) * sizePt;
  const width = widthPt * PX_PER_PT;

  widthCache.set(key, width);
  return width;
}

// ---- Text helpers -----------------------------------------------------

/** Collapse runs of spaces/newlines into one space (the browser does the same when printing). */
function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Split text with formatting marks into pieces:
 *   "Grew **50K+ users** _fast_" →
 *   [{text:'Grew ', bold:false, italic:false, sup:false}, {text:'50K+ users', bold:true, …},
 *    {text:' ', …}, {text:'fast', bold:false, italic:true, sup:false}]
 * Rules: **double stars** switch bold on/off, _underscores_ switch italic on/off,
 * ^carets^ switch superscript on/off ("10^th^"), and they can be combined: **_bold and italic_**.
 * A mark with no partner (e.g. a lone "_" in "snake_case") is just printed as-is.
 */
function parseBold(text) {
  const parts = String(text || '').split(/(\*\*|_|\^)/);
  // Count each kind of mark; if one is left without a partner, the last one is plain text.
  const total = { '**': 0, _: 0, '^': 0 };
  parts.forEach(p => { if (p in total) total[p]++; });
  const seen = { '**': 0, _: 0, '^': 0 };
  const pieces = [];
  let bold = false;
  let italic = false;
  let sup = false;
  for (const part of parts) {
    if (part in total) {
      seen[part]++;
      const unpaired = total[part] % 2 === 1 && seen[part] === total[part];
      if (!unpaired) {
        if (part === '**') bold = !bold;
        else if (part === '_') italic = !italic;
        else sup = !sup;
        continue;
      }
    }
    if (!part) continue;
    const last = pieces[pieces.length - 1];
    if (last && last.bold === bold && last.italic === italic && last.sup === sup) last.text += part;
    else pieces.push({ text: part, bold, italic, sup });
  }
  return pieces;
}

/**
 * The reverse: pieces [{text, bold, italic, sup}] → text with **, _ and ^ marks.
 * Used when importing a PDF and when pasting from Google Docs / Sheets.
 * Spaces keep their own boldness (a bold space is wider, so it matters for the
 * line check); italic doesn't change a space's width, so spaces only stay
 * italic when the words on both sides are italic (keeps the marks tidy).
 * Superscript spaces follow the same rule (Skynet prints the space after
 * "10^th^" at the normal size).
 */
function piecesToMarkup(pieces) {
  // 1. Per-character styles, so neighbouring pieces with the same style merge.
  const chars = [];
  for (const p of pieces) for (const ch of String(p.text).replace(/\s/g, ' ')) chars.push({ ch, bold: !!p.bold, italic: !!p.italic, sup: !!p.sup });
  // 2. Tidy the line: no spaces at the ends, no double spaces.
  while (chars.length && chars[0].ch === ' ') chars.shift();
  while (chars.length && chars[chars.length - 1].ch === ' ') chars.pop();
  const tidy = chars.filter((c, i) => !(c.ch === ' ' && chars[i - 1] && chars[i - 1].ch === ' '));
  tidy.forEach((c, i) => {
    if (c.ch !== ' ') return;
    const before = tidy[i - 1];
    const after = tidy[i + 1];
    c.italic = !!(before && after && before.italic && after.italic);
    c.sup = !!(before && after && before.sup && after.sup);
  });
  // 3. Write the marks wherever the style changes.
  let out = '';
  let bold = false;
  let italic = false;
  let sup = false;
  for (const c of tidy) {
    if (c.sup !== sup && sup) { out += '^'; sup = false; }             // close superscript first (tidier nesting)
    if (c.italic !== italic && italic) { out += '_'; italic = false; } // then italic
    if (c.bold !== bold) { out += '**'; bold = c.bold; }
    if (c.italic !== italic) { out += '_'; italic = c.italic; }
    if (c.sup !== sup) { out += '^'; sup = c.sup; }
    out += c.ch;
  }
  if (sup) out += '^';
  if (italic) out += '_';
  if (bold) out += '**';
  return out;
}

/** Plain text without the **, _ and ^ marks (handy for character counts). */
function stripBold(text) {
  return parseBold(text).map(p => p.text).join('');
}

// ---- The main analysis ------------------------------------------------

/**
 * Analyse one bullet against a line capacity.
 * Returns:
 *   status      'empty' | 'under' | 'brim' | 'over'
 *   fill        % of ONE line used (can be > 100 when it wraps)
 *   lines       how many printed lines the bullet takes
 *   widthPx     total width if it were on a single line
 *   capacityPx  usable width of one line
 *   deltaPx     px to ADD (under) or to TRIM (over) to reach the brim band
 *   message     a human-friendly sentence
 */
function analyzeBullet(rawText, capacityPt) {
  const text = normalizeSpaces(rawText);
  const capacityPx = capacityPt * PX_PER_PT;
  const result = { status: 'empty', fill: 0, lines: 0, widthPx: 0, capacityPx, deltaPx: 0, message: 'Empty bullet.' };
  if (!stripBold(text).trim()) return result;

  // 1) Break the text into "tokens": words and the spaces between them.
  //    Words may also break after a hyphen or slash ("clicked-|but-|not"),
  //    because browsers allow a line break there too.
  const tokens = [];
  parseBold(text).forEach(piece => {
    piece.text.split(/(\s+)/).forEach(chunk => {
      if (!chunk) return;
      if (/^\s+$/.test(chunk)) {
        tokens.push({ text: chunk, isSpace: true, w: measureWidthPx(chunk, piece.bold, piece.italic, piece.sup) });
      } else {
        chunk.split(/(?<=[-\/])/).forEach(part => {
          if (!part) return;
          const w = measureWidthPx(part, piece.bold, piece.italic, piece.sup);
          // A word whose style changes midway ("10^th^", "**5**x") is still ONE word:
          // a line can't break inside it, so glue it to the piece before.
          const prev = tokens[tokens.length - 1];
          if (prev && !prev.isSpace && !/[-\/]$/.test(prev.text)) { prev.text += part; prev.w += w; }
          else tokens.push({ text: part, isSpace: false, w });
        });
      }
    });
  });

  // 2) Total width on one line = sum of every token.
  const widthPx = tokens.reduce((sum, t) => sum + t.w, 0);

  // 3) Greedy wrap: keep adding tokens until the next one doesn't fit.
  const lines = [];
  let current = [];
  let currentW = 0;
  tokens.forEach(tok => {
    if (currentW + tok.w <= capacityPx || current.length === 0) {
      if (current.length === 0 && tok.isSpace) return; // lines never start with a space
      current.push(tok);
      currentW += tok.w;
    } else {
      lines.push(current);
      current = tok.isSpace ? [] : [tok];
      currentW = tok.isSpace ? 0 : tok.w;
    }
  });
  if (current.length) lines.push(current);

  const fill = (widthPx / capacityPx) * 100;
  result.widthPx = widthPx;
  result.fill = fill;
  result.lines = lines.length;

  // 4) Grade it.
  if (lines.length > 1 || fill > BRIM_MAX) {
    result.status = 'over';
    result.deltaPx = widthPx - capacityPx;
    // The word(s) pushed onto the extra line, e.g. “overhaul”
    const spill = lines.length > 1
      ? lines[lines.length - 1].filter(t => !t.isSpace).map(t => t.text).join(' ')
      : '';
    const spillWords = spill ? spill.split(' ').length : 0;
    const cut = lettersFor(result.deltaPx);
    result.message = spillWords && spillWords <= 3
      ? `Too long: “${spill}” falls onto a ${ordinal(lines.length)} line. Cut about ${cut} to pull it back up.`
      : `Too long: runs onto ${lines.length} lines. Cut about ${cut}.`;
  } else if (fill >= BRIM_MIN) {
    result.status = 'brim';
    result.deltaPx = 0;
    const room = Math.floor(Math.max(0, capacityPx - widthPx) / AVG_CHAR_PX);
    result.message = room > 0
      ? `Perfect fit: fills the line (room for ${room === 1 ? '1 more letter' : `${room} more letters`}).`
      : 'Perfect fit: fills the line exactly.';
  } else {
    result.status = 'under';
    result.deltaPx = capacityPx * (BRIM_MIN / 100) - widthPx;
    result.message = `A bit short: add about ${lettersFor(result.deltaPx)} to fill the line.`;
  }
  if (fontStatus === 'fallback') result.message += ' (The preview font didn’t load, but this check is still exact.)';
  return result;
}

/** "about 4 letters" from a width in px (one letter ≈ AVG_CHAR_PX wide). */
function lettersFor(px) {
  const n = Math.max(1, Math.ceil(px / AVG_CHAR_PX));
  return n === 1 ? '1 letter' : `${n} letters`;
}

/** 2 → "2nd", 3 → "3rd" … */
function ordinal(n) {
  return n + (n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
}

// ---- Micro-tweaks -----------------------------------------------------
// Small wording swaps that shrink or grow a bullet by a few px.
// 'trim' tweaks are offered when a bullet overflows,
// 'grow' tweaks when it is underfilled.
const TWEAKS = [
  { mode: 'trim', find: / and /g, replace: ' & ', label: '“and” → “&”' },
  { mode: 'trim', find: / percent\b/gi, replace: '%', label: '“percent” → “%”' },
  { mode: 'trim', find: / in order to /gi, replace: ' to ', label: '“in order to” → “to”' },
  { mode: 'trim', find: / (utilizing|leveraging) /gi, replace: ' using ', label: '“utilizing/leveraging” → “using”' },
  { mode: 'trim', find: / versus /gi, replace: ' vs. ', label: '“versus” → “vs.”' },
  { mode: 'trim', find: /\bmanagement\b/gi, replace: 'mgmt', label: '“management” → “mgmt”' },
  { mode: 'trim', find: /\bdevelopment\b/gi, replace: 'dev', label: '“development” → “dev”' },
  { mode: 'trim', find: /\bapproximately /gi, replace: '~', label: '“approximately” → “~”' },
  { mode: 'trim', find: / Crore\b/g, replace: ' Cr', label: '“Crore” → “Cr”' },
  { mode: 'grow', find: / & /g, replace: ' and ', label: '“&” → “and”' },
  { mode: 'grow', find: /\bTAT\b/g, replace: 'Turnaround Time (TAT)', label: 'Expand “TAT”' },
  { mode: 'grow', find: /\bSKUs\b/g, replace: 'Stock Keeping Units (SKUs)', label: 'Expand “SKUs”' },
  { mode: 'grow', find: / Cr\b/g, replace: ' Crore', label: '“Cr” → “Crore”' },
  { mode: 'grow', find: / vs\.? /g, replace: ' versus ', label: '“vs.” → “versus”' },
];

/** List the tweaks that would change this bullet, with the fill % each one gives. */
function suggestTweaks(text, capacityPt, status) {
  const mode = status === 'over' ? 'trim' : status === 'under' ? 'grow' : null;
  if (!mode) return [];
  return TWEAKS
    .map((tw, index) => ({ tw, index }))
    .filter(({ tw }) => tw.mode === mode)
    .map(({ tw, index }) => {
      const newText = text.replace(tw.find, tw.replace);
      if (newText === text) return null; // tweak doesn't apply here
      const after = analyzeBullet(newText, capacityPt);
      return { index, label: tw.label, newText, after };
    })
    .filter(Boolean);
}
