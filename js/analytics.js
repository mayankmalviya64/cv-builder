// ---------- Google Analytics 4 ----------
// Counts visits (page views are automatic) plus a few button events:
//   download_pdf      – someone opened the print dialog to save the PDF
//   export_json       – someone saved their CV as .json
//   cv_import         – an import worked (with file type + section/bullet counts)
//   cv_import_failed  – an import showed an error
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
  gtag('config', GA_MEASUREMENT_ID);
}

/** Send one event to GA. It does nothing when analytics is off, and it can never break the app. */
function track(eventName, params = {}) {
  if (!ANALYTICS_ON) return;
  try {
    gtag('event', eventName, { ...params, local_time: new Date().toString() });
  } catch (err) {
    // Blocked by an ad-blocker or similar: just skip it.
  }
}
