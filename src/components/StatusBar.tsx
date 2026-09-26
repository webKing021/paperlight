import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";

export function StatusBar() {
  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const error = useIndex((s) => s.error);
  const summary = useIndex((s) => s.lastSummary);
  const startScan = useIndex((s) => s.startScan);

  // Re-render every 30 s so "updated 2 min ago" stays truthful.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const stats = overview?.stats;
  const roots = overview?.roots.filter((r) => r.enabled).length ?? 0;

  let dot = "bg-faint";
  let text = "Not indexed yet";
  if (error) {
    dot = "bg-red-500";
    text = `Indexing failed: ${error}`;
  } else if (scanning) {
    dot = "bg-amber-500 animate-pulse";
    text = "Indexing…";
  } else if (overview?.lastScanAt) {
    dot = "bg-emerald-500";
    text = `Up to date · updated ${formatRelative(overview.lastScanAt)}`;
  }

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-surface px-4 text-[11.5px] text-muted">
      <span className={clsx("size-1.5 rounded-full", dot)} />
      <span className="truncate">{text}</span>
      {stats && stats.total > 0 && (
        <span className="text-faint">
          · {stats.total.toLocaleString()} documents · {formatSize(stats.totalSize)} · {roots}{" "}
          {roots === 1 ? "location" : "locations"}
        </span>
      )}
      {summary && summary.errors > 0 && !scanning && (
        <span className="text-faint" title="Folders Windows did not allow Paperlight to read">
          · {summary.errors.toLocaleString()} skipped
        </span>
      )}
      {overview?.lastScanAt && (
        <button
          type="button"
          onClick={startScan}
          disabled={scanning}
          title="Rescan now"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-fg disabled:opacity-40"
        >
          <RefreshCw className={clsx("size-3", scanning && "animate-spin")} />
          Rescan
        </button>
      )}
    </footer>
  );
}
