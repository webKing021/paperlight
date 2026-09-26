import clsx from "clsx";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";

export function StatusBar() {
  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const background = useIndex((s) => s.background);
  const error = useIndex((s) => s.error);
  const summary = useIndex((s) => s.lastSummary);
  const startScan = useIndex((s) => s.startScan);

  // Refresh "updated 2 min ago" when the window regains focus: no timers while idle.
  const [, tick] = useState(0);
  useEffect(() => {
    const onFocus = () => tick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const stats = overview?.stats;
  const roots = overview?.roots.filter((r) => r.enabled).length ?? 0;

  let dot = "bg-pencil";
  let text = "Not indexed yet";
  if (error) {
    dot = "bg-danger";
    text = `Indexing failed: ${error}`;
  } else if (scanning) {
    dot = "bg-lamp animate-pulse";
    text = background ? "Syncing in the background…" : "Indexing…";
  } else if (overview?.watching) {
    dot = "bg-ok";
    text = "Live · watching for changes";
  } else if (overview?.lastScanAt) {
    dot = "bg-ok";
    text = `Up to date · synced ${formatRelative(overview.lastScanAt)}`;
  }

  return (
    <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-paper-2 px-4 font-mono text-[10.5px] text-graphite">
      <span className={clsx("size-1.5 rounded-full", dot)} />
      <span className="truncate">{text}</span>
      {stats && stats.total > 0 && (
        <span className="text-pencil">
          · {stats.total.toLocaleString()} documents · {formatSize(stats.totalSize)} · {roots}{" "}
          {roots === 1 ? "location" : "locations"}
        </span>
      )}
      {overview && overview.contentPending > 0 && (
        <span className="text-pencil" title="Reading the text inside documents so you can search it">
          · reading text of {overview.contentPending.toLocaleString()} documents
        </span>
      )}
      {summary && summary.errors > 0 && !scanning && (
        <span className="text-pencil" title="Folders Windows did not allow Paperlight to read">
          · {summary.errors.toLocaleString()} skipped
        </span>
      )}
      {overview?.lastScanAt && (
        <button
          type="button"
          onClick={startScan}
          disabled={scanning}
          title="Rescan now"
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={clsx("size-3", scanning && "animate-spin")} />
          Rescan
        </button>
      )}
    </footer>
  );
}
