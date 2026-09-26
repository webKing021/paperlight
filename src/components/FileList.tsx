import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { copyPath, openFile, revealFile } from "../lib/actions";
import type { FileRow, Page } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";

const PAGE_SIZE = 200;
const ROW_HEIGHT = 50;
const GRID = "grid-cols-[minmax(0,1fr)_112px_72px_68px]";

export type Fetcher = (offset: number, limit: number) => Promise<Page>;

/**
 * Loads a (possibly huge) result set page by page, only fetching pages that scroll into view.
 * Old pages stay visible until the first page of a reload arrives, so live updates don't flicker.
 */
function usePagedFiles(fetcher: Fetcher, key: string, revision: number) {
  const [total, setTotal] = useState<number | null>(null);
  const pages = useRef(new Map<number, FileRow[]>());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const gen = ++generation.current;
    fetcherRef.current(0, PAGE_SIZE).then(
      (page) => {
        if (gen !== generation.current) return;
        pages.current = new Map([[0, page.items]]);
        loading.current = new Set();
        setTotal(page.total);
        rerender();
      },
      () => gen === generation.current && setTotal(0),
    );
  }, [key, revision]);

  const ensure = useCallback((index: number) => {
    const pageNo = Math.floor(index / PAGE_SIZE);
    if (pages.current.has(pageNo) || loading.current.has(pageNo)) return;
    loading.current.add(pageNo);
    const gen = generation.current;
    fetcherRef.current(pageNo * PAGE_SIZE, PAGE_SIZE).then((page) => {
      if (gen !== generation.current) return;
      pages.current.set(pageNo, page.items);
      rerender();
    });
  }, []);

  const getRow = useCallback(
    (index: number) => pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE],
    [],
  );

  return { total, getRow, ensure };
}

interface FileListProps {
  fetcher: Fetcher;
  /** Changes whenever the query changes; resets paging and selection. */
  fetchKey: string;
  revision: number;
  title: string;
  emptyTitle: string;
  emptyHint: string;
  /** Terms to highlight in names and folders. */
  highlight?: string[];
  /** Select the first row automatically (search results: Enter opens the best match). */
  autoSelect?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  row: FileRow;
}

export function FileList(props: FileListProps) {
  const { fetcher, fetchKey, revision, title, emptyTitle, emptyHint, highlight, autoSelect } =
    props;
  const { total, getRow, ensure } = usePagedFiles(fetcher, fetchKey, revision);
  const [selected, setSelected] = useState(-1);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    for (const item of items) ensure(item.index);
  }, [items, ensure]);

  useEffect(() => {
    setSelected(autoSelect ? 0 : -1);
    virtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // Keyboard: ↑/↓ PgUp/PgDn move, Enter opens, Ctrl+Enter shows in folder, Ctrl+Shift+C copies.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!total || menu) return;
      const move = (to: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(total - 1, to));
        setSelected(next);
        virtualizer.scrollToIndex(next, { align: "auto" });
      };
      switch (e.key) {
        case "ArrowDown":
          return move(selected + 1);
        case "ArrowUp":
          return move(selected - 1);
        case "PageDown":
          return move(selected + 10);
        case "PageUp":
          return move(selected - 10);
      }
      const row = selected >= 0 ? getRow(selected) : undefined;
      if (!row) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.ctrlKey) revealFile(row);
        else openFile(row);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copyPath(row);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, selected, menu, getRow, virtualizer]);

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-[14px] font-medium text-ink">{emptyTitle}</p>
        <p className="max-w-xs text-[12.5px] text-graphite">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className={clsx(
          "grid shrink-0 gap-4 border-b border-line px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil",
          GRID,
        )}
      >
        <span>
          {title}
          {total !== null && (
            <span className="ml-2 text-graphite">{total.toLocaleString()}</span>
          )}
        </span>
        <span>Modified</span>
        <span className="text-right">Size</span>
        <span />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={() => setMenu(null)}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = getRow(item.index);
            return (
              <div
                key={item.key}
                className="absolute inset-x-0"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row ? (
                  <Row
                    row={row}
                    selected={selected === item.index}
                    highlight={highlight}
                    onSelect={() => setSelected(item.index)}
                    onMenu={(x, y) => {
                      setSelected(item.index);
                      setMenu({ x, y, row });
                    }}
                  />
                ) : (
                  <div className="mx-5 my-4 h-4 w-1/3 rounded-sm bg-paper-2" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

interface RowProps {
  row: FileRow;
  selected: boolean;
  highlight?: string[];
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}

function Row({ row, selected, highlight, onSelect, onMenu }: RowProps) {
  const kind = FILE_KINDS[row.kind];
  return (
    <div
      onClick={onSelect}
      onDoubleClick={() => openFile(row)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      title={row.path}
      className={clsx(
        "group relative grid h-full cursor-default items-center gap-4 border-b border-line/60 px-5",
        GRID,
        selected ? "bg-lamp-wash" : "hover:bg-paper-2",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-lamp" />}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex w-11 shrink-0 items-center gap-1.5">
          <span className={clsx("h-4 w-[3px] rounded-full", kind?.swatch)} />
          <span className="font-mono text-[10.5px] uppercase text-graphite">
            {row.ext.slice(0, 4)}
          </span>
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium leading-5 text-ink">
            {mark(row.name, highlight)}
          </div>
          <div className="truncate text-[11.5px] leading-4 text-pencil">{mark(row.dir, highlight)}</div>
        </div>
      </div>
      <span className="text-[12px] text-graphite" title={formatDateTime(row.modifiedAt)}>
        {formatRelative(row.modifiedAt)}
      </span>
      <span className="text-right font-mono text-[11.5px] tabular-nums text-graphite">
        {formatSize(row.size)}
      </span>
      <div
        className={clsx(
          "flex justify-end gap-0.5",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <IconButton title="Show in folder (Ctrl+Enter)" onClick={() => revealFile(row)}>
          <FolderOpen className="size-[15px]" strokeWidth={1.6} />
        </IconButton>
        <IconButton title="Copy path (Ctrl+Shift+C)" onClick={() => copyPath(row)}>
          <Copy className="size-[14px]" strokeWidth={1.6} />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex size-7 items-center justify-center rounded text-graphite hover:bg-sheet hover:text-ink"
    >
      {children}
    </button>
  );
}

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const items: { label: string; hint: string; icon: ReactNode; run: () => void }[] = [
    { label: "Open", hint: "Enter", icon: <ExternalLink className="size-3.5" />, run: () => openFile(menu.row) },
    {
      label: "Show in folder",
      hint: "Ctrl+Enter",
      icon: <FolderOpen className="size-3.5" />,
      run: () => revealFile(menu.row),
    },
    {
      label: "Copy path",
      hint: "Ctrl+Shift+C",
      icon: <Copy className="size-3.5" />,
      run: () => copyPath(menu.row),
    },
  ];

  // Keep the menu inside the window.
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - 120);

  return (
    <div
      className="fixed z-50 w-56 rounded-md border border-line-strong bg-sheet p-1 shadow-[0_10px_30px_-12px_rgba(28,27,24,0.35)]"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          type="button"
          key={item.label}
          onClick={() => {
            item.run();
            onClose();
          }}
          className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-hover"
        >
          <span className="text-graphite">{item.icon}</span>
          {item.label}
          <span className="ml-auto font-mono text-[10px] text-pencil">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** Wraps case-insensitive occurrences of `terms` in <mark>. */
function mark(text: string, terms?: string[]): ReactNode {
  const needles = terms?.filter((t) => t.length > 0);
  if (!needles?.length) return text;
  const lower = text.toLowerCase();
  const hits: [number, number][] = [];
  for (const t of needles) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(t, from);
      if (at < 0) break;
      hits.push([at, at + t.length]);
      from = at + t.length;
    }
  }
  if (!hits.length) return text;
  hits.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of hits) {
    if (end <= pos) continue;
    const s = Math.max(start, pos);
    if (s > pos) out.push(text.slice(pos, s));
    out.push(
      <mark key={s} className="rounded-[2px] bg-lamp/35 text-inherit">
        {text.slice(s, end)}
      </mark>,
    );
    pos = end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
