// ---------- Google Analytics 4 ----------
// Counts visits (page views are automatic) plus a few button events:
//   download_pdf      – someone opened the print dialog to save the PDF
//   export_json       – someone saved their CV as .json
//   cv_import         – an import worked (with file type + section/bullet counts)
//   cv_import_failed  – an import showed an error
//   section_time      – active seconds spent editing one section (see the bottom of this file)
//   active_time       – active seconds in the whole visit, plus when the tab was opened
//   wording_tweak     – someone applied one of the suggested wording chips
//   js_error          – something in the site's code broke (message + file:line)
// download_pdf also carries the fit score (perfect / too short / too long counts)
// and the active seconds since the last import ("how long did the CV take?").
// GA stores the date and time of every event on its own. We also send
// `local_time` (the visitor's own clock) so you can see the exact minute.
//
// Privacy: we never send CV text or file names (those usually contain names),
// only counts and the file type.

// Your GA4 "Measurement ID" (Admin → Data streams → your web stream). Starts with G-.
const GA_MEASUREMENT_ID = 'G-RXHE3B22RP';

// Only track the live site, so local testing doesn't add fake visits.
const ANALYTICS_ON = /\.github\.io$/.test(location.hostname) && !GA_MEASUREMENT_ID.includes('XXXX');

// gtag() puts commands in a queue; Google's script reads that queue once it loads.
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }

if (ANALYTICS_ON) {
  const script = document.createElement('script');
  script.async = true; // don't slow the page down while it downloads
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
  document.head.appendChild(script);
  gtag('js', new Date());
  // Always report the title as "CV Builder". While the print dialog is open the
  // tab title becomes e.g. "Mayank's CV" (to name the PDF), and that name must never reach GA.
  gtag('config', GA_MEASUREMENT_ID, { page_title: 'CV Builder' });
}

/** Send one event to GA. It does nothing when analytics is off, and it can never break the app. */
function track(eventName, params = {}) {
  if (!ANALYTICS_ON) return;
  try {
    gtag('event', eventName, { ...params, page_title: 'CV Builder', local_time: new Date().toString() });
  } catch (err) {
    // Blocked by an ad-blocker or similar: just skip it.
  }
}

// ---------- JavaScript errors ----------
// If the site's code breaks for someone, we hear about it. This file loads
// first, so it also catches errors from the scripts after it. At most 5 per
// visit, so one error repeating in a loop can't flood GA.
let errorsSent = 0;
function trackError(message, where) {
  if (errorsSent >= 5) return;
  errorsSent++;
  track('js_error', { error: String(message || 'Unknown error').slice(0, 100), error_source: where || 'unknown' });
}
window.addEventListener('error', event => {
  // Only the file name and line, e.g. "app.js:120" (not the full web address).
  const file = (event.filename || '').split('/').pop().split('?')[0];
  trackError(event.message, file ? `${file}:${event.lineno}` : '');
});
// Errors inside async code (a failed Promise nobody caught).
window.addEventListener('unhandledrejection', event => {
  trackError(event.reason && event.reason.message || event.reason, 'promise');
});

// ---------- Time spent per section ----------
// A stopwatch for each editor card (Header, Academics, Work experience, …).
// A second only counts when the tab is open AND the person typed, clicked or
// scrolled in the last 30 seconds, so a forgotten tab doesn't pile up hours.
// When they leave or switch tabs, we send one `section_time` event per section.

const IDLE_AFTER_MS = 30 * 1000;
const sectionSeconds = {};   // e.g. { 'Work experience': 95, 'Header': 12 }
let currentSection = null;   // the card the person is working in right now
let lastActivity = Date.now(); // when they last typed / clicked / scrolled / moved the mouse
let activeSeconds = 0;         // active time in this visit that we haven't sent yet
let activeSinceImport = null;  // active seconds since the last import (null = no import in this tab yet)

/** app.js calls this after a successful import: restart the "time to make the CV" stopwatch. */
function markImport() { activeSinceImport = 0; }
const OPENED_AT = new Date().toString(); // when this tab was opened

// Section titles are typed by the user, so we never send them as they are.
// We map them to a fixed name; anything we don't recognise becomes 'Other section'.
const SECTION_NAMES = [
  [/academic|education|qualification|scholastic/i, 'Academics'],
  [/intern|experience|employ|work/i, 'Work experience'],
  [/project/i, 'Projects'],
  [/position|responsibilit|leadership/i, 'Positions of responsibility'],
  [/extra|co-?curricular|hobb|interest|social|volunt/i, 'Extracurricular'],
  [/achiev|award|honou?r|accomplish|competition|scholar/i, 'Achievements'],
  [/certif|course/i, 'Certifications'],
  [/skill/i, 'Skills'],
];

/** Which fixed section name a spot in the editor belongs to (or null if outside a card). */
function sectionNameFor(el) {
  const card = el && el.closest && el.closest('#editor [data-sec]');
  if (!card) return null;
  if (card.dataset.sec === 'personal') return 'Header';
  if (card.dataset.sec === 'footer') return 'Footer';
  const title = card.querySelector('.sum-title')?.textContent || '';
  const match = SECTION_NAMES.find(([pattern]) => pattern.test(title));
  return match ? match[1] : 'Other section';
}

// Any of these inside the editor = "working on this section right now".
['focusin', 'pointerdown', 'input'].forEach(type => {
  document.addEventListener(type, event => {
    const name = sectionNameFor(event.target);
    if (name) currentSection = name;
    lastActivity = Date.now();
  }, true);
});
// Typing, scrolling or moving the mouse anywhere keep the stopwatch running (e.g. reading the preview).
['keydown', 'wheel', 'pointermove'].forEach(type => {
  document.addEventListener(type, () => { lastActivity = Date.now(); }, { capture: true, passive: true });
});

// Tick once a second. A hidden tab (they switched away) or 30s of no activity = the second doesn't count.
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - lastActivity > IDLE_AFTER_MS) return;
  activeSeconds++; // the whole visit
  if (activeSinceImport !== null) activeSinceImport++;
  if (currentSection) sectionSeconds[currentSection] = (sectionSeconds[currentSection] || 0) + 1;
}, 1000);

/** Send the collected times and start counting from zero again.
 *  This runs each time they leave the tab, so one visit can send a few
 *  active_time events; GA adds them up per session to give the visit's total. */
function sendSectionTimes() {
  if (activeSeconds > 0) {
    track('active_time', { seconds: activeSeconds, opened_at: OPENED_AT, transport_type: 'beacon' });
    activeSeconds = 0;
  }
  Object.keys(sectionSeconds).forEach(section => {
    // 'beacon' makes the browser deliver it even while the page is closing.
    track('section_time', { section, seconds: sectionSeconds[section], transport_type: 'beacon' });
    delete sectionSeconds[section];
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) sendSectionTimes(); });
window.addEventListener('pagehide', sendSectionTimes);
