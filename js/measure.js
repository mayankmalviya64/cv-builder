/* =====================================================================
   measure.js — the "brim engine"
   ---------------------------------------------------------------------
   Works out how much of one printed CV line a bullet fills.

   How it works (same idea as the CV Line-Density & Brim Checker):
   1. Draw nothing, but ask an invisible <canvas> how wide each word
      would be in EB Garamond at 9.75pt (13px).
   2. Add the word widths up and wrap them onto lines, the way the
      browser will when it prints the CV.
   3. Compare against the "capacity" (usable width) of the bullet column.

   A bullet is at the "brim" when it fills 98%–100% of one line.
   ===================================================================== */

// ---- Font + page geometry (all in points, 1pt = 1/72 inch) ----------
const CV_FONT_FAMILY = 'EB Garamond';
const CV_FONT_SIZE_PT = 9.75;
const PX_PER_PT = 4 / 3; // browsers draw 96px per inch, 72pt per inch

const LAYOUT = {
  pageWidthPt: 595.28,   // A4 width
  pageHeightPt: 841.89,  // A4 height
  tableWidthPt: 540,     // printable width of every section box
  categoryWidthPt: 83,   // left "Roles & Responsibilities" column
  yearWidthPt: 30,       // right year column (POR / Awards)
  bulletGutterPt: 7.75,  // space taken by the ▪ marker + its padding
};

// The "brim" band: a bullet should fill at least 98% of its line
// but never go past 100% (that would wrap onto a second line).
const BRIM_MIN = 98;
const BRIM_MAX = 100;

// Average width of one lowercase letter, used to turn px into "~N chars".
const AVG_CHAR_PX = 5.4;

/**
 * Usable width of a bullet's text, in points.
 * 540 − 83 (category) − 7.75 (marker)          = 449.25pt  (Internship / Projects)
 * 540 − 83 (category) − 30 (year) − 7.75       = 419.25pt  (POR / Awards)
 */
function bulletCapacityPt(hasCategory, hasYear) {
  return LAYOUT.tableWidthPt
    - (hasCategory ? LAYOUT.categoryWidthPt : 0)
    - (hasYear ? LAYOUT.yearWidthPt : 0)
    - LAYOUT.bulletGutterPt;
}

// ---- Font loading ----------------------------------------------------
// Measurements are only correct once EB Garamond has downloaded.
// Until then (or if it never loads, e.g. offline) we fall back to Georgia
// and tell the user the numbers are approximate.
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
let measureCtx = null;            // the invisible canvas, created once
const widthCache = new Map();     // remembers widths we already measured

/** Width in px of `text` in the CV font (regular or bold). */
function measureWidthPx(text, isBold) {
  if (!text) return 0;
  const key = (isBold ? 'b|' : 'r|') + text;
  if (widthCache.has(key)) return widthCache.get(key);

  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const sizePx = CV_FONT_SIZE_PT * PX_PER_PT; // 9.75pt → 13px
  measureCtx.font = `${isBold ? 700 : 400} ${sizePx}px "${CV_FONT_FAMILY}", Georgia, serif`;
  const width = measureCtx.measureText(text).width;

  widthCache.set(key, width);
  return width;
}

// ---- Text helpers -----------------------------------------------------

/** Collapse runs of spaces/newlines into one space (the browser does the same when printing). */
function normalizeSpaces(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Split "Grew **50K+ users** fast" into pieces:
 *   [{text:'Grew ', bold:false}, {text:'50K+ users', bold:true}, {text:' fast', bold:false}]
 * Anything wrapped in **double stars** is bold.
 */
function parseBold(text) {
  const pieces = [];
  String(text || '').split(/(\*\*[^*]+?\*\*)/g).forEach(part => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      pieces.push({ text: part.slice(2, -2), bold: true });
    } else {
      pieces.push({ text: part, bold: false });
    }
  });
  return pieces;
}

/** Plain text without the ** markers (handy for character counts). */
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
        tokens.push({ text: chunk, isSpace: true, w: measureWidthPx(chunk, piece.bold) });
      } else {
        chunk.split(/(?<=[-\/])/).forEach(part => {
          if (part) tokens.push({ text: part, isSpace: false, w: measureWidthPx(part, piece.bold) });
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
    const spill = lines.length > 1
      ? lines[lines.length - 1].filter(t => !t.isSpace).map(t => t.text).join(' ')
      : '';
    const spillWords = spill ? spill.split(' ').length : 0;
    result.message = `Spills onto ${lines.length} lines — trim ~${Math.ceil(result.deltaPx)}px (~${Math.ceil(result.deltaPx / AVG_CHAR_PX)} chars)`
      + (spillWords && spillWords <= 3 ? `. Orphan: “${spill}”` : '.');
  } else if (fill >= BRIM_MIN) {
    result.status = 'brim';
    result.deltaPx = 0;
    result.message = `At the brim — ${Math.max(0, capacityPx - widthPx).toFixed(0)}px spare.`;
  } else {
    result.status = 'under';
    result.deltaPx = capacityPx * (BRIM_MIN / 100) - widthPx;
    result.message = `Underfilled — add ~${Math.ceil(result.deltaPx)}px (~${Math.ceil(result.deltaPx / AVG_CHAR_PX)} chars) to reach the brim.`;
  }
  if (fontStatus === 'fallback') result.message += ' (approx. — EB Garamond not loaded)';
  return result;
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
