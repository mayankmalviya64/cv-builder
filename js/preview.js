/* =====================================================================
   preview.js — draws the A4 CV from the data object
   ---------------------------------------------------------------------
   renderCvHtml(cv) returns one big HTML string for the page.
   Sizes are in pt so the screen preview and the printed PDF match.

   Every bullet gets data-path="sections.3.groups.0.bullets.2" so that
   clicking it in the preview can jump to the same bullet in the editor.
   ===================================================================== */

/** Make user text safe to put inside HTML (stops "<" breaking the page). */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Bullet text → HTML, turning **bold** into <b>bold</b>. */
function richText(text) {
  return parseBold(normalizeSpaces(text))
    .map(p => (p.bold ? `<b>${escapeHtml(p.text)}</b>` : escapeHtml(p.text)))
    .join('');
}

/** Category labels may contain line breaks ("Roles &\nResponsibilities"). */
function labelHtml(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/** One bullet row: ▪ marker + text box exactly as wide as the line capacity. */
function bulletHtml(bullet, path, capacityPt, showYear) {
  const check = analyzeBullet(bullet.text, capacityPt);
  const year = showYear ? `<div class="cv-year">${escapeHtml(bullet.year)}</div>` : '';
  return `
    <div class="cv-row">
      <div class="cv-bullet st-${check.status}" data-path="${path}" title="${escapeHtml(check.message)} (${check.fill.toFixed(1)}%)">
        <span class="cv-mark">▪</span><span class="cv-text" style="width:${capacityPt}pt">${richText(bullet.text)}</span>
      </div>${year}
    </div>`;
}

/** A category block: label on the left, its bullets on the right. */
function groupHtml(group, path, showYear) {
  const capacityPt = bulletCapacityPt(true, showYear);
  const rows = group.bullets
    .map((b, i) => bulletHtml(b, `${path}.bullets.${i}`, capacityPt, showYear))
    .join('');
  return `
    <div class="cv-group${showYear ? ' has-year' : ''}">
      <div class="cv-cat">${labelHtml(group.label)}</div>
      <div class="cv-rows">${rows}</div>
    </div>`;
}

function academicHtml(section) {
  const head = section.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const body = section.rows
    .map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('');
  return `
    <table class="cv-acad">
      <colgroup><col style="width:172pt"><col style="width:280pt"><col style="width:44pt"><col style="width:44pt"></colgroup>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function experienceHtml(section, sIndex) {
  return section.entries.map((entry, eIndex) => {
    const path = `sections.${sIndex}.entries.${eIndex}`;
    // The "Company | Role | Dates" line only appears if something is filled in.
    const headLine = (entry.org || entry.role || entry.dates)
      ? `<div class="cv-entry-head"><span>${escapeHtml(entry.org)}</span><span>${escapeHtml(entry.role)}</span><span class="right">${escapeHtml(entry.dates)}</span></div>`
      : '';
    const titleLine = (entry.subtitle || entry.duration)
      ? `<div class="cv-entry-title"><span>${escapeHtml(entry.subtitle)}</span><span class="right">${escapeHtml(entry.duration)}</span></div>`
      : '';
    const groups = entry.groups.map((g, gIndex) => groupHtml(g, `${path}.groups.${gIndex}`, false)).join('');
    return `<div class="cv-entry">${headLine}${titleLine}${groups}</div>`;
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
    let body = '';
    if (section.type === 'academic') body = academicHtml(section);
    else if (section.type === 'experience') body = experienceHtml(section, sIndex);
    else body = categorizedHtml(section, sIndex);
    const note = section.note ? `<span>${escapeHtml(section.note)}</span>` : '';
    return `
      <section class="cv-sec">
        <div class="cv-sec-title"><span>${escapeHtml(section.title)}</span>${note}</div>
        ${body}
      </section>`;
  }).join('');

  const footer = cv.footer
    ? `<div class="cv-footer"><a href="https://${escapeHtml(cv.footer.replace(/^https?:\/\//, ''))}">${escapeHtml(cv.footer)}</a></div>`
    : '';

  return `
    <header class="cv-header">
      <div>
        <div class="cv-name">${escapeHtml(p.name)}</div>
        <div class="cv-sub">${escapeHtml(p.line1)}</div>
        <div class="cv-sub">${escapeHtml(p.line2)}</div>
      </div>
      ${logo}
    </header>
    ${cv.headline ? `<div class="cv-headline">${escapeHtml(cv.headline)}</div>` : ''}
    ${sections}
    ${footer}`;
}
