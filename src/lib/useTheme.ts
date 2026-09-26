import { useEffect } from "react";
import { useUi } from "../stores/ui";

/**
 * Applies the chosen theme to <html>, following the OS setting in "system" mode. public/boot.js
 * does the same before first paint; this keeps it current afterwards.
 */
export function useApplyTheme() {
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}
