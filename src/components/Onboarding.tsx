import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { useIndex } from "../stores";

/** First-run screen: pick what to index, then start the first scan. */
export function Onboarding() {
  const roots = useIndex((s) => s.overview?.roots ?? []);
  const refresh = useIndex((s) => s.refresh);
  const startScan = useIndex((s) => s.startScan);
  const [error, setError] = useState<string | null>(null);

  const addFolder = async () => {
    setError(null);
    const picked = await open({ directory: true, multiple: true, title: "Choose folders to index" });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    for (const path of paths) {
      try {
        await api.addRoot(path);
      } catch (e) {
        setError(String(e));
      }
    }
    refresh();
  };

  const remove = async (id: number) => {
    await api.removeRoot(id);
    refresh();
  };

  return (
    <div className="flex h-full overflow-y-auto px-12 py-14">
      <div className="m-auto w-full max-w-[520px]">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-pencil">First run</p>
        <h1 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink">
          Every document on this PC,
          <br />
          one search away.
        </h1>
        <p className="mt-4 max-w-[440px] text-[13.5px] leading-relaxed text-graphite">
          Paperlight lists every PDF, Word, Excel and PowerPoint file in the places below and keeps
          the list current as files change. Nothing is moved, renamed or uploaded.
        </p>

        <div className="mt-8 border-y border-line">
          <div className="flex items-center justify-between py-2.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
              Locations
            </span>
            <button
              type="button"
              onClick={addFolder}
              className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink"
            >
              <Plus className="size-3.5" strokeWidth={2} />
              Add folder
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {roots.length === 0 && (
              <li className="border-t border-line py-3 text-[13px] text-graphite">
                No locations yet. Add a folder to begin.
              </li>
            )}
            {roots.map((root) => {
              const drive = /^[A-Za-z]:\\$/.test(root.path) ? root.path.slice(0, 2) : null;
              return (
                <li key={root.id} className="group flex items-center gap-3 border-t border-line py-2.5">
                  <span className="w-8 font-mono text-[12px] font-medium text-ink">
                    {drive ?? "DIR"}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-ink-2">
                    {drive ? "Local disk" : root.path}
                  </span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => remove(root.id)}
                    className="rounded p-1 text-pencil opacity-0 hover:text-ink group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}

        <p className="mt-3 text-[12px] leading-relaxed text-pencil">
          Windows, Program Files, AppData, the Recycle Bin and developer folders are skipped.
        </p>

        <button
          type="button"
          disabled={roots.length === 0}
          onClick={startScan}
          className="group mt-8 flex h-10 items-center gap-2 rounded-md bg-ink px-5 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          Start indexing
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
