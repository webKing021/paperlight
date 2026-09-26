/**
 * How long the splash stays after the window appears: the intro takes ~1.2 s, then the
 * finished mark rests a moment. A slow start keeps it up longer; a fast one never cuts it off.
 */
const MIN_VISIBLE_MS = 1650;

declare global {
  interface Window {
    /** Set by public/boot.js when the main window is shown. */
    __splashShownAt?: number;
  }
}

let hidden = false;

/**
 * Fades out the splash from index.html. Called once the first data is on screen.
 * `immediate` skips it (e.g. the quick window).
 */
export function hideSplash(immediate = false) {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById("splash");
  if (!splash) return;
  if (immediate) {
    splash.remove();
    return;
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shownAt = window.__splashShownAt ?? 0;
  const wait = reduced ? 0 : Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
  window.setTimeout(() => {
    splash.classList.add("done");
    window.setTimeout(() => splash.remove(), 400);
  }, wait);
}
