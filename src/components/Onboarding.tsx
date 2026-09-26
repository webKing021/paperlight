import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, FolderPlus, HardDrive, Folder, Sparkles, X } from "lucide-react";
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
    <div className="flex h-full items-center justify-center overflow-y-auto px-8 py-10">
      <div className="w-full max-w-lg">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <FileSearch className="size-6" strokeWidth={1.5} />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">Every document, one place</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Paperlight finds every PDF, Word, Excel and PowerPoint file in the locations below and keeps
          track of them as they change. Your files are never moved or modified.
        </p>

        <div className="mt-6 rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-faint">
              Locations to index
            </span>
            <button
              type="button"
              onClick={addFolder}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
            >
              <FolderPlus className="size-3.5" />
              Add folder
            </button>
          </div>
          <ul className="max-h-56 divide-y divide-line overflow-y-auto">
            {roots.length === 0 && (
              <li className="px-4 py-4 text-[13px] text-muted">No locations yet — add a folder.</li>
            )}
            {roots.map((root) => {
              const isDrive = /^[A-Za-z]:\\$/.test(root.path);
              const Icon = isDrive ? HardDrive : Folder;
              return (
                <li key={root.id} className="group flex items-center gap-3 px-4 py-2.5">
                  <Icon className="size-4 text-muted" strokeWidth={1.75} />
                  <span className="flex-1 truncate text-[13px]">
                    {isDrive ? `Local Disk (${root.path.slice(0, 2)})` : root.path}
                  </span>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => remove(root.id)}
                    className="rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        <p className="mt-3 text-xs leading-relaxed text-faint">
          System folders (Windows, Program Files, AppData, node_modules…) are skipped automatically.
        </p>

        <button
          type="button"
          disabled={roots.length === 0}
          onClick={startScan}
          className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[13.5px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles className="size-4" />
          Start indexing
        </button>
      </div>
    </div>
  );
}
