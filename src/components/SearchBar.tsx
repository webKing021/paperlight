import { Monitor, Moon, Search, Sun } from "lucide-react";
import { useEffect, useRef } from "react";
import { useUi } from "../stores/ui";

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function SearchBar() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const theme = useUi((s) => s.theme);
  const cycleTheme = useUi((s) => s.cycleTheme);
  const inputRef = useRef<HTMLInputElement>(null);
  const ThemeIcon = THEME_ICON[theme];

  // Ctrl+K / Ctrl+F focuses the search box from anywhere; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f")) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
      <label className="flex h-9 flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 transition-colors focus-within:border-accent focus-within:bg-surface">
        <Search className="size-4 text-faint" strokeWidth={2} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search documents by name, folder or content…"
          spellCheck={false}
          className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
        />
        <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-faint">
          Ctrl K
        </kbd>
      </label>
      <button
        type="button"
        onClick={cycleTheme}
        title={`Theme: ${theme}`}
        className="flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <ThemeIcon className="size-4" strokeWidth={1.75} />
      </button>
    </header>
  );
}
