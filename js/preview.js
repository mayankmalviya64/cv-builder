/* =====================================================================
   preview.js — draws the A4 CV from the data object
   ---------------------------------------------------------------------
   renderCvHtml(cv) returns one big HTML string for the page.
   Sizes are in pt so the screen preview and the printed PDF match.

   Every bullet gets data-path="sections.3.groups.0.bullets.2" so that
   clicking it in the preview can jump to the same bullet in the editor.
   Every piece of text also gets data-src="<editor path>" (src() below), so
   when you click into a box in the editor, app.js can highlight the same
   line here in the preview.
   ===================================================================== */

/** Make user text safe to put inside HTML (stops "<" breaking the page). */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Make ₹ as wide as Skynet prints it. Skynet's EB Garamond has no ₹, so it
 * borrows the (wider) DejaVu Sans one; the .cv-rs box copies that width.
 */
function rupeeHtml(html) {
  return html.replace(/₹/g, '<span class="cv-rs">₹</span>');
}

/** Bullet text → HTML: **bold** → <b>, _italic_ → <i>, ^superscript^ → <sup>. */
function richText(text) {
  return parseBold(normalizeSpaces(text))
    .map(p => {
      let html = rupeeHtml(escapeHtml(p.text));
      if (p.sup) html = `<sup>${html}</sup>`;
      if (p.italic) html = `<i>${html}</i>`;
      if (p.bold) html = `<b>${html}</b>`;
      return html;
    })
    .join('');
}

/** data-src attribute: which editor box (data-bind path) this text comes from. */
function src(path) {
  return ` data-src="${path}"`;
}

/** Category labels may contain line breaks ("Roles &\nResponsibilities"). */
function labelHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/** One bullet row: ■ marker + text box exactly as wide as the line capacity. */
function bulletHtml(bullet, path, capacityPt, showYear) {
  const check = analyzeBullet(bullet.text, capacityPt);
  const year = showYear ? `<div class="cv-year"${src(path + '.year')}>${escapeHtml(bullet.year)}</div>` : '';
  // If the meter says it fits on one line, forbid wrapping so tiny screen
  // rounding can never push the last word down (Skynet wouldn't either).
  const fitClass = check.lines <= 1 ? ' fit' : '';
  return `
    <div class="cv-row">
      <div class="cv-bullet st-${check.status}" data-path="${path}"${src(path)} title="${escapeHtml(check.message)} (${check.fill.toFixed(1)}%)">
        <span class="cv-mark">■</span><span class="cv-text${fitClass}" style="width:${capacityPt}pt">${richText(bullet.text)}</span>
      </div>${year}
    </div>`;
}

/* ---- Print-only table lines (why they exist) ----
   A CSS border prints into the PDF as a thin FILLED rectangle (0.75pt).
   PDF viewers on ordinary (non-Retina) screens — Windows Chrome/Edge/Acrobat,
   Android — may blur such a thin fill into the grey cells or drop it
   completely until you zoom in. Skynet's PDFs draw their lines as STROKES
   instead, and viewers always show a stroke at least 1 screen pixel wide.
   Browsers only print SVG lines as strokes, so each border also gets a tiny
   SVG line laid exactly on top of it. They are hidden on screen and shown
   only when printing (css/cv.css, "Print-only lines"), and they are absolutely
   positioned, so the layout and the "fits on one page" check never change. */

/** One print-only line. `where` = top | bottom | left | right | cat | year (see .cv-ln-* in cv.css). */
function printLine(where) {
  const vertical = where !== 'top' && where !== 'bottom';
  // The line runs through the middle of its 0.75pt strip; stroke-width 1 (px) = 0.75pt.
  const ends = vertical ? 'x1="50%" y1="0" x2="50%" y2="100%"' : 'x1="0" y1="50%" x2="100%" y2="50%"';
  return `<svg class="cv-ln cv-ln-${where}" aria-hidden="true"><line ${ends} stroke="#000" stroke-width="1"/></svg>`;
}

/** The box's outer left + right lines and the line under a block. */
function blockLines() {
  return printLine('left') + printLine('right') + printLine('bottom');
}

/**
 * All lines of the academic table, in one SVG measured in pt (viewBox units = pt).
 * Every row is 12pt apart (11.25pt cell + 0.75pt line); the column lines sit on
 * the column edges set in academicHtml's <colgroup> (209 / 456.5 / 506pt).
 */
function academicLines(rowCount) {
  const height = rowCount * 12;
  const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  let lines = '';
  for (let r = 1; r <= rowCount; r++) lines += line(-0.75, r * 12 - 0.375, 550.75, r * 12 - 0.375); // under each row
  for (const x of [-0.375, 209, 456.5, 506, 550.375]) lines += line(x, 0, x, height);                  // box sides + column lines
  return `<svg class="cv-ln cv-ln-table" aria-hidden="true" style="height:${height}pt" viewBox="-0.75 0 551.5 ${height}">`
    + `<g stroke="#000" stroke-width="0.75">${lines}</g></svg>`;
}

/** A category block: label on the left, its bullets on the right. */
function groupHtml(group, path, showYear) {
  // Unticked category, or every bullet in it unticked → leave the whole block out.
  if (!isIncluded(group)) return '';
  if (group.bullets.length && !group.bullets.some(isIncluded)) return '';
  const capacityPt = bulletCapacityPt(true, showYear);
  const rows = group.bullets
    .map((b, i) => (isIncluded(b) ? bulletHtml(b, `${path}.bullets.${i}`, capacityPt, showYear) : '')) // skip unticked bullets
    .join('');
  return `
    <div class="cv-group${showYear ? ' has-year' : ''}">
      <div class="cv-cat"${src(path + '.label')}><span>${labelHtml(group.label)}</span></div>
      <div class="cv-rows">${rows}</div>
      ${blockLines()}${printLine('cat')}${showYear ? printLine('year') : ''}
    </div>`;
}

function academicHtml(section, sIndex) {
  const sPath = `sections.${sIndex}`;
  const head = section.columns.map((c, i) => `<th${src(`${sPath}.columns.${i}`)}>${escapeHtml(c)}</th>`).join('');
  const body = section.rows
    .map((row, r) => `<tr>${row.map((cell, c) => `<td${src(`${sPath}.rows.${r}.${c}`)}>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `
    <div class="cv-acad-wrap">
    <table class="cv-acad">
      <colgroup><col style="width:209pt"><col style="width:247.5pt"><col style="width:49.5pt"><col style="width:44pt"></colgroup>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${academicLines(section.rows.length + 1)}
    </div>`;
}

function experienceHtml(section, sIndex) {
  return section.entries.map((entry, eIndex) => {
    if (!isIncluded(entry)) return ''; // unticked entry → not on the CV
    const path = `sections.${sIndex}.entries.${eIndex}`;
    // The "Company | Role | Dates" line only appears if something is filled in.
    // No role? Then the company name may use the role's space too (Skynet does
    // this: a long name like "…Kakrapar - Gujarat Site" stays on one line).
    const orgRole = entry.role
      ? `<span${src(path + '.org')}>${escapeHtml(entry.org)}</span><span${src(path + '.role')}>${escapeHtml(entry.role)}</span>`
      : `<span class="span-role"${src(path + '.org')}>${escapeHtml(entry.org)}</span>`;
    const headLine = (entry.org || entry.role || entry.dates)
      ? `<div class="cv-entry-head">${orgRole}<span class="right"${src(path + '.dates')}>${escapeHtml(entry.dates)}</span></div>`
      : '';
    const titleLine = (entry.subtitle || entry.duration)
      ? `<div class="cv-entry-title"><span${src(path + '.subtitle')}>${escapeHtml(entry.subtitle)}</span><span class="right"${src(path + '.duration')}>${escapeHtml(entry.duration)}</span></div>`
      : '';
    const groups = entry.groups.map((g, gIndex) => groupHtml(g, `${path}.groups.${gIndex}`, false)).join('');
    // The two bold lines share one block with a line under it, like Skynet.
    const lines = headLine || titleLine ? `<div class="cv-entry-lines">${headLine}${titleLine}${blockLines()}</div>` : '';
    return `<div class="cv-entry">${lines}${groups}</div>`;
  }).join('');
}

function categorizedHtml(section, sIndex) {
  return section.groups
    .map((g, gIndex) => groupHtml(g, `sections.${sIndex}.groups.${gIndex}`, !!section.showYear))
    .join('');
}

/** The whole page. */
function renderCvHtml(cv) {
  const p = cv.personal || {};
  const logo = p.logo ? `<img class="cv-logo" src="${escapeHtml(p.logo)}" alt="">` : '';

  const sections = cv.sections.map((section, sIndex) => {
    if (!isIncluded(section)) return ''; // unticked section → not on the CV
    let body = '';
    if (section.type === 'academic') body = academicHtml(section, sIndex);
    else if (section.type === 'experience') body = experienceHtml(section, sIndex);
    else body = categorizedHtml(section, sIndex);
    const note = section.note ? `<span class="note"${src(`sections.${sIndex}.note`)}>${escapeHtml(section.note)}</span>` : '';
    return `
      <section class="cv-sec">
        <div class="cv-sec-title${section.note ? ' has-note' : ''}"><span${src(`sections.${sIndex}.title`)}>${escapeHtml(section.title)}</span>${note}${printLine('top')}${blockLines()}</div>
        ${body}
      </section>`;
  }).join('');

  const footer = cv.footer
    ? `<div class="cv-footer"${src('footer')}><a href="https://${escapeHtml(cv.footer.replace(/^https?:\/\//, ''))}">${escapeHtml(cv.footer)}</a></div>`
    : '';

  return `
    <header class="cv-header">
      <div>
        <div class="cv-name"${src('personal.name')}>${escapeHtml(p.name)}</div>
        <div class="cv-sub"${src('personal.line1')}>${escapeHtml(p.line1)}</div>
        <div class="cv-sub"${src('personal.line2')}>${escapeHtml(p.line2)}</div>
      </div>
      ${logo}
    </header>
    ${cv.headline ? `<div class="cv-headline"${src('headline')}>${escapeHtml(cv.headline)}</div>` : ''}
    ${sections}
    ${footer}`;
}
