// Placed right after the splash markup in index.html: by now the splash can paint (its
// stylesheet blocks this script until loaded). The main window starts hidden and is shown now,
// so its first visible frame is the splash (see shell::main_ready). src/lib/splash.ts times
// the splash from this moment.
(function () {
  var tauri = window.__TAURI_INTERNALS__;
  var label = tauri && tauri.metadata && tauri.metadata.currentWindow && tauri.metadata.currentWindow.label;
  if (label !== "main") return;
  window.__splashShownAt = performance.now();
  tauri.invoke("main_ready").catch(function () {});

  // If the app never gets going (a load error), say so instead of animating forever.
  setTimeout(function () {
    var tag = document.querySelector("#splash:not(.done) .sp-tag");
    if (tag) tag.textContent = "This is taking longer than usual. Press Ctrl+R to try again.";
  }, 15000);
})();
