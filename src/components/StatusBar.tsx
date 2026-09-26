import { getVersion } from "@tauri-apps/api/app";
import clsx from "clsx";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { Kbd } from "./SearchBar";

export function StatusBar() {
  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const background = useIndex((s) => s.background);
  const error = useIndex((s) => s.error);
  const summary = useIndex((s) => s.lastSummary);
  const startScan = useIndex((s) => s.startScan);
  const hotkey = useIndex((s) => s.shell?.hotkey);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

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
    text = "Up to date · watching for changes";
  } else if (overview?.lastScanAt) {
    dot = "bg-ok";
    text = `Up to date · synced ${formatRelative(overview.lastScanAt)}`;
  }

  const meta = [
    stats && stats.total > 0 && `${stats.total.toLocaleString()} documents`,
    stats && stats.total > 0 && formatSize(stats.totalSize),
    roots > 0 && `${roots} ${roots === 1 ? "location" : "locations"}`,
  ].filter(Boolean);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-paper-2 px-4 text-[12px] text-graphite">
      <span className="flex min-w-0 items-center gap-2">
        <span className={clsx("size-[7px] shrink-0 rounded-full", dot)} />
        <span className="truncate">{text}</span>
      </span>
      {meta.length > 0 && <span className="shrink-0 text-pencil">{meta.join("  ·  ")}</span>}
      {overview && overview.contentPending > 0 && (
        <span className="truncate text-pencil" title="Reading the text inside documents so you can search it">
          Reading text of {overview.contentPending.toLocaleString()} documents…
        </span>
      )}
      {summary && summary.errors > 0 && !scanning && (
        <span className="shrink-0 text-pencil" title="Folders Windows did not allow Paperlight to read">
          {summary.errors.toLocaleString()} folders skipped
        </span>
      )}
      <span className="flex-1" />
      {hotkey && (
        <span className="flex shrink-0 items-center gap-1.5 text-pencil" title="Search from any app">
          Quick search
          <Kbd className="h-[18px] bg-paper px-1 text-[10.5px]">{hotkey}</Kbd>
        </span>
      )}
      {overview?.lastScanAt && (
        <button
          type="button"
          onClick={startScan}
          disabled={scanning}
          title="Look for changes on disk now"
          className="flex h-[22px] shrink-0 items-center gap-1.5 rounded px-1.5 hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <RotateCw className={clsx("size-3", scanning && "animate-spin")} strokeWidth={2} />
          Rescan
        </button>
      )}
      {version && (
        <span className="shrink-0 border-l border-line pl-3 tabular-nums text-pencil" title="Paperlight version">
          v{version}
        </span>
      )}
    </footer>
  );
}
