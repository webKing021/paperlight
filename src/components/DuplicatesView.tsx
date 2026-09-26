import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, events, type DupGroup, type DupProgress } from "../lib/api";
import { formatSize } from "../lib/format";
import { DocRow, SectionLabel } from "./DocRow";

/** Rendering thousands of groups helps nobody; the biggest ones matter most. */
const MAX_GROUPS = 300;

/** Last result, so coming back to the view shows it at once while it is re-checked. */
let cached: DupGroup[] | null = null;

export default function DuplicatesView() {
  const [groups, setGroups] = useState<DupGroup[] | null>(cached);
  const [progress, setProgress] = useState<DupProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const found = await api.findDuplicates();
      cached = found;
      setGroups(found);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    const unlisten = events.onDupesProgress(setProgress);
    check();
    return () => {
      unlisten.then((f) => f());
    };
  }, [check]);

  const sets = groups?.length ?? 0;
  const extra = groups?.reduce((sum, g) => sum + g.size * (g.files.length - 1), 0) ?? 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
        <span>
          Duplicates
          {groups && <span className="ml-2 text-graphite">{sets.toLocaleString()}</span>}
        </span>
        <button
          type="button"
          onClick={check}
          disabled={running}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 uppercase tracking-[0.08em] hover:bg-hover hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={running ? "size-3 animate-spin" : "size-3"} />
          Check again
        </button>
      </div>

      {running && progress && progress.total > 0 && <Progress progress={progress} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <Empty title="Couldn't check for duplicates" hint={error} />
        ) : groups === null ? (
          <Empty title="Looking for identical documents…" hint="" />
        ) : sets === 0 ? (
          <Empty
            title="No duplicates"
            hint="Every indexed document is one of a kind. Paperlight compares exact contents, not names."
          />
        ) : (
          <>
            <div className="px-5 pt-5">
              <p className="text-[14px] font-medium text-ink">
                {sets === 1 ? "1 set" : `${sets.toLocaleString()} sets`} of identical documents ·{" "}
                {formatSize(extra)} in extra copies
              </p>
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-graphite">
                Same contents, byte for byte. Paperlight never deletes anything: open a copy or
                show it in its folder to decide what to keep.
              </p>
            </div>
            {groups.slice(0, MAX_GROUPS).map((g) => (
              <section key={`${g.size}-${g.files[0].id}`}>
                <SectionLabel>
                  {g.files.length} copies · {formatSize(g.size)} each
                </SectionLabel>
                <GroupRows group={g} />
              </section>
            ))}
            {sets > MAX_GROUPS && (
              <p className="px-5 py-4 text-[12px] text-pencil">
                Showing the {MAX_GROUPS} largest sets.
              </p>
            )}
            <div className="h-6" />
          </>
        )}
      </div>
    </div>
  );
}

/** Folders of a set's copies, minus the part they all share, so the difference is visible. */
function GroupRows({ group }: { group: DupGroup }) {
  const parts = group.files.map((f) => f.dir.split("\\"));
  let shared = 0;
  while (parts.every((p) => p.length > shared + 1 && p[shared] === parts[0][shared])) shared++;
  return (
    <>
      {group.files.map((f, i) => {
        const rest = parts[i].slice(shared).join("\\");
        const folder =
          shared > 1 ? (
            <>
              <span className="text-pencil/70">…\</span>
              <span className="text-graphite">{rest}</span>
            </>
          ) : undefined;
        return <DocRow key={f.id} row={f} folder={folder} />;
      })}
    </>
  );
}

function Progress({ progress }: { progress: DupProgress }) {
  const share = Math.min(1, progress.done / progress.total);
  return (
    <div className="relative shrink-0 border-b border-line bg-sheet px-5 py-2.5">
      <div className="flex items-baseline gap-3">
        <span className="text-[13px] font-medium text-ink">Comparing documents that share a size</span>
        <span className="font-mono text-[11px] tabular-nums text-graphite">
          {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[2px] bg-line">
        <div className="h-full bg-lamp transition-[width]" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[12.5px] text-graphite">{hint}</p>}
    </div>
  );
}
