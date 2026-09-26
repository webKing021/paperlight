import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ClipboardCopy,
  ExternalLink,
  FileSearch,
  FolderOpen,
  FolderX,
  Star,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  copyPath,
  openFile,
  revealFile,
  tagWithNew,
  toggleFavourite,
  toggleTag,
} from "../lib/actions";
import type { FileRow, Page, SortKey, Tag } from "../lib/api";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi, type Sort } from "../stores/ui";
import { FileIcon } from "./FileIcon";
import { FolderChooser } from "./FolderChooser";
import { TagDot } from "./TagDot";

const PAGE_SIZE = 200;
const ROW_HEIGHT = 50;
/** Search results have room for a line of matching text. */
const SEARCH_ROW_HEIGHT = 70;
const GRID = "grid-cols-[minmax(0,1fr)_120px_72px_96px]";

/**
 * The list only cares about its height. Ignoring width changes keeps it from re-rendering on
 * every frame while a side panel slides open or closed.
 */
const observeHeight: typeof observeElementRect = (instance, cb) => {
  let height = -1;
  return observeElementRect(instance, (rect) => {
    if (rect.height === height) return;
    height = rect.height;
    cb(rect);
  });
};

export type Fetcher = (offset: number, limit: number) => Promise<Page>;

/**
 * Loads a (possibly huge) result set page by page, only fetching pages that scroll into view.
 * Old pages stay visible until a reload arrives, so live updates don't flicker.
 */
function usePagedFiles(fetcher: Fetcher, key: string, revision: number) {
  const [total, setTotal] = useState<number | null>(null);
  const pages = useRef(new Map<number, FileRow[]>());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const lastKey = useRef(key);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const gen = ++generation.current;
    // Same query, new data (edit or live change): reload every page that was on screen so
    // nothing blanks out. A different query starts from the first page.
    const sameQuery = lastKey.current === key;
    lastKey.current = key;
    const wanted = sameQuery && pages.current.size ? [...pages.current.keys()] : [0];
    Promise.all(
      wanted.map((p) =>
        fetcherRef.current(p * PAGE_SIZE, PAGE_SIZE).then((page) => [p, page] as const),
      ),
    ).then(
      (results) => {
        if (gen !== generation.current) return;
        pages.current = new Map(results.map(([p, page]) => [p, page.items]));
        loading.current = new Set();
        setTotal(results[0][1].total);
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
  /** Current sort, when the list can be sorted by clicking column headers. */
  sort?: Sort;
  onSort?: (key: SortKey) => void;
  /** Shown at the right of the title (e.g. a search box); stays visible when the list is empty. */
  toolbar?: ReactNode;
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
  const tags = useIndex((s) => s.tags);
  const [selected, setSelected] = useState(-1);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = highlight ? SEARCH_ROW_HEIGHT : ROW_HEIGHT;

  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    observeElementRect: observeHeight,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(() => {
    for (const item of items) ensure(item.index);
  }, [items, ensure]);

  // Tell the details panel which document is selected.
  const setSelectedId = useUi((s) => s.setSelectedId);
  const selectedRowId = selected >= 0 ? (getRow(selected)?.id ?? null) : null;
  useEffect(() => setSelectedId(selectedRowId), [selectedRowId, setSelectedId]);

  useEffect(() => {
    setSelected(autoSelect ? 0 : -1);
    virtualizer.scrollToOffset(0);
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  /** Opens the row menu under the selected row (keyboard). */
  const menuForSelected = useCallback(
    (row: FileRow) => {
      const box = scrollRef.current?.getBoundingClientRect();
      if (!box) return;
      const top = selected * rowHeight - (scrollRef.current?.scrollTop ?? 0);
      setMenu({ x: box.left + 240, y: box.top + top + rowHeight - 6, row });
    },
    [selected, rowHeight],
  );

  // ↑/↓ PgUp/PgDn move · Enter open · Ctrl+Enter show in folder · Ctrl+Shift+C copy path ·
  // Ctrl+D favourite · Ctrl+T tags
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
      const key = e.key.toLowerCase();
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.ctrlKey) revealFile(row);
        else openFile(row);
      } else if (e.ctrlKey && e.shiftKey && key === "c") {
        e.preventDefault();
        copyPath(row);
      } else if (e.ctrlKey && !e.shiftKey && key === "d") {
        e.preventDefault();
        toggleFavourite(row);
      } else if (e.ctrlKey && !e.shiftKey && key === "t") {
        e.preventDefault();
        menuForSelected(row);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, selected, menu, getRow, virtualizer, menuForSelected]);

  const header = (
    <div className="flex min-h-[52px] shrink-0 items-center gap-2.5 px-5 pb-1.5 pt-3">
      <h2 className="truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {total !== null && (
        <span className="shrink-0 pt-0.5 text-[12.5px] tabular-nums text-pencil">
          {total.toLocaleString()} {total === 1 ? "document" : "documents"}
        </span>
      )}
      {props.toolbar && <div className="ml-auto shrink-0">{props.toolbar}</div>}
    </div>
  );

  if (total === 0) {
    if (!props.toolbar) return <EmptyState title={emptyTitle} hint={emptyHint} />;
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="min-h-0 flex-1 border-t border-line">
          <EmptyState title={emptyTitle} hint={emptyHint} />
        </div>
      </div>
    );
  }

  const tagById = new Map(tags.map((t) => [t.id, t]));

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className={clsx("mx-2 grid h-8 shrink-0 items-center gap-4 border-b border-line px-3", GRID)}>
        <HeaderCell sortKey="name" sort={props.sort} onSort={props.onSort}>
          Name
        </HeaderCell>
        <HeaderCell sortKey="modified" sort={props.sort} onSort={props.onSort}>
          Modified
        </HeaderCell>
        <HeaderCell sortKey="size" align="right" sort={props.sort} onSort={props.onSort}>
          Size
        </HeaderCell>
        <span />
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pt-1" onScroll={() => setMenu(null)}>
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 8 }}>
          {items.map((item) => {
            const row = getRow(item.index);
            return (
              <div
                key={item.key}
                className="absolute inset-x-0 px-2"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row ? (
                  <Row
                    row={row}
                    rowTags={row.tags.map((id) => tagById.get(id)).filter((t): t is Tag => !!t)}
                    selected={selected === item.index}
                    highlight={highlight}
                    onSelect={() => setSelected(item.index)}
                    onMenu={(x, y) => {
                      setSelected(item.index);
                      setMenu({ x, y, row });
                    }}
                  />
                ) : (
                  <Placeholder />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {menu && <ContextMenu menu={menu} tags={tags} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Shown while a page of rows is on its way. */
function Placeholder() {
  return (
    <div className="flex h-full items-center gap-3 px-3">
      <span className="h-[30px] w-[26px] rounded-[4px] bg-paper-2" />
      <span className="flex flex-col gap-1.5">
        <span className="h-3 w-56 rounded bg-paper-2" />
        <span className="h-2.5 w-36 rounded bg-paper-2" />
      </span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center animate-fade">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-paper-2 text-pencil">
        <FileSearch className="size-[22px]" strokeWidth={1.6} />
      </span>
      <p className="text-[14.5px] font-semibold text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-graphite">{hint}</p>}
    </div>
  );
}

function HeaderCell({
  sortKey,
  align,
  sort,
  onSort,
  children,
}: {
  sortKey: SortKey;
  align?: "right";
  sort?: Sort;
  onSort?: (key: SortKey) => void;
  children: ReactNode;
}) {
  const active = sort?.key === sortKey;
  const Arrow = sort?.ascending ? ArrowUp : ArrowDown;
  const base = "text-[12px] font-medium text-pencil";
  if (!onSort) {
    return <span className={clsx(base, align === "right" && "text-right")}>{children}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={`Sort by ${String(children).toLowerCase()}`}
      className={clsx(
        base,
        "flex items-center gap-1 hover:text-ink",
        align === "right" && "justify-end",
        active && "text-ink-2",
      )}
    >
      {children}
      {active && <Arrow className="size-3" strokeWidth={2.2} />}
    </button>
  );
}

interface RowProps {
  row: FileRow;
  rowTags: Tag[];
  selected: boolean;
  highlight?: string[];
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}

function Row({ row, rowTags, selected, highlight, onSelect, onMenu }: RowProps) {
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
        "group grid h-full cursor-default items-center gap-4 rounded-md px-3",
        GRID,
        selected ? "bg-selected" : "hover:bg-hover/70",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <FileIcon kind={row.kind} ext={row.ext} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13.5px] font-medium leading-5 text-ink">
              {mark(row.name, highlight)}
            </span>
            {row.isFavourite && (
              <Star className="size-3 shrink-0 fill-lamp text-lamp" strokeWidth={1.5} />
            )}
            {rowTags.slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 text-[11px] leading-[18px] text-graphite"
              >
                <TagDot color={t.color} className="size-1.5" />
                {t.name}
              </span>
            ))}
          </div>
          <div className="truncate text-[12px] leading-4 text-pencil">{mark(row.dir, highlight)}</div>
          {row.snippet && (
            <div className="mt-1 truncate text-[12.5px] leading-4 text-graphite">{snippet(row.snippet)}</div>
          )}
        </div>
      </div>
      <span className="truncate text-[12.5px] text-graphite" title={formatDateTime(row.modifiedAt)}>
        {formatRelative(row.modifiedAt)}
      </span>
      <span className="text-right text-[12.5px] tabular-nums text-graphite">{formatSize(row.size)}</span>
      <div
        className={clsx(
          "flex justify-end gap-0.5 transition-opacity duration-100",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <IconButton
          title={row.isFavourite ? "Remove from favourites (Ctrl+D)" : "Add to favourites (Ctrl+D)"}
          onClick={() => toggleFavourite(row)}
        >
          <Star
            className={clsx("size-[15px]", row.isFavourite && "fill-lamp text-lamp")}
            strokeWidth={1.7}
          />
        </IconButton>
        <IconButton title="Show in folder (Ctrl+Enter)" onClick={() => revealFile(row)}>
          <FolderOpen className="size-[15px]" strokeWidth={1.7} />
        </IconButton>
        <IconButton title="Copy path (Ctrl+Shift+C)" onClick={() => copyPath(row)}>
          <ClipboardCopy className="size-[15px]" strokeWidth={1.7} />
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
      className="flex size-7 items-center justify-center rounded-md text-graphite hover:bg-paper hover:text-ink"
    >
      {children}
    </button>
  );
}

function ContextMenu({ menu, tags, onClose }: { menu: MenuState; tags: Tag[]; onClose: () => void }) {
  const [newTag, setNewTag] = useState("");
  const [excluding, setExcluding] = useState(false);
  const { row } = menu;

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

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  // Keep the menu inside the window.
  const height = 236 + Math.min(tags.length, 8) * 32;
  const x = Math.min(menu.x, window.innerWidth - 248);
  const y = Math.min(menu.y, window.innerHeight - height);

  const frame = "fixed z-50 rounded-lg border border-line bg-sheet p-1 shadow-pop animate-fade";

  if (excluding) {
    return (
      <div
        className={clsx(frame, "w-80")}
        style={{ left: Math.min(menu.x, window.innerWidth - 336), top: Math.max(8, y) }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setExcluding(false)}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-medium text-ink hover:bg-hover"
        >
          <ArrowLeft className="size-3.5 text-graphite" />
          Stop indexing a folder
        </button>
        <p className="px-2.5 pb-1.5 text-[12px] leading-snug text-pencil">
          Its documents leave Paperlight. Nothing on disk changes; undo in Settings.
        </p>
        <div className="border-t border-line pt-1">
          <FolderChooser dir={row.dir} onDone={onClose} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(frame, "w-60")}
      style={{ left: x, top: Math.max(8, y) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuItem icon={<ExternalLink className="size-4" />} hint="Enter" onClick={run(() => openFile(row))}>
        Open
      </MenuItem>
      <MenuItem icon={<FolderOpen className="size-4" />} hint="Ctrl+Enter" onClick={run(() => revealFile(row))}>
        Show in folder
      </MenuItem>
      <MenuItem icon={<ClipboardCopy className="size-4" />} hint="Ctrl+Shift+C" onClick={run(() => copyPath(row))}>
        Copy path
      </MenuItem>
      <MenuItem
        icon={<Star className={clsx("size-4", row.isFavourite && "fill-lamp text-lamp")} />}
        hint="Ctrl+D"
        onClick={run(() => toggleFavourite(row))}
      >
        {row.isFavourite ? "Remove favourite" : "Add to favourites"}
      </MenuItem>
      <MenuItem icon={<FolderX className="size-4" />} onClick={() => setExcluding(true)}>
        Exclude folder…
      </MenuItem>

      <div className="-mx-1 my-1 border-t border-line" />
      <div className="px-2.5 pb-1 pt-1 text-[11.5px] font-semibold text-pencil">Tags</div>
      <div className="max-h-64 overflow-y-auto">
        {tags.map((tag) => {
          const on = row.tags.includes(tag.id);
          return (
            <MenuItem
              key={tag.id}
              icon={<TagDot color={tag.color} />}
              hint={on ? <Check className="size-4 text-ink" /> : undefined}
              onClick={run(() => toggleTag(row, tag.id))}
            >
              <span className="truncate">{tag.name}</span>
            </MenuItem>
          );
        })}
      </div>
      <input
        value={newTag}
        onChange={(e) => setNewTag(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && newTag.trim()) {
            tagWithNew(row, newTag);
            onClose();
          }
          if (e.key === "Escape") onClose();
        }}
        autoFocus={tags.length === 0}
        maxLength={40}
        placeholder="New tag…"
        className="mt-0.5 h-8 w-full rounded-md border border-transparent bg-transparent px-2.5 text-[13px] text-ink outline-none placeholder:text-pencil focus:border-line-strong focus:bg-paper"
      />
    </div>
  );
}

function MenuItem({
  icon,
  hint,
  onClick,
  children,
}: {
  icon: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-ink hover:bg-hover"
    >
      <span className="flex w-4 justify-center text-graphite">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
      {hint && <span className="ml-auto text-[11.5px] text-pencil">{hint}</span>}
    </button>
  );
}

/** Renders a text passage whose matched words are wrapped in \u0002 … \u0003. */
function snippet(text: string): ReactNode {
  return text.split("\u0002").map((part, i) => {
    if (i === 0) return part;
    const [hit, rest = ""] = part.split("\u0003");
    return (
      <span key={i}>
        <mark className="rounded-[3px] bg-lamp-wash px-px text-ink">{hit}</mark>
        {rest}
      </span>
    );
  });
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
      <mark key={s} className="rounded-[3px] bg-lamp-wash px-px text-inherit">
        {text.slice(s, end)}
      </mark>,
    );
    pos = end;
  }
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
