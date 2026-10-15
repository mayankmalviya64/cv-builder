// ---------- Google Analytics 4 ----------
// Counts visits (page views are automatic) plus a few button events:
//   download_pdf      – someone opened the print dialog to save the PDF
//   export_json       – someone saved their CV as .json
//   cv_import         – an import worked (with file type + section/bullet counts)
//   cv_import_failed  – an import showed an error
//   section_time      – active seconds spent editing one section (see the bottom of this file)
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

// ---------- Time spent per section ----------
// A stopwatch for each editor card (Header, Academics, Work experience, …).
// A second only counts when the tab is open AND the person typed, clicked or
// scrolled in the last 30 seconds, so a forgotten tab doesn't pile up hours.
// When they leave or switch tabs, we send one `section_time` event per section.

const IDLE_AFTER_MS = 30 * 1000;
const sectionSeconds = {};   // e.g. { 'Work experience': 95, 'Header': 12 }
let currentSection = null;   // the card the person is working in right now
let lastActivity = 0;        // when they last typed / clicked / scrolled

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
// Typing and scrolling anywhere keep the stopwatch running (e.g. reading the preview).
['keydown', 'wheel'].forEach(type => {
  document.addEventListener(type, () => { lastActivity = Date.now(); }, { capture: true, passive: true });
});

// Tick once a second and add the second to the current section if they're active.
setInterval(() => {
  if (document.hidden || !currentSection) return;
  if (Date.now() - lastActivity > IDLE_AFTER_MS) return;
  sectionSeconds[currentSection] = (sectionSeconds[currentSection] || 0) + 1;
}, 1000);

/** Send the collected times and start counting from zero again. */
function sendSectionTimes() {
  Object.keys(sectionSeconds).forEach(section => {
    // 'beacon' makes the browser deliver it even while the page is closing.
    track('section_time', { section, seconds: sectionSeconds[section], transport_type: 'beacon' });
    delete sectionSeconds[section];
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) sendSectionTimes(); });
window.addEventListener('pagehide', sendSectionTimes);
