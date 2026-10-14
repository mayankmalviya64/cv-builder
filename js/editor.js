/* =====================================================================
   editor.js — the form on the left
   ---------------------------------------------------------------------
   How it's wired:
   - Every input has data-bind="<path>" → typing writes to that path in
     the CV object (see setAt in store.js).
   - Every button has data-action="…" (+ data-path) → one click handler
     below decides what to do (add, remove, move, bold, tweak …).
   - Typing only refreshes the bullet's meter + the preview.
     Adding/removing/moving things rebuilds the whole editor.
   ===================================================================== */

const Editor = (() => {
  let root = null;          // the <aside id="editor"> element
  let getCv = null;         // function that returns the current CV object
  let onChange = null;      // tells app.js something changed ('text' | 'structure')
  const closed = new WeakSet(); // sections the user collapsed (remembered by object)

  const TYPE_NAMES = { academic: 'Academic table', experience: 'Experience', categorized: 'Category list' };

  // ---------- small HTML helpers ----------
  const esc = escapeHtml; // from preview.js

  function field(label, path, value, opts = {}) {
    const tag = opts.multiline
      ? `<textarea data-bind="${path}" rows="${opts.rows || 2}" placeholder="${esc(opts.placeholder || '')}">${esc(value)}</textarea>`
      : `<input type="text" data-bind="${path}" value="${esc(value)}" placeholder="${esc(opts.placeholder || '')}">`;
    return `<label class="field ${opts.cls || ''}"><span>${label}</span>${tag}</label>`;
  }

  function iconBtn(action, path, symbol, title, extra = '') {
    return `<button type="button" class="icon-btn" data-action="${action}" data-path="${path}" title="${title}" aria-label="${title}" ${extra}>${symbol}</button>`;
  }

  /**
   * ⠿ drag handle + ✕ button for any item inside a list.
   * Drag the handle to reorder (or focus it and press ↑ / ↓ on the keyboard).
   */
  function moveRemove(path, what) {
    return `<button type="button" class="icon-btn drag-handle" data-action="drag" data-path="${path}"`
      + ` title="Drag to reorder this ${what} (or focus and press ↑ / ↓)" aria-label="Reorder ${what}">⠿</button>`
      + iconBtn('remove', path, '✕', `Remove ${what}`, 'data-danger');
  }

  /**
   * ☑ Include tick mark. Ticked = printed on the CV. Unticked = kept here in
   * the editor (greyed out) but left off the CV, so you can bring it back later.
   */
  function includeBox(path, item, what) {
    const on = isIncluded(item);
    const tip = on ? `On the CV — untick to leave this ${what} out (it stays here)` : `Left out of the CV — tick to put this ${what} back`;
    return `<label class="inc" title="${tip}"><input type="checkbox" data-include="${path}" ${on ? 'checked' : ''} aria-label="Include this ${what} on the CV"></label>`;
  }

  /** Extra class for an unticked item, so it shows greyed out. */
  const offClass = item => (isIncluded(item) ? '' : ' excluded');

  // ---------- which width does a bullet get? ----------
  /** The line capacity (pt) for the bullet at this path. */
  function capacityForPath(path) {
    const sIndex = Number(path.split('.')[1]);
    const section = getCv().sections[sIndex];
    const hasYear = section.type === 'categorized' && !!section.showYear;
    return bulletCapacityPt(true, hasYear);
  }

  // ---------- one bullet ----------
  function bulletHtml(bullet, path, withYear) {
    const year = withYear
      ? `<input type="text" class="bl-year" data-bind="${path}.year" value="${esc(bullet.year)}" placeholder="Year" aria-label="Year">`
      : '';
    return `
      <div class="bl${offClass(bullet)}" data-path="${path}" data-item="${path}">
        <div class="bl-row">
          ${includeBox(path, bullet, 'bullet')}
          <textarea class="bl-text" data-bind="${path}.text" data-kind="bullet" rows="1" spellcheck="true"
            placeholder="Action verb + what you did + measurable result">${esc(bullet.text)}</textarea>
          ${year}
          <div class="bl-actions">
            ${iconBtn('bold', path, '<b>B</b>', 'Bold the selected words (Ctrl/⌘+B)')}
            ${iconBtn('italic', path, '<i>I</i>', 'Italicise the selected words (Ctrl/⌘+I)')}
            ${iconBtn('sup', path, 'x<sup>2</sup>', 'Superscript the selected letters, like the “th” in 10th (Ctrl/⌘+.)')}
            ${moveRemove(path, 'bullet')}
          </div>
        </div>
        <div class="bl-check"></div>
      </div>`;
  }

  /** Fill in the meter, message and tweak chips under one bullet. */
  function refreshBullet(path) {
    const box = root.querySelector(`.bl[data-path="${path}"]`);
    if (!box) return;
    const text = getAt(getCv(), path + '.text') || '';
    const capacityPt = capacityForPath(path);
    const check = analyzeBullet(text, capacityPt);

    // The bar shows 0–110% of one line; the green stripe is the 98–100% brim zone.
    const scale = 110;
    const barWidth = Math.min(check.fill, scale) / scale * 100;
    const tweaks = suggestTweaks(text, capacityPt, check.status)
      .map(t => `<button type="button" class="chip st-${t.after.status}" data-action="tweak" data-path="${path}" data-index="${t.index}" title="Apply this wording change">
          ${esc(t.label)} <em>→ ${t.after.fill.toFixed(1)}%</em></button>`)
      .join('');

    box.querySelector('.bl-check').innerHTML = check.status === 'empty' ? '' : `
      <div class="meter" title="${capacityPt}pt line">
        <div class="track">
          <div class="zone" style="left:${BRIM_MIN / scale * 100}%;width:${(BRIM_MAX - BRIM_MIN) / scale * 100}%"></div>
          <div class="fill st-${check.status}" style="width:${barWidth}%"></div>
        </div>
        <span class="pct st-${check.status}">${check.fill.toFixed(1)}%</span>
      </div>
      <div class="msg st-${check.status}">${esc(check.message)}</div>
      ${tweaks ? `<div class="tweaks">${tweaks}</div>` : ''}`;
    box.dataset.status = check.status;
  }

  // ---------- a category group (label + bullets) ----------
  function groupHtml(group, path, withYear) {
    const bullets = group.bullets.map((b, i) => bulletHtml(b, `${path}.bullets.${i}`, withYear)).join('');
    return `
      <div class="group${offClass(group)}" data-item="${path}">
        <div class="group-head">
          ${includeBox(path, group, 'category')}
          ${field('Category', `${path}.label`, group.label, { multiline: true, rows: 2, cls: 'grow', placeholder: 'e.g. Achievements' })}
          <div class="row-actions">${moveRemove(path, 'category')}</div>
        </div>
        <div class="bullets">${bullets}</div>
        <button type="button" class="add-btn" data-action="add" data-path="${path}.bullets" data-template="${withYear ? 'bullet-year' : 'bullet'}">+ Bullet</button>
      </div>`;
  }

  // ---------- section bodies ----------
  function academicBody(section, sPath) {
    const head = section.columns.map((c, i) => `<input type="text" data-bind="${sPath}.columns.${i}" value="${esc(c)}" aria-label="Column ${i + 1} heading">`).join('');
    const rows = section.rows.map((row, r) => `
      <div class="acad-row" data-item="${sPath}.rows.${r}">
        ${row.map((cell, c) => `<input type="text" data-bind="${sPath}.rows.${r}.${c}" value="${esc(cell)}" placeholder="${esc(section.columns[c])}">`).join('')}
        <div class="row-actions">${moveRemove(`${sPath}.rows.${r}`, 'row')}</div>
      </div>`).join('');
    return `
      <div class="acad">
        <div class="acad-row head">${head}<div class="row-actions"></div></div>
        ${rows}
      </div>
      <button type="button" class="add-btn" data-action="add" data-path="${sPath}.rows" data-template="row">+ Row</button>`;
  }

  function experienceBody(section, sPath) {
    const entries = section.entries.map((entry, e) => {
      const ePath = `${sPath}.entries.${e}`;
      const groups = entry.groups.map((g, gi) => groupHtml(g, `${ePath}.groups.${gi}`, false)).join('');
      return `
        <div class="entry${offClass(entry)}" data-item="${ePath}">
          <div class="entry-head">
            <span class="entry-name">${includeBox(ePath, entry, 'entry')}<strong>Entry ${e + 1}</strong></span>
            <div class="row-actions">${moveRemove(ePath, 'entry')}</div>
          </div>
          <div class="grid-3">
            ${field('Organisation', `${ePath}.org`, entry.org)}
            ${field('Role', `${ePath}.role`, entry.role)}
            ${field('Dates', `${ePath}.dates`, entry.dates, { placeholder: 'Apr’26-May’26' })}
          </div>
          <div class="grid-title">
            ${field('Title line', `${ePath}.subtitle`, entry.subtitle, { placeholder: 'Project Title: …' })}
            ${field('Right note', `${ePath}.duration`, entry.duration, { placeholder: '3 Weeks' })}
          </div>
          ${groups}
          <button type="button" class="add-btn" data-action="add" data-path="${ePath}.groups" data-template="group">+ Category</button>
        </div>`;
    }).join('');
    return `${entries}<button type="button" class="add-btn strong" data-action="add" data-path="${sPath}.entries" data-template="entry">+ Entry (company / project)</button>`;
  }

  function categorizedBody(section, sPath) {
    const withYear = !!section.showYear;
    const groups = section.groups.map((g, gi) => groupHtml(g, `${sPath}.groups.${gi}`, withYear)).join('');
    return `${groups}<button type="button" class="add-btn strong" data-action="add" data-path="${sPath}.groups" data-template="${withYear ? 'group-year' : 'group'}">+ Category</button>`;
  }

  /** "✓ 12  ▲ 2  ▼ 1" counts shown on each section header. */
  function sectionCounts(sIndex) {
    const counts = { brim: 0, under: 0, over: 0 };
    forEachBullet(getCv(), (bullet, path, capacityPt) => {
      if (!path.startsWith(`sections.${sIndex}.`)) return;
      const st = analyzeBullet(bullet.text, capacityPt).status;
      if (st in counts) counts[st]++;
    });
    return `<span class="st-brim" title="Perfect fit: fills its line">✓ ${counts.brim}</span>`
      + (counts.under ? `<span class="st-under" title="Too short: add a few words">▲ ${counts.under}</span>` : '')
      + (counts.over ? `<span class="st-over" title="Too long: goes onto a 2nd line">▼ ${counts.over}</span>` : '');
  }

  function sectionHtml(section, sIndex) {
    const sPath = `sections.${sIndex}`;
    let settings = field('Section title', `${sPath}.title`, section.title, { cls: 'grow' });
    let body = '';
    if (section.type === 'academic') {
      body = academicBody(section, sPath);
    } else if (section.type === 'experience') {
      settings += field('Right note', `${sPath}.note`, section.note, { placeholder: '12 Weeks' });
      body = experienceBody(section, sPath);
    } else {
      settings += `<label class="check"><input type="checkbox" data-bind="${sPath}.showYear" ${section.showYear ? 'checked' : ''}> Year column</label>`;
      body = categorizedBody(section, sPath);
    }
    const counts = section.type === 'academic' ? '' : `<span class="counts" data-counts="${sIndex}">${sectionCounts(sIndex)}</span>`;
    return `
      <details class="card${offClass(section)}" data-sec="${sIndex}" data-item="${sPath}" ${closed.has(section) ? '' : 'open'}>
        <summary>
          <span class="chev" aria-hidden="true"></span>
          ${includeBox(sPath, section, 'section')}
          <span class="sum-title">${esc(section.title) || 'Untitled'}</span>
          <span class="badge">${TYPE_NAMES[section.type]}</span>
          ${counts}
          <span class="row-actions">${moveRemove(sPath, 'section')}</span>
        </summary>
        <div class="card-body">
          <div class="settings">${settings}</div>
          ${body}
        </div>
      </details>`;
  }

  function personalHtml(cv) {
    const p = cv.personal;
    const logo = p.logo
      ? `<img src="${esc(p.logo)}" alt="Logo preview" class="logo-thumb">
         <button type="button" class="btn small" data-action="logo-remove">Remove</button>`
      : '<span class="muted">No logo</span>';
    return `
      <details class="card" data-sec="personal" ${closed.has(p) ? '' : 'open'}>
        <summary><span class="chev" aria-hidden="true"></span><span class="sum-title">Header</span><span class="badge">Name, headline, logo</span></summary>
        <div class="card-body">
          <div class="grid-3">
            ${field('Full name', 'personal.name', p.name)}
            ${field('Line 1', 'personal.line1', p.line1, { placeholder: 'Male, 25 years' })}
            ${field('Line 2', 'personal.line2', p.line2, { placeholder: 'MBA, Batch 25 - 27' })}
          </div>
          ${field('Headline bar', 'headline', cv.headline, { multiline: true, rows: 2, placeholder: 'Winner | Strategist | Builder' })}
          <div class="logo-row">
            <span class="field-label">Logo (top right)</span>
            ${logo}
            <label class="btn small">Upload<input type="file" accept="image/*" data-action="logo-upload" hidden></label>
          </div>
        </div>
      </details>`;
  }

  /** Footer: the link printed at the bottom of the page (usually LinkedIn). */
  let footerClosed = false;
  function footerHtml(cv) {
    return `
      <details class="card" data-sec="footer" ${footerClosed ? '' : 'open'}>
        <summary><span class="chev" aria-hidden="true"></span><span class="sum-title">Footer</span><span class="badge">LinkedIn link at the bottom</span></summary>
        <div class="card-body">
          ${field('Link', 'footer', cv.footer, { placeholder: 'www.linkedin.com/in/your-name' })}
          <p class="muted small-note">Printed in blue at the bottom centre and clickable in the PDF. Leave it empty to hide it.</p>
        </div>
      </details>`;
  }

  // ---------- build everything ----------
  function render(keepClosed) {
    const cv = getCv();
    // After undo/redo the CV objects are new: re-collapse cards by their titles.
    if (keepClosed) {
      cv.sections.forEach(sec => { if (keepClosed.includes(sec.title)) closed.add(sec); });
      if (keepClosed.includes('#personal')) closed.add(cv.personal);
      footerClosed = keepClosed.includes('#footer');
    }
    const scrollTop = root.scrollTop;
    root.innerHTML = personalHtml(cv)
      + cv.sections.map(sectionHtml).join('')
      + footerHtml(cv)
      + `<div class="add-section">
           <span>Add a section</span>
           <button type="button" class="btn small" data-action="add-section" data-template="experience">Experience</button>
           <button type="button" class="btn small" data-action="add-section" data-template="categorized">Category list</button>
           <button type="button" class="btn small" data-action="add-section" data-template="academic">Academic table</button>
         </div>`;
    root.querySelectorAll('.bl').forEach(box => refreshBullet(box.dataset.path));
    root.querySelectorAll('textarea').forEach(autoSize);
    root.scrollTop = scrollTop;
  }

  /** Grow a textarea to fit its text (no inner scrollbar). */
  function autoSize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  /** Put the cursor in a bullet, opening its section and scrolling to it. */
  function focusBullet(path, caretAtEnd = true) {
    const el = root.querySelector(`[data-bind="${path}.text"]`);
    if (!el) return;
    const card = el.closest('details');
    if (card && !card.open) card.open = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    if (caretAtEnd) el.setSelectionRange(el.value.length, el.value.length);
    const box = el.closest('.bl');
    box.classList.remove('flash');
    void box.offsetWidth; // restart the CSS animation
    box.classList.add('flash');
  }

  // ---------- structural edits ----------
  function makeBlank(template) {
    switch (template) {
      case 'bullet': return BLANKS.bullet(false);
      case 'bullet-year': return BLANKS.bullet(true);
      case 'group': return BLANKS.group('Category', false);
      case 'group-year': return BLANKS.group('Category', true);
      case 'entry': return BLANKS.entry();
      case 'row': return ['', '', '', ''];
      default: return null;
    }
  }

  /** Has the user typed anything inside this item? (used before deleting) */
  function hasContent(item) {
    return JSON.stringify(item).replace(/"[a-zA-Z]+":/g, '').replace(/[^A-Za-z0-9]/g, '').length > 30;
  }

  function moveItem(path, step) {
    const { parentPath, index } = splitPath(path);
    const list = getAt(getCv(), parentPath);
    const target = index + step;
    if (!Array.isArray(list) || target < 0 || target >= list.length) return false;
    [list[index], list[target]] = [list[target], list[index]];
    return true;
  }

  function removeItem(path) {
    const { parentPath, index } = splitPath(path);
    const list = getAt(getCv(), parentPath);
    if (!Array.isArray(list)) return false;
    const item = list[index];
    const isBig = !path.includes('.bullets.') && !path.includes('.rows.');
    if (isBig && hasContent(item) && !confirm('Remove this and everything inside it?')) return false;
    list.splice(index, 1);
    return true;
  }

  /** Wrap the selected words of a bullet in **…** (or unwrap if already bold). */
  function toggleBold(path) {
    toggleMark(path, '**', 'bold');
  }

  /** Wrap the selected words of a bullet in _…_ (or unwrap if already italic). */
  function toggleItalic(path) {
    toggleMark(path, '_', 'italicise');
  }

  /** Wrap the selected letters in ^…^ (superscript, like the "th" in 10^th^), or unwrap. */
  function toggleSup(path) {
    toggleMark(path, '^', 'superscript');
  }

  /** Shared by bold, italic and superscript: add or remove `mark` around the selection. */
  function toggleMark(path, mark, verb) {
    const el = root.querySelector(`[data-bind="${path}.text"]`);
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    if (a === b) {
      flashMessage(el, `Select the words to ${verb} first`);
      return;
    }
    const n = mark.length;
    const picked = value.slice(a, b);
    let next;
    if (picked.length > 2 * n && picked.startsWith(mark) && picked.endsWith(mark)) {
      next = value.slice(0, a) + picked.slice(n, -n) + value.slice(b);   // already marked → unmark
    } else if (value.slice(a - n, a) === mark && value.slice(b, b + n) === mark) {
      next = value.slice(0, a - n) + picked + value.slice(b + n);        // selection inside the marks → unmark
    } else {
      next = value.slice(0, a) + mark + picked.split(mark).join('') + mark + value.slice(b);
    }
    el.value = next;
    setAt(getCv(), path + '.text', next);
    afterTextChange(el, path + '.text', 'structure'); // bold/italic = its own undo step
    el.focus();
  }

  function flashMessage(el, text) {
    const box = el.closest('.bl');
    const msg = box && box.querySelector('.msg');
    if (msg) {
      const old = msg.textContent;
      msg.textContent = text;
      setTimeout(() => { if (msg.isConnected) msg.textContent = old; }, 1500);
    }
  }

  // ---------- event handlers ----------
  /**
   * Update the meter etc. after a field's text changed, and record it for undo.
   * kind 'text'  = ordinary typing (keystrokes within a second join one undo step)
   * kind 'structure' = bold, italic, a tweak chip or a paste: always its own undo step,
   *   so bold → unbold → ⌘Z brings the bold back.
   */
  function afterTextChange(el, bindPath, kind = 'text') {
    if (el.tagName === 'TEXTAREA') autoSize(el);
    if (el.dataset.kind === 'bullet') {
      refreshBullet(bindPath.replace(/\.text$/, ''));
      const sIndex = bindPath.split('.')[1];
      const counts = root.querySelector(`[data-counts="${sIndex}"]`);
      if (counts) counts.innerHTML = sectionCounts(Number(sIndex));
    }
    if (/^sections\.\d+\.title$/.test(bindPath)) {
      const card = el.closest('details');
      card.querySelector('.sum-title').textContent = el.value || 'Untitled';
    }
    onChange(kind);
  }

  function handleInput(event) {
    const el = event.target;
    const path = el.dataset.bind;
    if (!path) return;
    if (el.type === 'checkbox') return; // handled in 'change'
    setAt(getCv(), path, el.value);
    afterTextChange(el, path);
  }

  function handleChange(event) {
    const el = event.target;
    // ☑ Include tick mark: unticked → hidden: true (left off the CV, kept in the editor).
    if (el.dataset.include) {
      const item = getAt(getCv(), el.dataset.include);
      if (el.checked) delete item.hidden;
      else item.hidden = true;
      render();
      onChange('structure');
      return;
    }
    // Year-column checkbox: bullets change width and gain/lose a year box.
    if (el.type === 'checkbox' && el.dataset.bind) {
      setAt(getCv(), el.dataset.bind, el.checked);
      render();
      onChange('structure');
    }
    if (el.dataset.action === 'logo-upload' && el.files[0]) {
      readLogo(el.files[0]);
    }
  }

  /** Shrink the uploaded logo (max 600px wide) so it fits in browser storage. */
  function readLogo(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 600 / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        getCv().personal.logo = canvas.toDataURL('image/png');
        render();
        onChange('structure');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function handleClick(event) {
    const btn = event.target.closest('[data-action]');
    if (!btn || btn.tagName === 'INPUT') return;
    // Buttons inside <summary> must not also open/close the section.
    if (btn.closest('summary')) event.preventDefault();

    const cv = getCv();
    const { action, path, template } = btn.dataset;
    let changed = false;
    let focusAfter = null;

    if (action === 'drag') return; // dragging is handled by the pointer events below
    else if (action === 'remove') changed = removeItem(path);
    else if (action === 'add') {
      const list = getAt(cv, path);
      list.push(makeBlank(template));
      changed = true;
      if (template.startsWith('bullet')) focusAfter = `${path}.${list.length - 1}`;
    } else if (action === 'add-section') {
      cv.sections.push(BLANKS.section(template));
      changed = true;
    } else if (action === 'bold') {
      toggleBold(path);
    } else if (action === 'italic') {
      toggleItalic(path);
    } else if (action === 'sup') {
      toggleSup(path);
    } else if (action === 'tweak') {
      const text = getAt(cv, path + '.text');
      const tweak = TWEAKS[Number(btn.dataset.index)];
      const el = root.querySelector(`[data-bind="${path}.text"]`);
      el.value = text.replace(tweak.find, tweak.replace);
      setAt(cv, path + '.text', el.value);
      afterTextChange(el, path + '.text', 'structure'); // a tweak = its own undo step
    } else if (action === 'logo-remove') {
      cv.personal.logo = '';
      changed = true;
    }

    if (changed) {
      render();
      onChange('structure');
      if (focusAfter) focusBullet(focusAfter);
      if (action === 'add-section') root.lastElementChild.previousElementSibling.scrollIntoView({ behavior: 'smooth' });
    }
  }

  /** Keyboard shortcuts inside a bullet (and ↑ / ↓ on a focused drag handle). */
  function handleKeydown(event) {
    const el = event.target;
    if (el.classList && el.classList.contains('drag-handle') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const step = event.key === 'ArrowUp' ? -1 : 1;
      if (moveItem(el.dataset.path, step)) {
        const { parentPath, index } = splitPath(el.dataset.path);
        render();
        onChange('structure');
        const moved = root.querySelector(`.drag-handle[data-path="${parentPath}.${index + step}"]`);
        if (moved) moved.focus();
      }
      return;
    }
    if (el.dataset.kind !== 'bullet') return;
    const bulletPath = el.dataset.bind.replace(/\.text$/, '');

    // Ctrl/⌘ + B → bold,  Ctrl/⌘ + I → italic
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleBold(bulletPath);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      toggleItalic(bulletPath);
      return;
    }
    // Ctrl/⌘ + . → superscript (same shortcut as Google Docs)
    if ((event.metaKey || event.ctrlKey) && event.key === '.') {
      event.preventDefault();
      toggleSup(bulletPath);
      return;
    }
    // Enter → new bullet just below (a CV bullet never contains a line break)
    if (event.key === 'Enter') {
      event.preventDefault();
      const { parentPath, index } = splitPath(bulletPath);
      const list = getAt(getCv(), parentPath);
      const withYear = 'year' in list[index];
      list.splice(index + 1, 0, { ...BLANKS.bullet(withYear), ...(withYear ? { year: list[index].year } : {}) });
      render();
      onChange('structure');
      focusBullet(`${parentPath}.${index + 1}`);
      return;
    }
    // Backspace in an empty bullet → delete it and jump to the one above
    if (event.key === 'Backspace' && el.value === '') {
      const { parentPath, index } = splitPath(bulletPath);
      const list = getAt(getCv(), parentPath);
      if (list.length > 1) {
        event.preventDefault();
        list.splice(index, 1);
        render();
        onChange('structure');
        focusBullet(`${parentPath}.${Math.max(0, index - 1)}`);
      }
    }
  }

  function handleToggle(event) {
    const card = event.target;
    if (!card.matches || !card.matches('details.card')) return;
    const key = card.dataset.sec;
    if (key === 'footer') { footerClosed = !card.open; return; }
    const obj = key === 'personal' ? getCv().personal : getCv().sections[Number(key)];
    if (!obj) return;
    if (card.open) closed.delete(obj); else closed.add(obj);
  }

  // ---------- paste with bold / italic (Google Docs, Sheets, Word, web pages) ----------
  // Copied text arrives with its formatting as HTML. We keep ONLY bold and italic
  // and superscript (no fonts, sizes or colours) and turn them into **bold** / _italic_ / ^sup^ marks.
  // Several pasted lines (paragraphs, list items, sheet rows) become several bullets.

  /** HTML from the clipboard → lines, each a list of {text, bold, italic, sup} pieces. */
  function htmlToLines(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const lines = [[]];
    const newLine = () => { if (lines[lines.length - 1].length) lines.push([]); };
    const BLOCK = /^(P|DIV|LI|TR|H[1-6]|BLOCKQUOTE|PRE|UL|OL|TABLE|TBODY|SECTION|ARTICLE)$/;

    function walk(node, bold, italic, sup = false) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.replace(/[\s\u00a0]+/g, ' ');
        if (text.trim() || text === ' ') lines[lines.length - 1].push({ text, bold, italic, sup });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (/^(STYLE|SCRIPT|META|TITLE|HEAD)$/.test(tag)) return;
      if (tag === 'BR') { newLine(); return; }
      // Tags first (<b>, <strong>, <i>, <em>), then inline styles, which win.
      // (Google Docs wraps everything in <b style="font-weight:normal">, so styles must win.)
      if (/^(B|STRONG|TH|H[1-6])$/.test(tag)) bold = true;
      if (/^(I|EM|CITE)$/.test(tag)) italic = true;
      if (tag === 'SUP') sup = true;
      const st = node.style || {};
      if (st.fontWeight) bold = st.fontWeight === 'bold' || st.fontWeight === 'bolder' || Number(st.fontWeight) >= 600;
      if (st.fontStyle) italic = /italic|oblique/.test(st.fontStyle);
      if (st.verticalAlign) sup = st.verticalAlign === 'super';   // Google Docs: <span style="vertical-align:super">
      const block = BLOCK.test(tag);
      if (block) newLine();
      node.childNodes.forEach(child => walk(child, bold, italic, sup));
      if (tag === 'TD' || tag === 'TH') lines[lines.length - 1].push({ text: ' ', bold: false, italic: false }); // cells in a row: space apart
      if (block) newLine();
    }
    walk(doc.body, false, false);
    return lines.map(pieces => piecesToMarkup(pieces)).filter(Boolean);
  }

  /** Remove a typed bullet sign at the start of a pasted line ("• ", "- ", "▪ " …). */
  function stripBulletSign(text) {
    return text.replace(/^((?:\*\*|_)*)\s*[•▪■●◦‣∙·▸►➢✓✔–\-*]\s+/, '$1');
  }

  function handlePaste(event) {
    const el = event.target;
    if (el.dataset?.kind !== 'bullet') return; // other fields: normal plain paste
    const data = event.clipboardData;
    if (!data) return;
    const html = data.getData('text/html');
    const plain = data.getData('text/plain');
    let lines = html ? htmlToLines(html) : plain.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines = lines.map(stripBulletSign).filter(l => stripBold(l).trim());
    if (!lines.length) return;
    event.preventDefault();

    const bulletPath = el.dataset.bind.replace(/\.text$/, '');
    // First line goes where the cursor is (replacing any selected text).
    const { selectionStart: a, selectionEnd: b } = el;
    const before = el.value.slice(0, a);
    const glue = before && !/\s$/.test(before) && a === el.value.length ? ' ' : '';
    el.setRangeText(glue + lines[0], a, b, 'end');
    setAt(getCv(), el.dataset.bind, el.value);

    if (lines.length === 1) {
      afterTextChange(el, el.dataset.bind, 'structure'); // a paste is its own undo step
      return;
    }
    // More lines: each becomes a new bullet just below this one.
    const { parentPath, index } = splitPath(bulletPath);
    const list = getAt(getCv(), parentPath);
    const withYear = 'year' in list[index];
    const extra = lines.slice(1).map(text => (withYear ? { text, year: '' } : { text }));
    list.splice(index + 1, 0, ...extra);
    render();
    onChange('structure');
    focusBullet(`${parentPath}.${index + extra.length}`);
  }

  // ---------- drag and drop ----------
  // Uses pointer events (mouse, trackpad and touch all work).
  // 1. Press the ⠿ handle → remember the item and its siblings in the same list.
  // 2. Move → a blue line shows where the item would land.
  // 3. Release → move the item in the CV data and redraw. Esc cancels.
  let drag = null;

  function startDrag(event) {
    const handle = event.target.closest('.drag-handle');
    if (!handle || event.button > 0) return;
    event.preventDefault(); // stop text selection and the <summary> toggle

    const path = handle.dataset.path;
    const { parentPath, index } = splitPath(path);
    const item = root.querySelector(`[data-item="${path}"]`);
    // Siblings = items in the SAME list (nested items have a different parent path).
    const siblings = [...root.querySelectorAll('[data-item]')]
      .filter(el => splitPath(el.dataset.item).parentPath === parentPath);
    if (!item || siblings.length < 2) return;

    const line = document.createElement('div');
    line.className = 'drop-line';
    document.body.appendChild(line);
    item.classList.add('dragging');
    document.body.classList.add('is-dragging');
    handle.setPointerCapture(event.pointerId);

    drag = { handle, item, siblings, parentPath, index, target: index, line, y: event.clientY, timer: null };
    // While the pointer sits near the top/bottom edge, keep scrolling.
    drag.timer = setInterval(autoScroll, 16);
    updateDrop(event.clientY);

    handle.addEventListener('pointermove', onDragMove);
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('keydown', onDragKey);
  }

  function onDragMove(event) {
    if (!drag) return;
    drag.y = event.clientY;
    updateDrop(event.clientY);
  }

  /** Work out the drop position (0…n) from the pointer's height and draw the blue line there. */
  function updateDrop(y) {
    const { siblings, line, item } = drag;
    let target = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      const r = siblings[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { target = i; break; }
    }
    drag.target = target;
    const ref = target < siblings.length ? siblings[target].getBoundingClientRect() : siblings[siblings.length - 1].getBoundingClientRect();
    const lineY = target < siblings.length ? ref.top - 3 : ref.bottom + 1;
    const box = item.getBoundingClientRect();
    line.style.top = `${lineY}px`;
    line.style.left = `${box.left}px`;
    line.style.width = `${box.width}px`;
  }

  /** Scroll the editor (or the window on small screens) when dragging near its edges. */
  function autoScroll() {
    if (!drag) return;
    const scroller = root.scrollHeight > root.clientHeight + 1 && getComputedStyle(root).overflowY !== 'visible' ? root : null;
    const top = scroller ? scroller.getBoundingClientRect().top : 0;
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    const edge = 50;
    let dy = 0;
    if (drag.y < top + edge) dy = -Math.ceil((top + edge - drag.y) / 4);
    else if (drag.y > bottom - edge) dy = Math.ceil((drag.y - (bottom - edge)) / 4);
    if (!dy) return;
    if (scroller) scroller.scrollTop += dy; else window.scrollBy(0, dy);
    updateDrop(drag.y);
  }

  function onDragKey(event) {
    if (event.key === 'Escape') cancelDrag();
  }

  function stopDragging() {
    const d = drag;
    drag = null;
    clearInterval(d.timer);
    d.line.remove();
    d.item.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    d.handle.removeEventListener('pointermove', onDragMove);
    d.handle.removeEventListener('pointerup', endDrag);
    d.handle.removeEventListener('pointercancel', cancelDrag);
    window.removeEventListener('keydown', onDragKey);
    return d;
  }

  function cancelDrag() {
    if (drag) stopDragging();
  }

  function endDrag() {
    if (!drag) return;
    const { parentPath, index, target } = stopDragging();
    // Dropping below its own old spot: the list shrinks by one first, so shift back by one.
    const newIndex = target > index ? target - 1 : target;
    if (newIndex === index) return;
    const list = getAt(getCv(), parentPath);
    const [moved] = list.splice(index, 1);
    list.splice(newIndex, 0, moved);
    render();
    onChange('structure');
    const el = root.querySelector(`[data-item="${parentPath}.${newIndex}"]`);
    if (el) { el.classList.add('flash'); }
  }

  function mount(rootEl, cvGetter, changeCallback) {
    root = rootEl;
    getCv = cvGetter;
    onChange = changeCallback;
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('click', handleClick);
    root.addEventListener('keydown', handleKeydown);
    root.addEventListener('pointerdown', startDrag);
    root.addEventListener('paste', handlePaste);
    root.addEventListener('toggle', handleToggle, true); // 'toggle' doesn't bubble, so capture it
    render();
  }

  /** Titles of the collapsed cards, so undo/redo can keep them collapsed. */
  function closedTitles() {
    return [...root.querySelectorAll('details.card:not([open])')].map(d => d.dataset.sec === 'personal' || d.dataset.sec === 'footer'
      ? `#${d.dataset.sec}` : (getCv().sections[Number(d.dataset.sec)] || {}).title);
  }

  return { mount, render, focusBullet, closedTitles };
})();

/**
 * Visit every bullet in the CV.
 * callback(bullet, path, capacityPt) — used for the stats and section counts.
 */
function forEachBullet(cv, callback) {
  // Unticked (excluded) items aren't printed, so they're skipped here too:
  // the fit score and section counts only describe what's on the CV.
  cv.sections.forEach((section, s) => {
    if (!isIncluded(section)) return;
    if (section.type === 'experience') {
      section.entries.forEach((entry, e) => isIncluded(entry) && entry.groups.forEach((group, g) => isIncluded(group) && group.bullets.forEach((bullet, b) =>
        isIncluded(bullet) && callback(bullet, `sections.${s}.entries.${e}.groups.${g}.bullets.${b}`, bulletCapacityPt(true, false)))));
    } else if (section.type === 'categorized') {
      section.groups.forEach((group, g) => isIncluded(group) && group.bullets.forEach((bullet, b) =>
        isIncluded(bullet) && callback(bullet, `sections.${s}.groups.${g}.bullets.${b}`, bulletCapacityPt(true, !!section.showYear))));
    }
  });
}
