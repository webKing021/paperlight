import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FileRow } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatRelative } from "../lib/format";
import { useDebounced } from "../lib/useDebounced";
import { useApplyTheme } from "../lib/useTheme";
import { Mark } from "./Mark";

const LIMIT = 7;

/**
 * The global-hotkey launcher: a small floating search box. Type, ↵ to open, esc to dismiss.
 * With an empty query it shows what you opened most recently.
 */
export function QuickSearch() {
  useApplyTheme();
  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 60);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** What the list shows when nothing is typed. */
  const [idle, setIdle] = useState<"opened" | "changed" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (q: string) => {
    try {
      if (q) {
        const page = await api.searchFiles({ text: q, limit: LIMIT });
        setRows(page.items);
        setIdle(null);
      } else {
        const opened = await api.listFiles({ opened: true, sort: "opened", limit: LIMIT });
        if (opened.total > 0) {
          setRows(opened.items);
          setIdle("opened");
        } else {
          setRows((await api.listFiles({ sort: "modified", limit: LIMIT })).items);
          setIdle("changed");
        }
      }
      setSelected(0);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [query, load]);

  // Every time the window appears: fresh results, input focused and selected.
  useEffect(() => {
    const win = getCurrentWindow();
    const focusInput = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    focusInput();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setError(null);
        load(inputRef.current?.value.trim() ?? "");
        focusInput();
      } else {
        api.hideQuick();
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [load]);

  const run = async (row: FileRow, reveal: boolean) => {
    try {
      await (reveal ? api.revealFile(row.id) : api.openFile(row.id));
      setText("");
      api.hideQuick();
    } catch (e) {
      setError(String(e));
      load(query);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setSelected((s) => Math.max(0, Math.min(rows.length - 1, s + step)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        api.showMain();
        api.hideQuick();
        return;
      }
      const row = rows[selected];
      if (row) run(row, e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (text) setText("");
      else api.hideQuick();
    }
  };

  return (
    <div className="h-screen">
      <div className="flex h-full flex-col overflow-hidden bg-paper">
        <label className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] text-pencil" strokeWidth={1.8} />
          <input
            ref={inputRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find any document…"
            spellCheck={false}
            className="h-full flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-pencil focus-visible:outline-none"
          />
          <Mark className="size-5 opacity-80" />
        </label>

        <div className="px-4 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-pencil">
          {idle === "opened"
            ? "Recently opened"
            : idle === "changed"
              ? "Recently changed"
              : rows.length
                ? "Best matches"
                : ""}
        </div>
        <ul className="min-h-0 flex-1 overflow-hidden">
          {rows.map((row, i) => (
            <li
              key={row.id}
              onMouseMove={() => setSelected(i)}
              onClick={() => run(row, false)}
              className={clsx(
                "relative flex h-[46px] cursor-default items-center gap-3 px-4",
                i === selected ? "bg-lamp-wash" : "",
              )}
            >
              {i === selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-lamp" />}
              <span className="flex w-11 shrink-0 items-center gap-1.5">
                <span className={clsx("h-4 w-[3px] rounded-full", FILE_KINDS[row.kind]?.swatch)} />
                <span className="font-mono text-[10.5px] uppercase text-graphite">{row.ext.slice(0, 4)}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium leading-5 text-ink">{row.name}</span>
                <span className="block truncate text-[11px] leading-4 text-pencil">{row.dir}</span>
              </span>
              <span className="shrink-0 text-[11.5px] text-graphite">{formatRelative(row.modifiedAt)}</span>
            </li>
          ))}
          {!rows.length && query && (
            <li className="px-4 py-6 text-[13px] text-graphite">No documents match “{query}”.</li>
          )}
        </ul>

        {error && <div className="px-4 pb-1 text-[12px] text-danger">{error}</div>}
        <div className="flex shrink-0 items-center gap-4 border-t border-line bg-paper-2 px-4 py-2 font-mono text-[10.5px] text-pencil">
          <span>↵ open</span>
          <span>ctrl ↵ show in folder</span>
          <span>⇧ ↵ open Paperlight</span>
          <span className="ml-auto">esc close</span>
        </div>
      </div>
    </div>
  );
}
