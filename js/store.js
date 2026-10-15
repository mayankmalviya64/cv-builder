/* =====================================================================
   store.js — keeping the CV data safe
   ---------------------------------------------------------------------
   - Autosaves to this browser's localStorage (only you see it).
   - Export / Import a .json file to move your CV between devices.
   - Import also reads a CV PDF (import-pdf.js) or Word .docx (import-word.js).
   - Small helpers to read/write a value by its "path"
     e.g. getAt(cv, 'sections.1.entries.0.org').
   ===================================================================== */

const STORAGE_KEY = 'cv-builder:v1';

/** A deep copy, so editing the CV never changes SAMPLE_CV itself. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Load the saved CV, or the sample if nothing is saved / it's unreadable. */
function loadCv() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const cv = JSON.parse(saved);
      if (isValidCv(cv)) return normalizeCv(cv);
    }
  } catch (err) {
    // Private windows or blocked storage land here — just use the sample.
  }
  return clone(SAMPLE_CV);
}

/** Save the CV. Returns false if the browser refused (e.g. storage full). */
function saveCv(cv) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cv));
    return true;
  } catch (err) {
    return false;
  }
}

/** Is this at least roughly a CV? (an object with sections, or with a personal block) */
function isValidCv(cv) {
  return !!cv && typeof cv === 'object' && !Array.isArray(cv) && (Array.isArray(cv.sections) || typeof cv.personal === 'object');
}

// ---- Repairing imported data ---------------------------------------------
// An imported file may come from an older version, be hand-edited, or have
// sections that don't match our three types. normalizeCv() fills in every
// missing field and converts odd shapes, so the editor never breaks.

const str = v => (v == null ? '' : String(v));
const list = v => (Array.isArray(v) ? v : v == null ? [] : [v]);

/**
 * Include / exclude tick marks: an unticked item gets `hidden: true`.
 * It stays in the editor but is left out of the printed CV.
 * keepHidden() copies that flag onto a repaired item (only when it's set).
 */
function keepHidden(from, to) {
  if (from && typeof from === 'object' && from.hidden) to.hidden = true;
  return to;
}

/** Is this item ticked (shown on the CV)? */
function isIncluded(item) {
  return !(item && item.hidden);
}

function normalizeBullet(b, withYear) {
  const bullet = typeof b === 'string' ? { text: b } : { text: str(b && (b.text ?? b.bullet ?? b.content)) };
  if (withYear) bullet.year = str(b && typeof b === 'object' ? b.year : '');
  return keepHidden(b, bullet);
}

function normalizeGroup(g, withYear) {
  if (typeof g === 'string' || (g && !g.bullets && g.text)) g = { label: '', bullets: [g] }; // a bare bullet
  return keepHidden(g, {
    label: str(g && (g.label ?? g.category ?? g.name)),
    bullets: list(g && (g.bullets ?? g.items ?? g.points)).map(b => normalizeBullet(b, withYear)),
  });
}

/** Pick a section type from its contents when the type is missing or unknown. */
function guessType(sec) {
  if (['academic', 'experience', 'categorized'].includes(sec.type)) return sec.type;
  if (Array.isArray(sec.rows)) return 'academic';
  if (Array.isArray(sec.entries)) return 'experience';
  return 'categorized';
}

function normalizeSection(sec) {
  sec = sec && typeof sec === 'object' ? sec : {};
  return keepHidden(sec, normalizeSectionBody(sec));
}

function normalizeSectionBody(sec) {
  const type = guessType(sec);
  const title = str(sec.title ?? sec.name ?? sec.heading) || 'Section';
  if (type === 'academic') {
    const columns = list(sec.columns).map(str);
    const cols = columns.length ? columns : ['Degree', 'Institute', '%/CGPA', 'Year'];
    const rows = list(sec.rows).map(r => {
      const cells = Array.isArray(r) ? r.map(str) : typeof r === 'object' && r ? Object.values(r).map(str) : [str(r)];
      while (cells.length < cols.length) cells.push('');
      return cells.slice(0, cols.length);
    });
    return { type, title, columns: cols, rows };
  }
  if (type === 'experience') {
    const entries = list(sec.entries).map(e => {
      e = e && typeof e === 'object' ? e : {};
      // Bullets sitting straight on the entry (no categories) → one unnamed category.
      const groups = e.groups ? list(e.groups) : e.bullets ? [{ label: '', bullets: e.bullets }] : [];
      return keepHidden(e, {
        org: str(e.org ?? e.company ?? e.organisation), role: str(e.role ?? e.position), dates: str(e.dates ?? e.date),
        subtitle: str(e.subtitle ?? e.title), duration: str(e.duration),
        groups: groups.map(g => normalizeGroup(g, false)),
      });
    });
    return { type, title, note: str(sec.note), entries };
  }
  // categorized
  const rawGroups = sec.groups ? list(sec.groups) : sec.bullets ? [{ label: '', bullets: sec.bullets }] : [];
  const showYear = sec.showYear != null
    ? !!sec.showYear
    : rawGroups.some(g => list(g && g.bullets).some(b => b && typeof b === 'object' && b.year));
  return { type: 'categorized', title, showYear, groups: rawGroups.map(g => normalizeGroup(g, showYear)) };
}

/** Return a complete, safe CV object built from whatever we were given. */
function normalizeCv(raw) {
  const cv = raw && typeof raw === 'object' ? raw : {};
  const p = cv.personal && typeof cv.personal === 'object' ? cv.personal : {};
  return {
    personal: { name: str(p.name), line1: str(p.line1), line2: str(p.line2), logo: str(p.logo) },
    headline: str(cv.headline),
    footer: str(cv.footer),
    sections: list(cv.sections).map(normalizeSection),
  };
}

/**
 * "<First name>'s CV", using the name written on the CV. Used as the file
 * name for both the PDF download and the JSON export.
 * e.g. "MAYANK MALVIYA" → "Mayank's CV". With no name it is just "CV".
 */
function cvFileName(cv) {
  // Drop formatting marks (**bold**, _italic_) and anything a file name can't hold.
  const clean = (cv.personal?.name || '').replace(/[*_\\/:"<>|?]/g, ' ').trim();
  // Skip a leading title like "Dr." or "Mr" so we get the actual first name.
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^(dr|mr|mrs|ms|miss|prof|ca|er)\.?$/i.test(words[0])) words.shift();
  let first = words[0] || '';
  if (!first) return 'CV';
  // Names imported in ALL CAPS read better as "Mayank" than "MAYANK".
  if (first === first.toUpperCase()) first = first[0] + first.slice(1).toLowerCase();
  return `${first}'s CV`;
}

/** Download the CV as a .json file. */
function exportCv(cv) {
  const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${cvFileName(cv)}.json`; // e.g. "Mayank's CV.json"
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/**
 * Read a file chosen by the user: a CV PDF (e.g. from Skynet), a Word .docx, or a .json
 * exported from this builder. Resolves with { cv, source } or rejects with a message.
 * `current` is the CV on screen (its logo is kept, a PDF can't give us one).
 */
async function importCvFile(file, current) {
  // Word: .docx works; old .doc files need to be re-saved as .docx first.
  if (/\.docx$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { cv } = await importWordFile(file, current);
    return { cv, source: 'word' };
  }
  if (/\.doc$/i.test(file.name) || file.type === 'application/msword') {
    throw new Error('That’s an old Word file (.doc). Open it in Word, choose File → Save As → Word Document (.docx), then import the .docx.');
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const { cv } = await importPdfFile(file, current);
    return { cv, source: 'pdf' };
  }
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    throw new Error('That file isn’t a PDF, a Word .docx or a .json CV, so it can’t be imported.');
  }
  if (!isValidCv(data)) throw new Error('That .json file doesn’t look like a CV from this builder.');
  return { cv: normalizeCv(data), source: 'json' };
}

// ---- Path helpers ------------------------------------------------------
// A "path" is a dotted address into the CV object.
// Numbers are array positions: 'sections.2.groups.0' = 3rd section, 1st group.

function getAt(obj, path) {
  if (path === '') return obj; // empty path = the object itself (needed for top-level fields like 'footer')
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj);
}

function setAt(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = getAt(obj, keys.join('.'));
  if (parent != null) parent[last] = value;
}

/** Split 'a.b.3' into the parent path 'a.b' and the index 3. */
function splitPath(path) {
  const keys = path.split('.');
  const index = Number(keys.pop());
  return { parentPath: keys.join('.'), index };
}
