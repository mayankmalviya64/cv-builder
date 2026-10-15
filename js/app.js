/* =====================================================================
   app.js — glues everything together
   ---------------------------------------------------------------------
   1. Load the CV (saved copy or sample) and wait for EB Garamond.
   2. Mount the editor, draw the preview, fit it to the screen.
   3. Keep the top-bar stats, page-fit check and autosave up to date.
   ===================================================================== */

let cv = loadCv();

const els = {
  editor: document.getElementById('editor'),
  page: document.getElementById('cv-page'),
  scaler: document.getElementById('cv-scaler'),
  pane: document.getElementById('preview-pane'),
  stats: document.getElementById('stats'),
  pageStatus: document.getElementById('page-status'),
  banner: document.getElementById('banner'),
  highlights: document.getElementById('toggle-highlights'),
  undo: document.getElementById('btn-undo'),
  redo: document.getElementById('btn-redo'),
  importBtn: document.getElementById('btn-import'),
};

const PAGE_HEIGHT_PX = LAYOUT.pageHeightPt * PX_PER_PT;
const PAGE_WIDTH_PX = LAYOUT.pageWidthPt * PX_PER_PT;

// ---------- preview ----------
let previewQueued = false;

/** Redraw the preview at most once per animation frame (keeps typing smooth). */
function queuePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    renderPreview();
  });
}

function renderPreview() {
  els.page.innerHTML = renderCvHtml(cv) + '<div class="cv-pagebreak" hidden><span>A4 page ends here</span></div>';
  updatePageFit();
  updateStats();
  fitPreview();
  updateImportPrompt();
}

// ---------- "Import your CV" prompt ----------
// While the untouched sample CV is on screen (a new visitor, or after Reset),
// the Import button pulses and a green banner asks them to import their own PDF.
const SAMPLE_JSON = JSON.stringify(SAMPLE_CV);

function updateImportPrompt() {
  const showingSample = JSON.stringify(cv) === SAMPLE_JSON;
  els.importBtn.classList.toggle('pulse', showingSample);
  if (showingSample && els.banner.hidden) {
    els.banner.className = 'banner no-print cta';
    // Just the message: the pulsing Import button in the top bar is the thing to click.
    els.banner.innerHTML = '<span><b>Start with your own CV:</b> this is a sample. Import your CV as a PDF (your Skynet CV works best) or a Word file, and every section fills in for you.</span>';
    els.banner.hidden = false;
  } else if (!showingSample && els.banner.classList.contains('cta')) {
    showBanner(''); // they've started editing or imported: hide the prompt
  }
}

/** Does everything fit on one A4 page? Show a red line where the page ends if not. */
function updatePageFit() {
  // Height of the content itself (the page box is at least one A4 tall).
  const last = els.page.lastElementChild.previousElementSibling; // element before the page-break marker
  const pageTop = els.page.getBoundingClientRect().top;
  const scale = currentScale || 1;
  const contentBottom = last ? (last.getBoundingClientRect().bottom - pageTop) / scale : 0;
  // Skynet's footer ends ~2.5pt above the page edge; keep 1pt of safety.
  const bottomPadding = 1 * PX_PER_PT;
  const overflowPx = contentBottom + bottomPadding - PAGE_HEIGHT_PX;

  const marker = els.page.querySelector('.cv-pagebreak');
  if (overflowPx > 0.5) {
    marker.hidden = false;
    els.pageStatus.className = 'page-status bad';
    els.pageStatus.textContent = `Overflows A4 by ${(overflowPx / PX_PER_PT).toFixed(0)}pt (~${Math.ceil(overflowPx / 15)} lines)`;
  } else {
    marker.hidden = true;
    els.pageStatus.className = 'page-status good';
    els.pageStatus.textContent = `Fits on one A4 page · ${(-overflowPx / PX_PER_PT).toFixed(0)}pt spare`;
  }
}

/** Top-bar counters: how many bullets are at the brim / under / over. */
function updateStats() {
  const counts = { brim: 0, under: 0, over: 0, total: 0 };
  // Remember where each kind of bullet is, so clicking a counter can jump there.
  statPaths = { brim: [], under: [], over: [] };
  forEachBullet(cv, (bullet, path, capacityPt) => {
    const st = analyzeBullet(bullet.text, capacityPt).status;
    if (st === 'empty') return;
    counts.total++;
    counts[st]++;
    statPaths[st].push(path);
  });
  const score = counts.total ? Math.round((counts.brim / counts.total) * 100) : 0;
  // One clickable counter; it's disabled when there's nothing to jump to.
  const counter = (st, label, tip) =>
    `<button type="button" class="stat st-${st}" data-jump="${st}" title="${tip} · click to jump to the next one" ${counts[st] ? '' : 'disabled'}>${counts[st]}<small>${label}</small></button>`;
  els.stats.innerHTML = `
    <span class="stat score" title="Share of bullets that fill their line perfectly">${score}%<small>fit score</small></span>
    ${counter('brim', 'perfect', 'Fills 98–100% of its line')}
    ${counter('under', 'too short', 'Under 98% of the line: add a few words')}
    ${counter('over', 'too long', 'Goes onto a 2nd line: cut a few letters')}`;
}

// Clicking a counter jumps to the next bullet of that kind; each click moves on
// to the following one, and after the last it starts again from the top.
let statPaths = { brim: [], under: [], over: [] };
let lastJump = null; // the bullet we jumped to last time, e.g. 'sections.2.groups.0.bullets.3'
els.stats.addEventListener('click', event => {
  const btn = event.target.closest('[data-jump]');
  if (!btn) return;
  const list = statPaths[btn.dataset.jump];
  if (!list.length) return;
  const prev = list.indexOf(lastJump); // -1 if we haven't jumped to one of these yet
  lastJump = list[(prev + 1) % list.length];
  Editor.focusBullet(lastJump);
});

// ---------- scale the A4 page to fit the right-hand pane ----------
let currentScale = 1;

function fitPreview() {
  const available = els.pane.clientWidth - 32; // 16px breathing room each side
  currentScale = Math.min(1.25, Math.max(0.3, available / PAGE_WIDTH_PX));
  els.page.style.transform = `scale(${currentScale})`;
  els.scaler.style.width = `${PAGE_WIDTH_PX * currentScale}px`;
  els.scaler.style.height = `${els.page.offsetHeight * currentScale}px`;
}

// ---------- saving ----------
let saveTimer = null;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!saveCv(cv)) showBanner('Couldn’t autosave (browser storage is full or blocked). Use Export to keep a copy.', 'warn');
  }, 300);
}

function showBanner(text, kind = 'info') {
  els.banner.textContent = text;
  els.banner.className = `banner no-print ${kind}`;
  els.banner.hidden = !text;
}

/** Called by the editor whenever the CV changes ('text' = typing, 'structure' = anything else). */
function handleChange(kind) {
  queuePreview();
  queueSave();
  History.record(kind);
}

/** Swap in a whole new CV (import / reset). Can be undone. */
function replaceCv(next) {
  cv = next;
  Editor.render();
  renderPreview();
  queueSave();
  History.record('structure');
}

// ---------- undo / redo ----------
// The editor redraws its fields after most changes, which wipes the browser's
// own undo memory. So we keep our own: a list of saved copies of the whole CV.
// - Typing in one field is ONE step until you pause for a second.
// - Every other change (add, delete, drag, bold, tweak, import…) is one step.
const History = (() => {
  const LIMIT = 200;      // how many steps back we remember
  const MERGE_MS = 1000;  // keystrokes closer than this join the same step
  let past = [];          // older copies (JSON strings)
  let future = [];        // copies we undid (for redo)
  let current = JSON.stringify(cv);
  let lastField = '';
  let lastTime = 0;

  function record(kind) {
    const snap = JSON.stringify(cv);
    if (snap === current) return;
    const field = kind === 'text' ? (document.activeElement?.dataset?.bind || '') : '';
    const now = Date.now();
    const sameTyping = kind === 'text' && field && field === lastField && now - lastTime < MERGE_MS;
    if (!sameTyping) {
      past.push(current);
      if (past.length > LIMIT) past.shift();
    }
    current = snap;
    future = [];
    lastField = field;
    lastTime = now;
    updateButtons();
  }

  /** Put a saved copy back on screen, keeping the cursor in the same field if possible. */
  function apply(snap) {
    const active = document.activeElement;
    const field = active?.dataset?.bind;
    const caret = active && 'selectionStart' in active ? active.selectionStart : null;
    const closed = Editor.closedTitles();
    cv = JSON.parse(snap);
    current = snap;
    lastField = '';
    Editor.render(closed);
    renderPreview();
    queueSave();
    updateButtons();
    if (field) {
      const el = els.editor.querySelector(`[data-bind="${field}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret !== null && 'setSelectionRange' in el && el.type !== 'checkbox') {
          const at = Math.min(caret, el.value.length);
          el.setSelectionRange(at, at);
        }
      }
    }
  }

  function undo() {
    if (!past.length) return;
    future.push(current);
    apply(past.pop());
  }

  function redo() {
    if (!future.length) return;
    past.push(current);
    apply(future.pop());
  }

  function updateButtons() {
    els.undo.disabled = !past.length;
    els.redo.disabled = !future.length;
  }

  return { record, undo, redo, updateButtons };
})();

// ⌘Z / Ctrl+Z = undo, ⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y = redo — anywhere on the page.
document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'z' && !event.shiftKey) { event.preventDefault(); History.undo(); }
  else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); History.redo(); }
}, true);
els.undo.addEventListener('click', () => History.undo());
els.redo.addEventListener('click', () => History.redo());

/** One line telling the user what was imported, so they can spot anything missing. */
function importSummary(imported, source) {
  let bullets = 0;
  forEachBullet(imported, () => { bullets++; });
  const names = imported.sections.map(s => s.title).join(', ');
  const from = source === 'pdf' ? 'Imported from PDF' : source === 'word' ? 'Imported from Word' : 'Imported';
  return `${from}: ${imported.sections.length} sections (${names}), ${bullets} bullets. Please check it over — press ⌘Z / Ctrl+Z to undo the import.`;
}

// ---------- top-bar buttons ----------
// Download PDF = the browser's print dialog. We count it on 'beforeprint', so
// ⌘P / Ctrl+P count too; `via` tells the button and the shortcut apart.
let printViaButton = false;
document.getElementById('btn-print').addEventListener('click', () => {
  printViaButton = true;
  window.print();
});
window.addEventListener('beforeprint', () => {
  track('download_pdf', { via: printViaButton ? 'button' : 'shortcut' });
  printViaButton = false;
  // The browser names the saved PDF after the page title, so we swap the
  // title to e.g. "Mayank's CV" while the dialog is open.
  document.title = cvFileName(cv);
});
// Put the normal tab title back once the print dialog closes.
window.addEventListener('afterprint', () => { document.title = APP_TITLE; });

const APP_TITLE = document.title; // "CV Builder", from index.html

document.getElementById('btn-export').addEventListener('click', () => {
  exportCv(cv);
  track('export_json');
});
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Replace your CV with the sample? Export first if you want to keep it.')) replaceCv(clone(SAMPLE_CV));
});
// The Import "button" is a <label>, which the keyboard can't press by itself:
// Enter or Space opens the file picker, like a real button.
els.importBtn.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    document.getElementById('import-file').click();
  }
});
document.getElementById('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = ''; // allow picking the same file again later
  if (!file) return;
  showBanner(`Reading ${file.name}…`, 'info');
  try {
    const { cv: imported, source } = await importCvFile(file, cv);
    replaceCv(imported);
    showBanner(importSummary(imported, source), 'info');
    let bullets = 0;
    forEachBullet(imported, () => { bullets++; });
    track('cv_import', { source, sections: imported.sections.length, bullets });
  } catch (err) {
    showBanner(err.message || 'Couldn’t import that file.', 'warn');
    // Only the file's extension is sent, never its name.
    const ext = (file.name.match(/\.(\w+)$/) || [])[1] || 'unknown';
    track('cv_import_failed', { file_type: ext.toLowerCase(), error: (err.message || '').slice(0, 100) });
  }
});
els.highlights.addEventListener('change', () => {
  els.page.classList.toggle('hl', els.highlights.checked);
});

// Clicking a bullet in the preview jumps to it in the editor.
els.page.addEventListener('click', event => {
  const bullet = event.target.closest('.cv-bullet[data-path]');
  if (bullet) Editor.focusBullet(bullet.dataset.path);
});

window.addEventListener('resize', fitPreview);
// Re-check the page height once images (the logo) finish loading.
els.page.addEventListener('load', () => { updatePageFit(); fitPreview(); }, true);

// ---------- "new version available" notice ----------
// A tab that stays open keeps running the code it loaded, even after the site is
// updated (that once made correct lines show as "too long"). So now and then we
// fetch the live index.html, read its ?v= version tag, and compare it with ours.

// Our own version tag, read from this script's URL ("js/app.js?v=20261015c").
const MY_VERSION = (document.currentScript?.src.match(/[?&]v=([\w.-]+)/) || [])[1] || '';
const UPDATE_CHECK_MS = 5 * 60 * 1000;   // at most one check every 5 minutes
let lastUpdateCheck = 0;

async function checkForUpdate() {
  // Skip when opened as a local file, or when we already showed the notice.
  if (!MY_VERSION || location.protocol === 'file:') return;
  if (!document.getElementById('update-banner').hidden) return;
  if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
  lastUpdateCheck = Date.now();
  try {
    // cache: 'no-store' = ask the server, never the browser's cached copy.
    const res = await fetch('index.html', { cache: 'no-store' });
    if (!res.ok) return;
    const live = ((await res.text()).match(/js\/app\.js\?v=([\w.-]+)/) || [])[1];
    if (live && live !== MY_VERSION) document.getElementById('update-banner').hidden = false;
  } catch (err) {
    // Offline or blocked: no notice, try again later.
  }
}

document.getElementById('update-reload').addEventListener('click', () => {
  clearTimeout(saveTimer);
  saveCv(cv);              // save right now (autosave waits 300ms) so nothing is lost
  location.reload();
});
// Check when you come back to the tab, and every few minutes while it's open.
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
setInterval(checkForUpdate, UPDATE_CHECK_MS);
checkForUpdate();

// ---------- start ----------
Editor.mount(els.editor, () => cv, handleChange);
renderPreview();
History.updateButtons();

// Measurements need the real font: re-measure everything once it arrives.
loadCvFont().then(status => {
  if (status === 'fallback') {
    showBanner('The CV font couldn’t load, so the preview may look slightly off. The line checks are still exact. Try reloading.', 'warn');
  }
  Editor.render();
  renderPreview();
});
