import { excludeFolder } from "../lib/actions";
import { excludableFolders, splitLast } from "../lib/paths";
import { useIndex } from "../stores";

/**
 * Lists the folders around a document that can be excluded, outermost first, so one click can
 * drop a whole tree (e.g. D:\DevTools) rather than just the innermost folder.
 */
export function FolderChooser({ dir, onDone }: { dir: string; onDone: () => void }) {
  const roots = useIndex((s) => s.overview?.roots ?? []);
  const folders = excludableFolders(dir, roots);

  if (folders.length === 0) {
    return (
      <p className="px-2.5 py-1.5 text-[12px] leading-relaxed text-pencil">
        This document sits directly in a location. Remove or pause the location in Settings
        instead.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {folders.map((folder) => {
        const [parent, name] = splitLast(folder);
        return (
          <button
            type="button"
            key={folder}
            title={`Stop indexing ${folder}`}
            onClick={() => {
              excludeFolder(folder);
              onDone();
            }}
            className="truncate rounded-md px-2.5 py-1.5 text-left text-[12.5px] text-pencil hover:bg-hover"
          >
            {parent}
            <span className="font-medium text-ink">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
