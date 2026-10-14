/* =====================================================================
   import-word.js — read a CV from a Word file (.docx)
   ---------------------------------------------------------------------
   1. mammoth.js (loaded only when needed) turns the .docx into simple
      HTML: <p>, <h1>…, <ul><li>, <table>, <strong> (bold), <em> (italic).
   2. We turn that HTML into "lines" — the same shape the PDF importer
      builds — and hand them to parseGeneric() in import-pdf.js, which
      finds the name, sections, entries, categories and bullets.

   Word CVs come in two styles and both work:
   - plain résumés: headings, "Company <tab> Dates" lines, bullet lists;
   - the institute layout in tables: category | bullets | year columns.

   Old .doc files (Word 97–2003) can't be read: save them as .docx first.
   ===================================================================== */

const MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

/** Load mammoth.js the first time someone imports a Word file. */
function loadMammoth() {
  if (window.mammoth) return Promise.resolve(window.mammoth);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MAMMOTH_URL;
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error('Couldn’t load the Word reader. Check your internet connection and try again.'));
    document.head.appendChild(script);
  });
}

// Section names we recognise when a heading is only written in bold (not CAPITALS).
const SECTION_WORDS_RE = /^(academic|education|qualification|scholastic|experience|work|professional|internship|summer|project|position|responsibilit|leadership|award|achievement|honou?r|certification|course|skill|technical|extra|co-curricular|volunteer|publication|interest|hobb|summary|profile|objective|language)/i;

/**
 * Text runs inside one element: [{ text, bold, italic }], bold/italic from <strong>/<b>/<em>/<i>.
 * Spaces and punctuation are always kept regular: Word often bolds the space or
 * comma next to a bold word, which would only clutter the text with ** marks.
 */
function htmlRuns(node) {
  const plain = /^[\s,.;:!?()\[\]'"‘’“”–—-]+$/;
  return collectRuns(node).flatMap(r => {
    // Split "bold word " into "bold word" + " " so the space can be regular.
    const m = r.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return [{ text: m[1] }, { ...r, text: m[2] }, { text: m[3] }]
      .filter(p => p.text)
      .map(p => (plain.test(p.text) ? { text: p.text, bold: false, italic: false } : p));
  });
}

function collectRuns(node, bold = false, italic = false, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) out.push({ text: child.textContent, bold, italic });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName;
      if (tag === 'BR') { out.push({ text: '\t', bold, italic }); continue; } // a line break inside a cell = a new column piece
      if (tag === 'UL' || tag === 'OL' || tag === 'TABLE') continue;         // lists/tables are handled on their own
      collectRuns(child, bold || tag === 'STRONG' || tag === 'B', italic || tag === 'EM' || tag === 'I', out);
    }
  }
  return out;
}

/**
 * Runs → one line object. Tabs split the line into "segments"
 * (Word CVs push dates to the right with tabs: "Company <tab><tab> May 2019").
 */
function runsToLine(runs, extra = {}) {
  const segs = [];
  let current = [];
  const flush = () => {
    const text = current.map(r => r.text).join('').replace(/\s+/g, ' ').trim();
    if (text) {
      const boldChars = current.filter(r => r.bold).reduce((n, r) => n + r.text.trim().length, 0);
      segs.push({ runs: current, text, bold: boldChars > text.replace(/\s/g, '').length / 2, size: extra.size || 10, x0: 0 });
    }
    current = [];
  };
  for (const r of runs) {
    const parts = r.text.split(/\t+/);
    parts.forEach((part, i) => {
      if (i > 0) flush();
      if (part) current.push({ ...r, text: part });
    });
  }
  flush();
  return segs.length ? { segs, ...extra } : null;
}

/** Is this line a section heading? (single short piece in CAPITALS, or bold/heading-style with a section name) */
function wordHeading(line, isHeadingTag) {
  // "SUMMER INTERNSHIP <tab> 12 Weeks" is still a heading; "COMPANY <tab> 2019" is an entry.
  const noteOnly = line.segs.length === 2 && /^\d+\s*(weeks?|months?)$/i.test(line.segs[1].text);
  if (line.segs.length !== 1 && !noteOnly) return false;
  const t = line.segs[0].text.replace(/[:\s]+$/, '');
  if (t.length > 50 || BULLET_START_RE.test(t)) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (/:\s*\S/.test(t)) return false; // "Project Title: …" or "Skills: Excel" is content, not a heading
  const caps = letters.length > 3 && letters === letters.toUpperCase() && !/\d{4}/.test(t);
  return caps || ((line.segs[0].bold || isHeadingTag) && SECTION_WORDS_RE.test(t));
}

/** A paragraph that holds only a year (or year range), e.g. a cell in the Year column. */
const yearOnly = t => /^\s*((19|20)\d{2}(\s*[-–]\s*((19|20)?\d{2}|present))?|present)\s*$/i.test(t);

/**
 * Walk mammoth's HTML and build lines for parseGeneric().
 * Each line: { segs: [{ text, runs, bold, size, x0 }], heading?, cat?, year? }
 */
function wordHtmlToLines(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const lines = [];
  let lastLabel = ''; // category label carried down a table (merged cells)

  const pushParagraph = (el, extra = {}) => {
    const isHead = /^H[1-6]$/.test(el.tagName);
    const line = runsToLine(htmlRuns(el), { size: isHead ? 12 : 10, ...extra });
    if (!line) return;
    if (!('heading' in extra)) line.heading = wordHeading(line, isHead);
    lines.push(line);
  };
  // A list item → a bullet line ("• " in front, so parseGeneric sees a bullet).
  const pushBullet = (el, extra = {}) => {
    const runs = htmlRuns(el);
    if (!runs.some(r => r.text.trim())) return;
    const text = runs.map(r => r.text).join('').trim();
    const line = runsToLine(BULLET_START_RE.test(text) ? runs : [{ text: '• ', bold: false }, ...runs], { size: 10, heading: false, ...extra });
    if (line) lines.push(line);
  };
  const walkList = (list, extra) => {
    for (const li of list.children) {
      if (li.tagName !== 'LI') continue;
      pushBullet(li, extra);
      li.querySelectorAll(':scope > ul > li, :scope > ol > li').forEach(sub => pushBullet(sub, extra)); // sub-bullets
    }
  };

  // The paragraphs/list items inside one table cell, in order.
  const cellBlocks = cell => {
    const blocks = [];
    for (const child of cell.children) {
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        for (const li of child.querySelectorAll('li')) blocks.push({ el: li, li: true });
      } else if (child.textContent.trim()) blocks.push({ el: child, li: false });
    }
    if (!blocks.length && cell.textContent.trim()) blocks.push({ el: cell, li: false });
    return blocks;
  };

  const walkTable = table => {
    for (const row of table.querySelectorAll('tr')) {
      if (row.closest('table') !== table) continue; // skip rows of tables nested inside cells
      const cells = [...row.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
      const blocks = cells.map(cellBlocks);
      // The bullets cell = the one with the most paragraphs (or any list items).
      const bulletIdx = blocks.reduce((best, b, i) => (b.length > blocks[best].length || (b.some(x => x.li) && !blocks[best].some(x => x.li)) ? i : best), 0);
      const isBulletRow = blocks[bulletIdx].length > 1 || blocks[bulletIdx].some(x => x.li);
      if (!isBulletRow) {
        // A simple row (academic row, "Org | Role | Dates", or a title row): one line, one piece per cell.
        const runs = cells.flatMap((c, i) => (i ? [{ text: '\t', bold: false }] : []).concat(htmlRuns(c)));
        const line = runsToLine(runs, { size: 10 });
        if (line) { line.heading = wordHeading(line, false); lines.push(line); }
        if (line && line.heading) lastLabel = '';
        continue;
      }
      // An institute-style row: [category] | bullets | [years]
      const others = blocks.map((b, i) => ({ b, i })).filter(x => x.i !== bulletIdx && x.b.length);
      const yearCell = others.find(x => x.b.every(p => yearOnly(p.el.textContent)));
      const labelCell = others.find(x => x !== yearCell && x.i < bulletIdx);
      if (labelCell) lastLabel = labelCell.b.map(p => p.el.textContent.trim()).join('\n');
      const years = yearCell ? yearCell.b.map(p => p.el.textContent.trim()) : [];
      blocks[bulletIdx].forEach((p, k) => pushBullet(p.el, { cat: lastLabel, year: years[k] || '' }));
    }
  };

  for (const el of doc.body.children) {
    if (el.tagName === 'UL' || el.tagName === 'OL') walkList(el, { cat: '' });
    else if (el.tagName === 'TABLE') walkTable(el);
    else {
      pushParagraph(el);
      const last = lines[lines.length - 1];
      if (last && last.heading) lastLabel = '';
    }
  }
  return lines;
}

/** Browser entry point: a .docx File → { cv }. `base` supplies the logo (a Word file's logo isn't used). */
async function importWordFile(file, base) {
  const mammoth = await loadMammoth();
  let result;
  try {
    result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  } catch (err) {
    throw new Error('That Word file couldn’t be read. If it’s an old .doc file, open it in Word and “Save As” .docx, then import again.');
  }
  const lines = wordHtmlToLines(result.value);
  if (!lines.length) throw new Error('That Word file looks empty, so there was nothing to import.');
  return { cv: cvFromWordLines(lines, base) };
}

/** Lines → a CV, plus the bits only a Word CV needs (name split, LinkedIn as the footer). */
function cvFromWordLines(lines, base) {
  // The LinkedIn link usually sits in the header line: move it to the footer.
  let footer = '';
  for (const l of [...lines.slice(0, 8), ...lines.slice(-3)]) { // header lines, or the last lines
    for (const s of l.segs) {
      const m = s.text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?/i);
      if (m && !footer) footer = m[0].replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
  }
  // A line that is only the LinkedIn link (often at the very bottom) is the footer, not content.
  lines = lines.filter(l => !/^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?$/i.test(l.segs.map(s => s.text).join(' ').trim()));
  // The first line is the name: make it the biggest text so parseGeneric picks it.
  lines[0].heading = false;
  lines[0].segs.forEach(seg => { seg.size = 16; });
  const cv = parseGeneric(lines);
  // "NAME | phone | email" on one line → name + the rest as line 1
  const parts = cv.personal.name.split(/\s+\|\s+|\s{2,}/);
  if (parts.length > 1) {
    cv.personal.name = parts[0];
    cv.personal.line2 = cv.personal.line1;
    cv.personal.line1 = parts.slice(1).join(' | ');
  }
  // Drop the LinkedIn link from the header lines (it's now the footer).
  const strip = t => t.replace(/\s*\|?\s*(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w%-]+\/?\s*\|?\s*/i, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim();
  cv.personal.line1 = strip(cv.personal.line1);
  cv.personal.line2 = strip(cv.personal.line2);
  cv.headline = strip(cv.headline);
  cv.footer = footer;
  cv.personal.logo = base?.personal?.logo ?? '';
  return normalizeCv(cv);
}
