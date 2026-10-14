/* =====================================================================
   store.js — keeping the CV data safe
   ---------------------------------------------------------------------
   - Autosaves to this browser's localStorage (only you see it).
   - Export / Import a .json file to move your CV between devices.
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
      if (isValidCv(cv)) return cv;
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

/** Basic shape check so a wrong file can't break the app. */
function isValidCv(cv) {
  return !!cv && typeof cv === 'object' && Array.isArray(cv.sections) && typeof cv.personal === 'object';
}

/** Download the CV as a .json file. */
function exportCv(cv) {
  const blob = new Blob([JSON.stringify(cv, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  const name = (cv.personal?.name || 'cv').trim().replace(/\s+/g, '-').toLowerCase();
  link.href = URL.createObjectURL(blob);
  link.download = `${name}-cv.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Read a .json file chosen by the user. Resolves with the CV or rejects with a message. */
function importCvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cv = JSON.parse(reader.result);
        if (!isValidCv(cv)) throw new Error('shape');
        resolve(cv);
      } catch (err) {
        reject(new Error('That file isn’t a CV exported from this builder.'));
      }
    };
    reader.onerror = () => reject(new Error('Couldn’t read that file.'));
    reader.readAsText(file);
  });
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
