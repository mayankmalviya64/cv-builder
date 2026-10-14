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
  forEachBullet(cv, (bullet, path, capacityPt) => {
    const st = analyzeBullet(bullet.text, capacityPt).status;
    if (st === 'empty') return;
    counts.total++;
    counts[st]++;
  });
  const score = counts.total ? Math.round((counts.brim / counts.total) * 100) : 0;
  els.stats.innerHTML = `
    <span class="stat score" title="Share of bullets that fill their line perfectly">${score}%<small>fit score</small></span>
    <span class="stat st-brim" title="Fills 98–100% of its line">${counts.brim}<small>perfect</small></span>
    <span class="stat st-under" title="Under 98% of the line: add a few words">${counts.under}<small>too short</small></span>
    <span class="stat st-over" title="Goes onto a 2nd line: cut a few letters">${counts.over}<small>too long</small></span>`;
}

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

/** Called by the editor whenever the CV changes. */
function handleChange() {
  queuePreview();
  queueSave();
}

/** Swap in a whole new CV (import / reset). */
function replaceCv(next) {
  cv = next;
  Editor.render();
  renderPreview();
  queueSave();
}

// ---------- top-bar buttons ----------
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-export').addEventListener('click', () => exportCv(cv));
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Replace your CV with the sample? Export first if you want to keep it.')) replaceCv(clone(SAMPLE_CV));
});
document.getElementById('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = ''; // allow picking the same file again later
  if (!file) return;
  try {
    replaceCv(await importCvFile(file));
    showBanner('');
  } catch (err) {
    showBanner(err.message, 'warn');
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

// ---------- start ----------
Editor.mount(els.editor, () => cv, handleChange);
renderPreview();

// Measurements need the real font: re-measure everything once it arrives.
loadCvFont().then(status => {
  if (status === 'fallback') {
    showBanner('EB Garamond couldn’t load, so widths are approximate (measured with Georgia). Check your internet connection and reload.', 'warn');
  }
  Editor.render();
  renderPreview();
});
