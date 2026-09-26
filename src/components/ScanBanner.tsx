import { useIndex } from "../stores";

export function ScanBanner() {
  const scanning = useIndex((s) => s.scanning);
  const progress = useIndex((s) => s.progress);
  const background = useIndex((s) => s.background);
  const cancelScan = useIndex((s) => s.cancelScan);
  // Automatic syncs stay out of the way; the status bar mentions them.
  if (!scanning || background) return null;

  return (
    <div className="relative shrink-0 overflow-hidden border-b border-line bg-sheet">
      <div className="flex items-center gap-4 px-5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-[13px] font-medium text-ink">
              Indexing {progress ? progress.root : "…"}
            </span>
            {progress && (
              <span className="font-mono text-[11px] tabular-nums text-graphite">
                {progress.filesFound.toLocaleString()} docs · {progress.dirsScanned.toLocaleString()}{" "}
                folders
              </span>
            )}
          </div>
          {progress && (
            <div className="truncate font-mono text-[10.5px] text-pencil" title={progress.currentDir}>
              {progress.currentDir}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={cancelScan}
          className="rounded px-2.5 py-1 text-[12px] text-graphite hover:bg-hover hover:text-ink"
        >
          Stop
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
        <div className="h-full w-1/5 animate-[runner_1.6s_ease-in-out_infinite] bg-lamp" />
      </div>
    </div>
  );
}
