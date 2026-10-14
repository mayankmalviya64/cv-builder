/* =====================================================================
   import-pdf.js — turn an uploaded CV PDF back into editable CV data
   ---------------------------------------------------------------------
   Works best with Skynet PDFs (the IIM Mumbai CV portal), and makes a
   best effort with any other CV PDF.

   Steps:
   1. pdf.js (loaded only when needed) reads every piece of text on the
      page with its position, size and font.
   2. Pieces on the same height are joined into lines, and lines are split
      into "segments" wherever there's a big horizontal gap (columns).
   3. Bold is detected by comparing each piece's printed width with the
      EB Garamond regular/bold widths in metrics.js. That also tells us
      whether a space between words was bold (2.31pt) or regular (1.95pt),
      so the brim meter measures the bullet exactly like the PDF.
   4. Using Skynet's layout (■ markers at x≈110, category column on the left,
      year column on the right, grey section titles …) every segment is
      given a role: name, headline, section title, entry line, category,
      bullet, year, footer.
   5. Sections are built from whatever the PDF contains, so extra or
      unusual sections (not in our template) still come through.
   ===================================================================== */

const PDFJS_VERSION = '3.11.174';
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

/** Load pdf.js from the CDN the first time someone imports a PDF. */
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${PDFJS_BASE}/pdf.min.js`;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Couldn’t load the PDF reader. Check your internet connection and try again.'));
    document.head.appendChild(script);
  });
}

// ---------- 1. read the text pieces ----------

/**
 * Read every text piece from every page.
 * Returns [{ str, x, y, w, size, font, page }] in points, y measured from the top.
 * Pages are stacked: page 2 starts at y = 1000 so its lines come after page 1's.
 */
async function readPdfItems(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const items = [];
  const links = [];   // clickable links (the LinkedIn footer is one)
  const cells = [];   // Skynet's light-grey category boxes: one per category
  const fontNames = {};
  for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    // The drawing instructions: also makes the fonts' real names available.
    const ops = await page.getOperatorList();
    cells.push(...findCategoryCells(pdfjs, ops, viewport, p));
    const content = await page.getTextContent();
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Link' || !a.url) continue;
      const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(a.rect);
      links.push({ url: a.url, y: Math.max(y0, y1) + (p - 1) * 1000, x: Math.min(x0, x1) });
    }
    for (const it of content.items) {
      if (!it.str) continue;
      const t = pdfjs.Util.transform(viewport.transform, it.transform);
      const size = Math.hypot(t[2], t[3]);
      const font = `${p}:${it.fontName}`;
      if (!(font in fontNames)) {
        try {
          const f = page.commonObjs.get(it.fontName);
          fontNames[font] = { name: f.name || '', bold: !!(f.bold || f.black), italic: !!f.italic };
        } catch (err) {
          fontNames[font] = { name: '', bold: false, italic: false };
        }
      }
      items.push({ str: it.str, x: t[4], y: t[5] + (p - 1) * 1000, w: it.width, size, font, page: p });
    }
  }
  return { items, fontNames, links, cells };
}

/**
 * Find Skynet's light-grey (#ddd) boxes in the left category column.
 * Each one spans exactly one category, so it tells us which bullets belong
 * together, even when two categories' labels sit very close to each other.
 */
function findCategoryCells(pdfjs, ops, viewport, pageNo) {
  const OPS = pdfjs.OPS;
  const found = [];
  let fill = null;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = null; // last path's bounding box, waiting for a "fill"
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push({ fill, ctm });
    else if (fn === OPS.restore) ({ fill, ctm } = stack.pop() || { fill, ctm });
    else if (fn === OPS.transform) ctm = pdfjs.Util.transform(ctm, args);
    else if (fn === OPS.setFillRGBColor) fill = [args[0], args[1], args[2]];
    else if (fn === OPS.setFillGray) fill = [args[0] * 255, args[0] * 255, args[0] * 255];
    else if (fn === OPS.constructPath) pending = args[2];
    else if ((fn === OPS.fill || fn === OPS.eoFill) && pending && fill) {
      const grey = Math.abs(fill[0] - fill[1]) < 3 && Math.abs(fill[1] - fill[2]) < 3 && fill[0] > 205 && fill[0] < 235;
      if (grey) {
        const [x0, x1, y0, y1] = pending;
        const a = viewport.convertToViewportPoint(...pdfjs.Util.applyTransform([x0, y0], ctm));
        const b = viewport.convertToViewportPoint(...pdfjs.Util.applyTransform([x1, y1], ctm));
        const left = Math.min(a[0], b[0]);
        const width = Math.abs(a[0] - b[0]);
        if (left < 30 && width > 60 && width < 100) {
          found.push({ top: Math.min(a[1], b[1]) + (pageNo - 1) * 1000, bottom: Math.max(a[1], b[1]) + (pageNo - 1) * 1000 });
        }
      }
      pending = null;
    }
  }
  return found;
}

// ---------- 2. bold detection ----------

/** Width of `text` in EB Garamond (pt) using the same table the meter uses. */
function ebWidth(text, size, bold, italic = false) {
  const table = italic ? (bold ? CV_METRICS.boldItalic : CV_METRICS.italic) : (bold ? CV_METRICS.bold : CV_METRICS.regular);
  let units = 0;
  for (const ch of text) units += table[ch.codePointAt(0)] ?? 500;
  return (units / 1000) * size;
}

/**
 * Decide, for each font in the PDF, whether it is bold and/or italic.
 * EB Garamond PDFs (Skynet): compare printed widths with the four EB Garamond
 * styles and pick the one that fits. Other fonts: use the font's name
 * ("…-BoldItalic") or its flags.
 */
const STYLES = [[false, false], [true, false], [false, true], [true, true]]; // [bold, italic]
function detectBoldFonts(items, fontNames) {
  const stats = {};
  for (const it of items) {
    if (!it.str.trim()) continue;
    const s = (stats[it.font] ||= { err: [0, 0, 0, 0], total: 0 });
    STYLES.forEach(([b, i], k) => { s.err[k] += Math.abs(ebWidth(it.str, it.size, b, i) - it.w); });
    s.total += it.w;
  }
  const isBold = {};
  const isItalic = {};
  const isEb = {}; // fonts confirmed to be EB Garamond (so space widths can be trusted)
  for (const font of new Set(items.map(i => i.font))) {
    const s = stats[font];
    const info = fontNames[font] || { name: '', bold: false, italic: false };
    const best = s ? s.err.indexOf(Math.min(...s.err)) : 0;
    // Trust the width test only if one style fits really well (< 1.5% off).
    isEb[font] = !!(s && s.total > 0 && s.err[best] / s.total < 0.015);
    if (isEb[font]) [isBold[font], isItalic[font]] = STYLES[best];
    else {
      isBold[font] = /bold|black|heavy|semibold|demi/i.test(info.name) || info.bold;
      isItalic[font] = /italic|oblique/i.test(info.name) || info.italic;
    }
  }
  return { isBold, isItalic, isEb };
}

// ---------- 3. lines and segments ----------

const MARKER_RE = /^[■▪•●◦‣∙·▸►\-–*]$/;

/**
 * Join pieces into lines (same baseline) and split lines into segments
 * (a gap wider than ~0.6 of the font size starts a new segment).
 * Each segment keeps "runs" of {text, bold} so bold words survive.
 */
function buildLines(items, isBold, isEb, isItalic = {}) {
  // Keep real space characters (their font tells us if the space is bold). Drop the
  // others: pdf.js invents spaces between pieces, and some PDFs have wide "spaces"
  // that bridge whole columns. The gap between pieces then decides (see below).
  // Real EB Garamond spaces are exactly 0.200 (regular) or 0.237 (bold) of the font size.
  const isRealSpace = it => isEb[it.font] && [0.2, 0.237].some(k => Math.abs(it.w - it.size * k) < 0.12);
  const pieces = items
    .filter(it => it.str.trim() !== '' || isRealSpace(it))
    .map(it => ({ ...it, bold: isBold[it.font], italic: !!isItalic[it.font], eb: isEb[it.font] }))
    .map(it => {
      // A space at the end of a piece is only real if the piece is wide enough to
      // contain it (EB Garamond fonts only). Otherwise the PDF reader added it, so
      // drop it and let the gap to the next piece decide.
      if (!/\s$/.test(it.str) || !it.str.trim()) return it;
      const core = it.str.replace(/\s+$/, '');
      const extra = it.eb ? it.w - ebWidth(core, it.size, it.bold, it.italic) : 0;
      return extra > it.size * 0.15 ? it : { ...it, str: core };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Small square markers (■ at 5.25pt) are kept apart: they mark bullet starts.
  const markers = [];
  const rows = [];
  for (const p of pieces) {
    if (p.str.trim() && MARKER_RE.test(p.str.trim()) && p.size < 8) { markers.push(p); continue; }
    const row = rows.find(r => Math.abs(r.y - p.y) < 1.2);
    if (row) row.pieces.push(p); else rows.push({ y: p.y, pieces: [p] });
  }

  const lines = rows.sort((a, b) => a.y - b.y).map(row => {
    row.pieces.sort((a, b) => a.x - b.x);
    const segs = [];
    let seg = null;
    let prev = null;
    for (const p of row.pieces) {
      const gap = prev ? p.x - (prev.x + prev.w) : 0;
      if (!p.str.trim()) {
        // A real space character: keep it (bold or not) inside the current segment.
        if (seg && gap < p.size) { seg.runs.push({ text: ' ', bold: p.bold }); seg.x1 = p.x + p.w; prev = p; }
        continue;
      }
      if (!seg || gap > Math.max(prev.size, p.size) * 0.6) {
        seg = { x0: p.x, x1: p.x + p.w, size: p.size, runs: [], y: row.y };
        segs.push(seg);
      } else if (gap > p.size * 0.1 && !/\s$/.test(prev.str) && !/^\s/.test(p.str)) {
        // A gap with no space character = a space. In EB Garamond PDFs (Skynet) its
        // width says if it was bold (2.31pt vs 1.95pt). In other fonts we can't tell,
        // so the space is bold only when the words on both sides are bold.
        // A ₹ drawn in EB Garamond sits in a padded box (our own PDFs), so the gap
        // beside it isn't a real space width. Skynet draws ₹ in DejaVu Sans: no padding.
        const narrowRupee = q => q.str.trim() === '₹' && (q.w / q.size) * 1000 < 600; // EB glyph (475/528), not DejaVu (636/695)
        const paddedRupee = narrowRupee(prev) || narrowRupee(p);
        const trustGap = !paddedRupee && (prev.eb || p.eb);
        const spaceBold = trustGap ? (gap / p.size) * 1000 > 218 : prev.bold && p.bold;
        seg.runs.push({ text: ' ', bold: spaceBold });
      }
      seg.runs.push({ text: p.str, bold: p.bold, italic: p.italic });
      seg.x1 = Math.max(seg.x1, p.x + p.w);
      seg.size = Math.max(seg.size, p.size);
      prev = p;
    }
    for (const s of segs) {
      s.text = s.runs.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
      const boldChars = s.runs.filter(r => r.bold).reduce((n, r) => n + r.text.trim().length, 0);
      s.bold = boldChars > s.text.replace(/\s/g, '').length / 2;
      s.mid = (s.x0 + s.x1) / 2;
    }
    return { y: row.y, segs: segs.filter(s => s.text) };
  }).filter(l => l.segs.length);

  return { lines, markers };
}

/** Runs → text with **bold** / _italic_ marks (see piecesToMarkup in measure.js). */
function runsToMarkup(runs) {
  return piecesToMarkup(runs);
}

/** Join two bullet pieces (a wrapped bullet's 2nd line) with one space. */
function joinMarkup(a, b) {
  if (!a) return b;
  return `${a} ${b}`.replace(/\s+/g, ' ');
}

// ---------- 4. build the CV ----------

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const isYearText = t => /^(\d{4}|\d{4}\s*[-–]\s*\d{2,4}|present|ongoing)$/i.test(t.trim());

/** Main entry: PDF items → { cv, report }. `base` supplies things a PDF can't (the logo). */
function cvFromPdfItems({ items, fontNames, links = [], cells = [] }, base) {
  if (!items.length) throw new Error('This PDF has no selectable text (it may be a scanned image), so it can’t be read.');
  const { isBold, isItalic, isEb } = detectBoldFonts(items, fontNames);
  const { lines, markers } = buildLines(items, isBold, isEb, isItalic);
  const skynet = markers.filter(m => m.x > 100 && m.x < 116).length >= 3;
  const cv = skynet ? parseSkynet(lines, markers, cells) : parseGeneric(lines);
  cv.personal.logo = base?.personal?.logo ?? '';
  // Footer text not readable? Use the link printed at the bottom of the page instead.
  if (!cv.footer && links.length) {
    const bottom = links.reduce((a, l) => (l.y > a.y ? l : a));
    cv.footer = bottom.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  return { cv: normalizeCv(cv), report: { layout: skynet ? 'skynet' : 'generic' } };
}

// ---------- 4a. Skynet layout ----------

function parseSkynet(lines, markers, cells) {
  const allSegs = lines.flatMap(l => l.segs.map(s => ({ ...s, line: l })));

  // Section titles: bold ~10.9pt text starting at the box's left edge (x ≈ 25.5).
  const isTitle = s => s.bold && s.size > 10.3 && s.size < 11.8 && s.x0 < 40 && !near(s.mid, 297.5, 8);
  const titleLines = lines.filter(l => l.segs.some(isTitle));
  const firstTitleY = titleLines.length ? titleLines[0].y : Infinity;

  // ---- header: name, two lines under it, black headline bar ----
  const head = lines.filter(l => l.y < firstTitleY);
  const headSegs = head.flatMap(l => l.segs).filter(s => s.x0 < 300 || near(s.mid, 297.5, 20));
  const nameSeg = headSegs.reduce((a, s) => (!a || s.size > a.size ? s : a), null);
  const headlineSeg = headSegs.find(s => s !== nameSeg && s.bold && near(s.mid, 297.5, 15) && s.x1 - s.x0 > 150);
  const subSegs = headSegs.filter(s => s !== nameSeg && s !== headlineSeg && s.x0 < 200 && (!headlineSeg || s.y < headlineSeg.y));
  const cv = {
    personal: { name: nameSeg?.text || '', line1: subSegs[0]?.text || '', line2: subSegs[1]?.text || '' },
    headline: headlineSeg?.text || '',
    footer: '',
    sections: [],
  };

  // ---- footer: small text below everything else ----
  const lastBodyY = Math.max(...allSegs.filter(s => s.size > 9).map(s => s.y));
  const footerSeg = allSegs.find(s => s.size < 8.7 && s.y >= lastBodyY - 1);
  if (footerSeg) cv.footer = footerSeg.text;

  // ---- sections ----
  titleLines.forEach((tl, i) => {
    const titleSeg = tl.segs.find(isTitle);
    // The right-hand note ("12 Weeks") can sit ~1.5pt lower than the title, so look at nearby lines too.
    const noteSeg = lines.filter(l => near(l.y, tl.y, 3)).flatMap(l => l.segs)
      .find(s => s !== titleSeg && s.x1 > 480 && s.size > 10);
    const endY = i + 1 < titleLines.length ? titleLines[i + 1].y : Infinity;
    const body = lines.filter(l => l.y > tl.y + 1 && l.y < endY - 1)
      .map(l => ({ ...l, segs: l.segs.filter(s => s !== footerSeg) }))
      .filter(l => l.segs.length);
    const secMarkers = markers.filter(m => m.y > tl.y && m.y < endY);
    const title = titleCase(titleSeg.text);

    // Academic table: small 9.4pt text and no bullet markers.
    const smallText = body.flatMap(l => l.segs).filter(s => s.size < 9.6).length;
    if (!secMarkers.length && smallText > 0) {
      cv.sections.push(academicSection(title, body));
      return;
    }
    const secCells = cells.filter(c => c.top > tl.y && c.top < endY);
    cv.sections.push(bulletSection(title, noteSeg?.text || '', body, secMarkers, secCells));
  });
  return cv;
}

/** "SUMMER INTERNSHIP" → "Summer Internship" (the CV prints titles in capitals anyway). */
function titleCase(text) {
  return text.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(And|Of|For|The|In|On|At|To)\b/g, w => w.toLowerCase())
    .replace(/^./, c => c.toUpperCase());
}

/** Degree / Institute / %/CGPA / Year table: first row = headings. */
function academicSection(title, body) {
  const [headLine, ...rowLines] = body;
  const columns = headLine.segs.map(s => s.text);
  const centers = headLine.segs.map(s => s.mid);
  const rows = rowLines.map(l => {
    const row = columns.map(() => '');
    l.segs.forEach(s => {
      // Put each cell under the heading whose centre is closest.
      let best = 0;
      centers.forEach((c, i) => { if (Math.abs(c - s.mid) < Math.abs(centers[best] - s.mid)) best = i; });
      row[best] = row[best] ? `${row[best]} ${s.text}` : s.text;
    });
    return row;
  });
  return { type: 'academic', title, columns, rows };
}

/**
 * A section with bullets: Experience (has company/project lines) or a
 * category list (POR, Awards …), with a Year column if years are printed.
 */
function bulletSection(title, note, body, markers, cells = []) {
  const bulletLines = [];   // text lines in the bullet column
  const labelLines = [];    // lines of the grey category labels
  const entryLines = [];    // "Company | Role | Dates" and "Project Title: …" lines
  const years = [];

  // Bullet text starts ~12pt after the category column (x ≈ 117.4).
  for (const l of body) {
    for (const s of l.segs) {
      if (s.x0 > 112 && s.x0 < 125) bulletLines.push({ y: l.y, seg: s });
      else if (s.x0 > 530 && isYearText(s.text)) years.push(s);
    }
  }
  const bulletYs = bulletLines.map(b => b.y);
  for (const l of body) {
    const left = l.segs.filter(s => s.x0 < 108);
    if (!left.length) continue;
    // A category label sits beside bullets: on a bullet's line, or with bullets just above and below it.
    const beside = bulletYs.some(y => near(y, l.y, 1.5))
      || (bulletYs.some(y => y < l.y && l.y - y < 9) && bulletYs.some(y => y > l.y && y - l.y < 9));
    const inBulletColumn = s => s.x0 > 112 && s.x0 < 125;
    const startsEntry = /^project title/i.test(left[0].text)
      || l.segs.some(s => s !== left[0] && !inBulletColumn(s) && s.x1 > 530 && !isYearText(s.text));
    // Everything inside the grey category column is a label (unless it's a "Project Title" line).
    const insideColumn = left.every(s => s.x1 < 110) && !/^project title/i.test(left[0].text);
    if ((insideColumn || beside) && !startsEntry) labelLines.push({ y: l.y, text: left.map(s => s.text).join(' ') });
    else entryLines.push(l);
  }

  // ---- bullets: a ■ marker starts a new one; a line without a marker continues the previous ----
  const bullets = [];
  for (const b of bulletLines.sort((a, c) => a.y - c.y)) {
    const markup = runsToMarkup(b.seg.runs);
    const starts = markers.some(m => near(m.y, b.y - 1.1, 2.2)) || !bullets.length;
    if (starts) bullets.push({ text: markup, y: b.y, lastY: b.y, year: '' });
    else {
      const last = bullets[bullets.length - 1];
      last.text = joinMarkup(last.text, markup);
      last.lastY = b.y;
    }
  }
  // Years go to the bullet on the same line (or the nearest one still without a year).
  for (const yr of years) {
    const free = bullets.filter(b => !b.year);
    const same = free.find(b => yr.y >= b.y - 1.5 && yr.y <= b.lastY + 1.5);
    const target = same || free.sort((a, c) => Math.abs(a.y - yr.y) - Math.abs(c.y - yr.y))[0];
    if (target) target.year = yr.text;
  }

  // ---- category labels ----
  const labels = [];
  const sortedLabelLines = labelLines.sort((a, c) => a.y - c.y);
  if (cells.length) {
    // Best case: each grey box is one category. Its label = the label lines inside it.
    for (const c of cells.sort((a, b) => a.top - b.top)) {
      const inside = sortedLabelLines.filter(l => l.y > c.top && l.y < c.bottom + 2);
      const prev = labels[labels.length - 1];
      // A box with no label at the top of a new page = the previous category continuing.
      if (!inside.length && prev && c.top % 1000 < 80) { prev.cells.push(c); prev.lastY = c.bottom; continue; }
      labels.push({ text: inside.map(l => l.text).join('\n'), y: c.top, lastY: c.bottom, cells: [c] });
    }
  } else {
    // Otherwise: label lines closer than 12.8pt belong to the same label.
    for (const l of sortedLabelLines) {
      const last = labels[labels.length - 1];
      if (last && l.y - last.lastY < 12.8) { last.text += `\n${l.text}`; last.lastY = l.y; }
      else labels.push({ text: l.text, y: l.y, lastY: l.y });
    }
  }

  if (!entryLines.length) {
    const showYear = years.length > 0;
    return { type: 'categorized', title, showYear, groups: makeGroups(labels, bullets, showYear, years) };
  }

  // ---- experience: split into entries at each company / project-title line ----
  const entries = [];
  const sortedEntryLines = entryLines.sort((a, c) => a.y - c.y);
  for (const l of sortedEntryLines) {
    const segs = l.segs.filter(s => !(s.x0 > 112 && s.x0 < 125)); // ignore any bullet text on the same height
    const right = segs.length > 1 && segs[segs.length - 1].x1 > 480 ? segs[segs.length - 1] : null;
    const left = segs[0];
    const middle = segs.filter(s => s !== left && s !== right).map(s => s.text).join(' ');
    const current = entries[entries.length - 1];
    if (/^project title/i.test(left.text)) {
      // A title line right under a company line belongs to that entry; otherwise it starts a new one.
      if (current && !current.subtitle && !current.hasBody && l.y - current.y < 14) {
        current.subtitle = left.text; current.duration = right?.text || ''; current.y = l.y;
      } else {
        entries.push({ org: '', role: '', dates: '', subtitle: left.text, duration: right?.text || '', y: l.y });
      }
    } else if (current && !current.hasBody && current.org && !current.subtitle && l.y - current.y < 14) {
      // A second plain line under the company line: treat it as the title line.
      current.subtitle = [left.text, middle].filter(Boolean).join(' '); current.duration = right?.text || ''; current.y = l.y;
    } else {
      entries.push({ org: left.text, role: middle, dates: right?.text || '', subtitle: '', duration: '', y: l.y });
    }
    // Mark entries that already have bullets below them.
    entries.forEach((e, i) => { if (i < entries.length - 1) e.hasBody = true; });
  }
  // Bullets/labels that appear before the first entry line get an untitled entry.
  if (bullets.length && (!entries.length || bullets[0].y < entries[0].y)) {
    entries.unshift({ org: '', role: '', dates: '', subtitle: '', duration: '', y: -Infinity });
  }
  const result = entries.map((e, i) => {
    const top = e.y;
    const bottom = i + 1 < entries.length ? entries[i + 1].y : Infinity;
    const inside = x => x.y > top && x.y < bottom;
    return {
      org: e.org, role: e.role, dates: e.dates, subtitle: e.subtitle, duration: e.duration,
      groups: makeGroups(labels.filter(inside), bullets.filter(inside), false, []),
    };
  });
  return { type: 'experience', title, note, entries: result };
}

/**
 * Hand the bullets (in order) to the category labels (in order).
 * Skynet centres each label beside its group, so we choose the split whose
 * groups' middles line up best with the labels' middles.
 */
function makeGroups(labels, bullets, showYear, years = []) {
  const toBullet = b => (showYear ? { text: b.text, year: b.year } : { text: b.text });
  // Grey boxes known: a bullet belongs to the box it starts in.
  if (labels.length && labels.every(l => l.cells)) {
    const inCells = (l, y) => l.cells.some(c => y > c.top - 2 && y < c.bottom + 2);
    const members = labels.map(() => []);
    bullets.forEach(b => {
      let i = labels.findIndex(l => inCells(l, b.y));
      if (i < 0) i = labels.reduce((best, l, j) => (Math.abs(mid(l) - b.y) < Math.abs(mid(labels[best]) - b.y) ? j : best), 0);
      members[i].push(b);
    });
    // Skynet stacks each category's years evenly in the year column (not beside
    // wrapped bullets), so hand them out in order within each category.
    if (showYear) {
      labels.forEach((l, i) => {
        const ys = years.filter(y => inCells(l, y.y)).sort((a, b) => a.y - b.y);
        if (ys.length === members[i].length) members[i].forEach((b, k) => { b.year = ys[k].text; });
      });
    }
    return labels.map((l, i) => ({ label: l.text, bullets: members[i].map(toBullet) }));
  }
  if (!labels.length) return bullets.length ? [{ label: '', bullets: bullets.map(toBullet) }] : [];
  if (!bullets.length) return labels.map(l => ({ label: l.text, bullets: [] }));

  const k = labels.length;
  const n = bullets.length;
  if (n < k) {
    // More labels than bullets: give each bullet to its nearest label.
    return labels.map(l => ({ label: l.text, bullets: [] })).map((g, i, groups) => {
      bullets.forEach(b => {
        const nearest = labels.reduce((best, lb, j) => (Math.abs(mid(lb) - b.y) < Math.abs(mid(labels[best]) - b.y) ? j : best), 0);
        if (nearest === i) g.bullets.push(toBullet(b));
      });
      return g;
    });
  }
  // cost[i][j] = cost of the best split of the first j bullets among the first i labels
  const runMid = (a, b) => (bullets[a].y + bullets[b - 1].lastY) / 2;
  const cost = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
  const from = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  cost[0][0] = 0;
  for (let i = 1; i <= k; i++) {
    for (let j = i; j <= n - (k - i); j++) {
      for (let p = i - 1; p < j; p++) {
        const c = cost[i - 1][p] + (runMid(p, j) - mid(labels[i - 1])) ** 2;
        if (c < cost[i][j]) { cost[i][j] = c; from[i][j] = p; }
      }
    }
  }
  const groups = [];
  let j = n;
  for (let i = k; i >= 1; i--) {
    const p = from[i][j];
    groups.unshift({ label: labels[i - 1].text, bullets: bullets.slice(p, j).map(toBullet) });
    j = p;
  }
  return groups;
}
const mid = label => (label.y + label.lastY) / 2;

// ---------- 4b. any other CV PDF (best effort) ----------

const BULLET_START_RE = /^[■▪•●◦‣∙·▸►➢✓✔\-–*]\s*/;

function parseGeneric(lines) {
  const sizes = lines.flatMap(l => l.segs.map(s => Math.round(s.size * 2) / 2));
  const bodySize = mode(sizes) || 10;
  const segText = l => l.segs.map(s => s.text).join('  ');

  // Headings: short lines in capitals, or bold and a bit bigger than body text.
  const isHeading = l => {
    const t = segText(l);
    if (t.length > 60 || BULLET_START_RE.test(t) || l.segs.length > 2) return false;
    const letters = t.replace(/[^A-Za-z]/g, '');
    const caps = letters && letters === letters.toUpperCase() && letters.length > 3;
    const big = l.segs[0].bold && l.segs[0].size >= bodySize + 0.4;
    return caps || big;
  };

  const nameLine = lines.slice(0, 6).reduce((a, l) => (!a || l.segs[0].size > a.segs[0].size ? l : a), null);
  const cv = { personal: { name: nameLine ? segText(nameLine) : '', line1: '', line2: '' }, headline: '', footer: '', sections: [] };
  const firstHeading = lines.findIndex(l => l !== nameLine && isHeading(l));
  const header = lines.slice(0, firstHeading < 0 ? lines.length : firstHeading).filter(l => l !== nameLine);
  cv.personal.line1 = header[0] ? segText(header[0]) : '';
  cv.personal.line2 = header[1] ? segText(header[1]) : '';
  cv.headline = header.slice(2).map(segText).join(' | ');

  let section = null;
  for (const l of lines.slice(firstHeading < 0 ? lines.length : firstHeading)) {
    if (isHeading(l)) {
      section = { title: titleCase(segText(l)), items: [] };
      cv.sections.push(section);
      continue;
    }
    section.items.push(l);
  }

  cv.sections = cv.sections.map(sec => {
    if (/educat|academ|qualif/i.test(sec.title)) {
      return {
        type: 'academic', title: sec.title, columns: ['Degree', 'Institute', '%/CGPA', 'Year'],
        rows: sec.items.map(l => {
          const cells = l.segs.map(s => s.text);
          const row = [cells[0] || '', cells.slice(1, -2).join(' ') || cells[1] || '', cells.length > 2 ? cells[cells.length - 2] : '', cells.length > 2 ? cells[cells.length - 1] : ''];
          return row;
        }),
      };
    }
    // Bullets start with a bullet sign; other lines become company/project lines.
    const entries = [];
    let bulletX = null;
    for (const l of sec.items) {
      const first = l.segs[0];
      const raw = runsToMarkup(l.segs.flatMap((s, i) => (i ? [{ text: ' ', bold: false }, ...s.runs] : s.runs)));
      const yearSeg = l.segs.length > 1 && isYearText(l.segs[l.segs.length - 1].text) ? l.segs[l.segs.length - 1] : null;
      const entry = entries[entries.length - 1];
      if (BULLET_START_RE.test(first.text)) {
        const text = raw.replace(/^(\*\*)?[■▪•●◦‣∙·▸►➢✓✔\-–*]\s*/, '$1').replace(yearSeg ? new RegExp(`\\s*${yearSeg.text}$`) : /$^/, '');
        bulletX = first.x0;
        if (!entry) entries.push({ org: '', bullets: [] });
        entries[entries.length - 1].bullets.push({ text, year: yearSeg?.text || '' });
      } else if (entry && entry.bullets.length && bulletX !== null && first.x0 > bulletX + 2) {
        const last = entry.bullets[entry.bullets.length - 1];
        last.text = joinMarkup(last.text, raw);
      } else if (entry && !entry.bullets.length && entry.org && !entry.subtitle) {
        entry.subtitle = l.segs.map(s => s.text).join(' ');
      } else {
        const right = l.segs.length > 1 ? l.segs[l.segs.length - 1].text : '';
        entries.push({ org: l.segs[0].text, dates: right, bullets: [] });
      }
    }
    const hasHeads = entries.some(e => e.org);
    const showYear = entries.some(e => e.bullets.some(b => b.year));
    if (!hasHeads) {
      return { type: 'categorized', title: sec.title, showYear, groups: [{ label: '', bullets: entries.flatMap(e => e.bullets) }] };
    }
    return {
      type: 'experience', title: sec.title, note: '',
      entries: entries.map(e => ({ org: e.org || '', role: '', dates: e.dates || '', subtitle: e.subtitle || '', duration: '', groups: [{ label: '', bullets: e.bullets.map(b => ({ text: b.text })) }] })),
    };
  });
  return cv;
}

function mode(values) {
  const counts = new Map();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = null;
  counts.forEach((c, v) => { if (best === null || c > counts.get(best)) best = v; });
  return best;
}

/** Browser entry point: a PDF File → { cv, report }. */
async function importPdfFile(file, base) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  return cvFromPdfItems(await readPdfItems(pdfjs, data), base);
}
