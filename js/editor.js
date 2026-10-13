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

  /** ↑ ↓ ✕ buttons for any item inside a list. */
  function moveRemove(path, what) {
    return iconBtn('move-up', path, '↑', `Move ${what} up`)
      + iconBtn('move-down', path, '↓', `Move ${what} down`)
      + iconBtn('remove', path, '✕', `Remove ${what}`, 'data-danger');
  }

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
      <div class="bl" data-path="${path}">
        <div class="bl-row">
          <span class="bl-mark">▪</span>
          <textarea class="bl-text" data-bind="${path}.text" data-kind="bullet" rows="1" spellcheck="true"
            placeholder="Action verb + what you did + measurable result">${esc(bullet.text)}</textarea>
          ${year}
          <div class="bl-actions">
            ${iconBtn('bold', path, '<b>B</b>', 'Bold the selected words (Ctrl/⌘+B)')}
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
      <div class="group">
        <div class="group-head">
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
      <div class="acad-row">
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
        <div class="entry">
          <div class="entry-head">
            <strong>Entry ${e + 1}</strong>
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
    return `<span class="st-brim" title="At the brim">✓ ${counts.brim}</span>`
      + (counts.under ? `<span class="st-under" title="Underfilled">▲ ${counts.under}</span>` : '')
      + (counts.over ? `<span class="st-over" title="Spills over">▼ ${counts.over}</span>` : '');
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
      <details class="card" data-sec="${sIndex}" ${closed.has(section) ? '' : 'open'}>
        <summary>
          <span class="chev" aria-hidden="true"></span>
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
          ${field('Footer link', 'footer', cv.footer, { placeholder: 'www.linkedin.com/in/you' })}
          <div class="logo-row">
            <span class="field-label">Logo (top right)</span>
            ${logo}
            <label class="btn small">Upload<input type="file" accept="image/*" data-action="logo-upload" hidden></label>
          </div>
        </div>
      </details>`;
  }

  // ---------- build everything ----------
  function render() {
    const cv = getCv();
    const scrollTop = root.scrollTop;
    root.innerHTML = personalHtml(cv)
      + cv.sections.map(sectionHtml).join('')
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
    const el = root.querySelector(`[data-bind="${path}.text"]`);
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    if (a === b) {
      flashMessage(el, 'Select the words to bold first');
      return;
    }
    const picked = value.slice(a, b);
    let next;
    if (/^\*\*.*\*\*$/.test(picked)) {
      next = value.slice(0, a) + picked.slice(2, -2) + value.slice(b);   // already bold → unbold
    } else if (value.slice(a - 2, a) === '**' && value.slice(b, b + 2) === '**') {
      next = value.slice(0, a - 2) + picked + value.slice(b + 2);        // selection inside ** ** → unbold
    } else {
      next = value.slice(0, a) + '**' + picked.replace(/\*\*/g, '') + '**' + value.slice(b);
    }
    el.value = next;
    setAt(getCv(), path + '.text', next);
    afterTextChange(el, path + '.text');
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
  function afterTextChange(el, bindPath) {
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
    onChange('text');
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

    if (action === 'move-up') changed = moveItem(path, -1);
    else if (action === 'move-down') changed = moveItem(path, +1);
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
    } else if (action === 'tweak') {
      const text = getAt(cv, path + '.text');
      const tweak = TWEAKS[Number(btn.dataset.index)];
      const el = root.querySelector(`[data-bind="${path}.text"]`);
      el.value = text.replace(tweak.find, tweak.replace);
      setAt(cv, path + '.text', el.value);
      afterTextChange(el, path + '.text');
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

  /** Keyboard shortcuts inside a bullet. */
  function handleKeydown(event) {
    const el = event.target;
    if (el.dataset.kind !== 'bullet') return;
    const bulletPath = el.dataset.bind.replace(/\.text$/, '');

    // Ctrl/⌘ + B → bold
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleBold(bulletPath);
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
    const obj = key === 'personal' ? getCv().personal : getCv().sections[Number(key)];
    if (!obj) return;
    if (card.open) closed.delete(obj); else closed.add(obj);
  }

  function mount(rootEl, cvGetter, changeCallback) {
    root = rootEl;
    getCv = cvGetter;
    onChange = changeCallback;
    root.addEventListener('input', handleInput);
    root.addEventListener('change', handleChange);
    root.addEventListener('click', handleClick);
    root.addEventListener('keydown', handleKeydown);
    root.addEventListener('toggle', handleToggle, true); // 'toggle' doesn't bubble, so capture it
    render();
  }

  return { mount, render, focusBullet };
})();

/**
 * Visit every bullet in the CV.
 * callback(bullet, path, capacityPt) — used for the stats and section counts.
 */
function forEachBullet(cv, callback) {
  cv.sections.forEach((section, s) => {
    if (section.type === 'experience') {
      section.entries.forEach((entry, e) => entry.groups.forEach((group, g) => group.bullets.forEach((bullet, b) =>
        callback(bullet, `sections.${s}.entries.${e}.groups.${g}.bullets.${b}`, bulletCapacityPt(true, false)))));
    } else if (section.type === 'categorized') {
      section.groups.forEach((group, g) => group.bullets.forEach((bullet, b) =>
        callback(bullet, `sections.${s}.groups.${g}.bullets.${b}`, bulletCapacityPt(true, !!section.showYear))));
    }
  });
}
