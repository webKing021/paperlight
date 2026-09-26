import clsx from "clsx";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FormatInfo, type KindUsage, type SortKey } from "../lib/api";
import { enabledKinds, type FileKind } from "../lib/fileKinds";
import { formatSize } from "../lib/format";
import { useDebounced } from "../lib/useDebounced";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";
import { FileIcon } from "./FileIcon";
import { FileList, type Fetcher } from "./FileList";

/** What each bucket is called on the overview. */
const BUCKET_NAME: Record<FileKind, string> = {
  pdf: "PDFs",
  word: "Word documents",
  excel: "Spreadsheets",
  slides: "Presentations",
};

/** A bucket's name inside a sentence: "PDFs" keeps its capitals, "word documents" doesn't. */
const inText = (kind: FileKind) => (kind === "pdf" ? BUCKET_NAME[kind] : BUCKET_NAME[kind].toLowerCase());

/** Home: one bucket per document type; the chosen bucket's documents are listed below. */
export default function DashboardView() {
  const revision = useIndex((s) => s.revision);
  const disabled = useIndex((s) => s.overview?.disabledFormats);
  const roots = useIndex((s) => s.overview?.roots.filter((r) => r.enabled).length ?? 0);
  const bucket = useUi((s) => s.bucket);
  const setBucket = useUi((s) => s.setBucket);
  const sort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  const [usage, setUsage] = useState<KindUsage[]>([]);
  const [formats, setFormats] = useState<FormatInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.storageInsights(), api.listFormats()]).then(([insights, list]) => {
      if (cancelled) return;
      setUsage(insights.byKind);
      setFormats(list);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const kinds = enabledKinds(disabled);
  const active = kinds.includes(bucket) ? bucket : kinds[0];

  // Search inside the chosen bucket only; cleared when another bucket is picked.
  const [find, setFind] = useState("");
  useEffect(() => setFind(""), [active]);
  const text = useDebounced(find.trim(), 90);

  const list = useMemo(() => {
    if (text) {
      const fetcher: Fetcher = (offset, limit) => api.searchFiles({ text, kind: active, offset, limit });
      return {
        fetcher,
        key: JSON.stringify(["bucket-search", active, text]),
        highlight: text.toLowerCase().split(/\s+/),
      };
    }
    const fetcher: Fetcher = (offset, limit) =>
      api.listFiles({ kind: active, sort: sort.key, ascending: sort.ascending, offset, limit });
    return { fetcher, key: JSON.stringify(["bucket", active, sort]), highlight: undefined };
  }, [active, sort, text]);

  const onSort = (key: SortKey) =>
    setSort(sort.key === key ? { key, ascending: !sort.ascending } : { key, ascending: key === "name" });

  const total = usage.reduce((n, u) => n + u.count, 0);
  const size = usage.reduce((n, u) => n + u.size, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-5 pt-5">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.015em] text-ink">Overview</h1>
        <p className="mt-0.5 text-[13px] text-graphite">
          {usage.length === 0
            ? " "
            : `${total.toLocaleString()} documents · ${formatSize(size)} on disk${roots ? ` · ${roots} ${roots === 1 ? "location" : "locations"}` : ""}`}
        </p>
      </div>
      <div
        className="grid shrink-0 gap-3 px-5 pb-4 pt-4"
        style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}
      >
        {kinds.map((kind) => (
          <BucketTile
            key={kind}
            kind={kind}
            usage={usage.find((u) => u.kind === kind)}
            formats={formats.filter((f) => f.kind === kind && f.enabled && f.count > 0)}
            selected={kind === active}
            onSelect={() => setBucket(kind)}
          />
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {active && (
          <FileList
            fetcher={list.fetcher}
            fetchKey={list.key}
            revision={revision}
            title={BUCKET_NAME[active]}
            emptyTitle={
              text ? `No ${inText(active)} match “${text}”` : `No ${inText(active)} yet`
            }
            emptyHint={
              text
                ? "Try fewer or shorter words: part of a name, a folder or a phrase from inside is enough."
                : "They appear here as soon as they're found."
            }
            highlight={list.highlight}
            autoSelect={!!text}
            sort={text ? undefined : sort}
            onSort={text ? undefined : onSort}
            toolbar={<BucketSearch value={find} onChange={setFind} name={inText(active)} />}
          />
        )}
      </div>
    </div>
  );
}

function BucketTile({
  kind,
  usage,
  formats,
  selected,
  onSelect,
}: {
  kind: FileKind;
  usage: KindUsage | undefined;
  formats: FormatInfo[];
  selected: boolean;
  onSelect: () => void;
}) {
  const exts = formats.map((f) => f.ext).join(", ");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "flex min-w-0 flex-col rounded-lg border bg-sheet p-4 text-left transition-[border-color,box-shadow,background-color] duration-150",
        selected
          ? "border-ink/70 shadow-[0_0_0_1px_var(--ink)] dark:border-ink/60"
          : "border-line hover:border-line-strong hover:bg-paper-2/60",
      )}
    >
      <FileIcon kind={kind} size={30} />
      <span className="mt-3 font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {(usage?.count ?? 0).toLocaleString()}
      </span>
      <span className="mt-1.5 truncate text-[13px] font-medium text-ink-2">{BUCKET_NAME[kind]}</span>
      <span className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[12px] text-pencil">
        <span className="shrink-0 text-graphite">{formatSize(usage?.size ?? 0)}</span>
        {exts && <span className="truncate">· {exts}</span>}
      </span>
    </button>
  );
}

/** Finds documents inside the chosen bucket (names, folders and the words inside). */
function BucketSearch({
  value,
  onChange,
  name,
}: {
  value: string;
  onChange: (value: string) => void;
  name: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="flex h-8 w-72 items-center gap-2 rounded-md border border-line bg-paper-2 px-2.5 transition-[background-color,border-color] duration-150 focus-within:border-line-strong focus-within:bg-sheet">
      <Search className="size-3.5 shrink-0 text-pencil" strokeWidth={2} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={`Search in ${name}`}
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-pencil focus-visible:outline-none"
      />
      {value && (
        <button
          type="button"
          title="Clear (Esc)"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="flex size-5 items-center justify-center rounded text-pencil hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </label>
  );
}
