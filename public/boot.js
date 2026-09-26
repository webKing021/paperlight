// Runs before anything paints: applies the saved theme so the splash (and the app) never
// flash the wrong colours. Kept tiny and dependency-free; see src/lib/useTheme.ts.
(function () {
  var mode = "system";
  try {
    mode = localStorage.getItem("paperlight.theme") || "system";
  } catch (e) {
    /* storage unavailable: follow Windows */
  }
  var dark = mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
})();
