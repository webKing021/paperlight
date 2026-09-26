import { Loader2 } from "lucide-react";
import { useIndex } from "../stores";

export function ScanBanner() {
  const scanning = useIndex((s) => s.scanning);
  const progress = useIndex((s) => s.progress);
  const cancelScan = useIndex((s) => s.cancelScan);
  if (!scanning) return null;

  return (
    <div className="relative shrink-0 overflow-hidden border-b border-line bg-accent-soft/60">
      <div className="flex items-center gap-3 px-5 py-2.5">
        <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium">
            Indexing{progress ? ` ${progress.root}` : "…"}
            {progress && (
              <span className="ml-2 font-normal text-muted tabular-nums">
                {progress.filesFound.toLocaleString()} documents ·{" "}
                {progress.dirsScanned.toLocaleString()} folders
              </span>
            )}
          </div>
          {progress && (
            <div className="truncate text-[11.5px] text-faint" title={progress.currentDir}>
              {progress.currentDir}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={cancelScan}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
        >
          Stop
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
        <div className="h-full w-1/3 animate-[scan_1.4s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>
    </div>
  );
}
