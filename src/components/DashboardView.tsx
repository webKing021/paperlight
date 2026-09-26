import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { openFile } from "../lib/actions";
import { api, type FileRow, type FormatInfo, type KindUsage } from "../lib/api";
import { enabledKinds, FILE_KINDS, type FileKind } from "../lib/fileKinds";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";

const PER_BUCKET = 5;

interface Bucket {
  kind: FileKind;
  usage: KindUsage | undefined;
  formats: FormatInfo[];
  recent: FileRow[];
}

/** Home: one bucket per document type, with its latest documents. */
export default function DashboardView() {
  const revision = useIndex((s) => s.revision);
  const disabled = useIndex((s) => s.overview?.disabledFormats);
  const [buckets, setBuckets] = useState<Bucket[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const kinds = enabledKinds(disabled);
    Promise.all([
      api.storageInsights(),
      api.listFormats(),
      ...kinds.map((kind) => api.listFiles({ kind, sort: "modified", limit: PER_BUCKET })),
    ]).then(([insights, formats, ...pages]) => {
      if (cancelled) return;
      const ins = insights as Awaited<ReturnType<typeof api.storageInsights>>;
      const fmts = formats as FormatInfo[];
      setBuckets(
        kinds.map((kind, i) => ({
          kind,
          usage: ins.byKind.find((k) => k.kind === kind),
          formats: fmts.filter((f) => f.kind === kind && f.enabled && f.count > 0),
          recent: (pages[i] as Awaited<ReturnType<typeof api.listFiles>>).items,
        })),
      );
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, [revision, disabled]);

  if (!buckets) return null;
  const total = buckets.reduce((n, b) => n + (b.usage?.count ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
        Overview
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-5">
          {buckets.map((b) => (
            <BucketCard key={b.kind} bucket={b} total={total} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BucketCard({ bucket, total }: { bucket: Bucket; total: number }) {
  const setView = useUi((s) => s.setView);
  const selectedId = useUi((s) => s.selectedId);
  const setSelectedId = useUi((s) => s.setSelectedId);
  const info = FILE_KINDS[bucket.kind];
  const count = bucket.usage?.count ?? 0;
  const share = total > 0 ? count / total : 0;

  return (
    <section className="flex flex-col rounded-md border border-line bg-sheet">
      <header className="px-4 pt-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className={clsx("h-4 w-[3px] self-center rounded-full", info.swatch)} />
          <h2 className="text-[15px] font-semibold text-ink">{info.label}</h2>
          <span className="ml-auto font-mono text-[11.5px] tabular-nums text-graphite">
            {count.toLocaleString()} · {formatSize(bucket.usage?.size ?? 0)}
          </span>
        </div>
        <div className="mt-2.5 h-[2px] bg-line">
          <div className={clsx("h-full", info.swatch)} style={{ width: `${share * 100}%` }} />
        </div>
        <div className="mt-2 flex min-h-4 flex-wrap gap-x-3 font-mono text-[11px] text-pencil">
          {bucket.formats.map((f) => (
            <span key={f.ext}>
              {f.ext} <span className="text-graphite">{f.count}</span>
            </span>
          ))}
        </div>
      </header>
      <ul className="mt-2 flex-1 border-t border-line">
        {bucket.recent.length === 0 && (
          <li className="px-4 py-4 text-[12.5px] text-pencil">No {info.label} files found yet.</li>
        )}
        {bucket.recent.map((row) => (
          <li
            key={row.id}
            onClick={() => setSelectedId(row.id)}
            onDoubleClick={() => openFile(row)}
            title={row.path}
            className={clsx(
              "flex cursor-default items-center gap-3 border-b border-line/60 px-4 py-2 last:border-b-0",
              selectedId === row.id ? "bg-lamp-wash" : "hover:bg-paper-2",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{row.name}</span>
            <span className="shrink-0 text-[11.5px] text-pencil">{formatRelative(row.modifiedAt)}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setView({ type: "kind", kind: bucket.kind })}
        className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-left text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
      >
        Show all {count.toLocaleString()}
        <ArrowRight className="size-3.5" />
      </button>
    </section>
  );
}
