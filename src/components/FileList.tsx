import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api, type FileRow, type ListQuery } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";

const PAGE_SIZE = 200;
const ROW_HEIGHT = 52;

/**
 * Loads a (possibly huge) result set page by page, only fetching pages that scroll into view.
 * Old pages stay visible until the first page of a reload arrives, so live updates don't flicker.
 */
function usePagedFiles(query: ListQuery, revision: number) {
  const [total, setTotal] = useState<number | null>(null);
  const pages = useRef(new Map<number, FileRow[]>());
  const loading = useRef(new Set<number>());
  const generation = useRef(0);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const key = JSON.stringify(query);

  useEffect(() => {
    const gen = ++generation.current;
    api.listFiles({ ...query, offset: 0, limit: PAGE_SIZE }).then((page) => {
      if (gen !== generation.current) return;
      pages.current = new Map([[0, page.items]]);
      loading.current = new Set();
      setTotal(page.total);
      rerender();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);

  const ensure = useCallback(
    (index: number) => {
      const pageNo = Math.floor(index / PAGE_SIZE);
      if (pages.current.has(pageNo) || loading.current.has(pageNo)) return;
      loading.current.add(pageNo);
      const gen = generation.current;
      api.listFiles({ ...query, offset: pageNo * PAGE_SIZE, limit: PAGE_SIZE }).then((page) => {
        if (gen !== generation.current) return;
        pages.current.set(pageNo, page.items);
        rerender();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  const getRow = (index: number) =>
    pages.current.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];

  return { total, getRow, ensure };
}

interface FileListProps {
  query: ListQuery;
  revision: number;
  emptyTitle: string;
  emptyHint: string;
}

export function FileList({ query, revision, emptyTitle, emptyHint }: FileListProps) {
  const { total, getRow, ensure } = usePagedFiles(query, revision);
  const [selected, setSelected] = useState<number | null>(null);
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

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-[14px] font-medium">{emptyTitle}</p>
        <p className="max-w-xs text-[12.5px] text-muted">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_120px_80px] gap-4 border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        <span>Name {total !== null && <span className="ml-1 font-normal normal-case tracking-normal">· {total.toLocaleString()}</span>}</span>
        <span>Modified</span>
        <span className="text-right">Size</span>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = getRow(item.index);
            return (
              <div
                key={item.key}
                className="absolute inset-x-0 px-2"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row ? (
                  <Row row={row} selected={selected === row.id} onSelect={() => setSelected(row.id)} />
                ) : (
                  <div className="mx-3 my-3 h-6 animate-pulse rounded bg-surface-2" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Row({ row, selected, onSelect }: { row: FileRow; selected: boolean; onSelect: () => void }) {
  const kind = FILE_KINDS[row.kind];
  return (
    <div
      onClick={onSelect}
      title={row.path}
      className={clsx(
        "grid h-full cursor-default grid-cols-[minmax(0,1fr)_120px_80px] items-center gap-4 rounded-lg px-3",
        selected ? "bg-accent-soft" : "hover:bg-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={clsx(
            "flex h-7 w-10 shrink-0 items-center justify-center rounded-md text-[10px] font-bold uppercase",
            kind?.chip,
          )}
        >
          {row.ext.slice(0, 4)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{row.name}</div>
          <div className="truncate text-[11.5px] text-faint">{row.dir}</div>
        </div>
      </div>
      <span className="text-[12px] text-muted" title={formatDateTime(row.modifiedAt)}>
        {formatRelative(row.modifiedAt)}
      </span>
      <span className="text-right text-[12px] tabular-nums text-muted">{formatSize(row.size)}</span>
    </div>
  );
}
