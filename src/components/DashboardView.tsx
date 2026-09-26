import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { api, type FormatInfo, type KindUsage, type SortKey } from "../lib/api";
import { enabledKinds, FILE_KINDS, type FileKind } from "../lib/fileKinds";
import { formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";
import { FileList, type Fetcher } from "./FileList";

/** What each bucket is called on the overview. */
const BUCKET_NAME: Record<FileKind, string> = {
  pdf: "PDFs",
  word: "Word documents",
  excel: "Spreadsheets",
  slides: "Presentations",
};

/** Home: one bucket per document type; the chosen bucket's documents are listed below. */
export default function DashboardView() {
  const revision = useIndex((s) => s.revision);
  const disabled = useIndex((s) => s.overview?.disabledFormats);
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

  const list = useMemo(() => {
    const fetcher: Fetcher = (offset, limit) =>
      api.listFiles({ kind: active, sort: sort.key, ascending: sort.ascending, offset, limit });
    return { fetcher, key: JSON.stringify(["bucket", active, sort]) };
  }, [active, sort]);

  const onSort = (key: SortKey) =>
    setSort(sort.key === key ? { key, ascending: !sort.ascending } : { key, ascending: key === "name" });

  return (
    <div className="flex h-full flex-col">
      <div
        className="grid shrink-0 gap-3 px-5 pb-5 pt-6"
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
      <div className="min-h-0 flex-1 border-t border-line">
        {active && (
          <FileList
            fetcher={list.fetcher}
            fetchKey={list.key}
            revision={revision}
            title={BUCKET_NAME[active]}
            emptyTitle={`No ${BUCKET_NAME[active].toLowerCase()} yet`}
            emptyHint="They appear here as soon as they're found."
            sort={sort}
            onSort={onSort}
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
  const info = FILE_KINDS[kind];
  const exts = formats.map((f) => f.ext).join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={clsx(
        "group relative mt-[6px] flex min-w-0 flex-col rounded-md border px-4 pb-3.5 pt-4 text-left transition-colors",
        selected
          ? "border-ink bg-sheet"
          : "border-line bg-sheet/60 hover:border-line-strong hover:bg-sheet",
      )}
    >
      {/* Folder tab in the type's label-ink colour. */}
      <span
        className={clsx(
          "absolute -top-[6px] left-4 h-[6px] w-12 rounded-t-[3px] transition-[width]",
          info.swatch,
          selected && "w-16",
        )}
      />
      <span className="truncate text-[12.5px] font-medium text-graphite">{BUCKET_NAME[kind]}</span>
      <span className="mt-1 text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
        {(usage?.count ?? 0).toLocaleString()}
      </span>
      <span className="mt-3 flex min-w-0 items-baseline gap-2 font-mono text-[11px] text-pencil">
        <span className="shrink-0 text-graphite">{formatSize(usage?.size ?? 0)}</span>
        {exts && <span className="truncate">{exts}</span>}
      </span>
      {selected && <span className="absolute inset-x-4 bottom-0 h-[2px] rounded-t bg-lamp" />}
    </button>
  );
}
