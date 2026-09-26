import { Monitor, Moon, Search, Sun, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useUi } from "../stores/ui";

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: "Match Windows", light: "Light", dark: "Dark" } as const;

export function SearchBar() {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  const theme = useUi((s) => s.theme);
  const cycleTheme = useUi((s) => s.cycleTheme);
  const toggleDetails = useUi((s) => s.toggleDetails);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
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
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        toggleDetails();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDetails, toggleSidebar]);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-paper px-5">
      <label className="flex h-9 flex-1 items-center gap-2.5 rounded-md border border-line bg-sheet px-3 transition-colors focus-within:border-ink">
        <Search className="size-[15px] text-pencil" strokeWidth={1.8} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Find a document by name, folder or words inside it"
          spellCheck={false}
          className="h-full flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-pencil focus-visible:outline-none"
        />
        {query ? (
          <button
            type="button"
            title="Clear (Esc)"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="rounded p-0.5 text-pencil hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <kbd className="font-mono text-[10.5px] text-pencil">Ctrl K</kbd>
        )}
      </label>
      <button
        type="button"
        onClick={cycleTheme}
        title={`Theme: ${THEME_LABEL[theme]}`}
        className="flex size-9 items-center justify-center rounded-md text-graphite transition-colors hover:bg-hover hover:text-ink"
      >
        <ThemeIcon className="size-4" strokeWidth={1.6} />
      </button>
    </header>
  );
}
