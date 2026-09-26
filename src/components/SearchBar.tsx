import clsx from "clsx";
import { Moon, PanelRight, Search, Sun, SunMoon, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useUi } from "../stores/ui";

const THEME_ICON = { system: SunMoon, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: "Match Windows", light: "Light", dark: "Dark" } as const;

/** A small keyboard-shortcut chip. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={clsx(
        "inline-flex h-5 items-center rounded border border-line bg-sheet px-1.5 font-sans text-[11px] font-medium text-pencil",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** `detailsToggle` shows the details-panel button; false where the panel isn't available. */
export function SearchBar({ detailsToggle }: { detailsToggle: boolean }) {
  const query = useUi((s) => s.query);
  const detailsOpen = useUi((s) => s.detailsOpen);
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
    <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-paper pl-5 pr-3">
      <label className="mr-auto flex h-9 w-full max-w-[680px] items-center gap-2.5 rounded-lg border border-transparent bg-paper-2 px-3 transition-[background-color,border-color] duration-150 focus-within:border-line-strong focus-within:bg-sheet">
        <Search className="size-4 shrink-0 text-pencil" strokeWidth={1.8} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search documents by name, folder or the words inside"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-pencil focus-visible:outline-none"
        />
        {query ? (
          <button
            type="button"
            title="Clear (Esc)"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="flex size-6 items-center justify-center rounded-md text-pencil hover:bg-hover hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        ) : (
          <Kbd>Ctrl K</Kbd>
        )}
      </label>
      <ToolButton onClick={cycleTheme} title={`Theme: ${THEME_LABEL[theme]} (click to change)`}>
        <ThemeIcon className="size-[17px]" strokeWidth={1.7} />
      </ToolButton>
      {detailsToggle && (
        <ToolButton
          onClick={toggleDetails}
          title={detailsOpen ? "Hide details (Ctrl+I)" : "Show details (Ctrl+I)"}
          active={detailsOpen}
        >
          <PanelRight className="size-[17px]" strokeWidth={1.7} />
        </ToolButton>
      )}
    </header>
  );
}

function ToolButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={clsx(
        "flex size-9 items-center justify-center rounded-md transition-colors duration-100",
        active ? "bg-selected text-ink" : "text-graphite hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
