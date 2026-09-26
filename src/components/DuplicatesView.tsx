import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, events, type DupGroup, type DupProgress } from "../lib/api";
import { formatSize } from "../lib/format";
import { DocRow, PageHeader, SectionLabel } from "./DocRow";
import { EmptyState } from "./FileList";

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
    <div className="flex h-full flex-col animate-fade">
      <PageHeader
        title="Duplicates"
        summary={
          groups && sets > 0
            ? `${sets === 1 ? "1 set" : `${sets.toLocaleString()} sets`} of identical documents · ${formatSize(extra)} in extra copies`
            : "Documents with exactly the same contents, wherever they are."
        }
        action={
          <button
            type="button"
            onClick={check}
            disabled={running}
            className="mb-0.5 flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-3 text-[12.5px] font-medium text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50"
          >
            <RotateCw className={running ? "size-3.5 animate-spin" : "size-3.5"} strokeWidth={2} />
            {running ? "Checking…" : "Check again"}
          </button>
        }
      />

      {running && progress && progress.total > 0 && <Progress progress={progress} />}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <EmptyState title="Couldn't check for duplicates" hint={error} />
        ) : groups === null ? (
          <EmptyState title="Looking for identical documents…" hint="" />
        ) : sets === 0 ? (
          <EmptyState
            title="No duplicates"
            hint="Every indexed document is one of a kind. Paperlight compares exact contents, not names."
          />
        ) : (
          <>
            <p className="mx-5 mt-3 max-w-2xl rounded-md bg-paper-2 px-3 py-2 text-[12.5px] leading-relaxed text-graphite">
              Same contents, byte for byte. Paperlight never deletes anything: open a copy or show
              it in its folder to decide what to keep.
            </p>
            {groups.slice(0, MAX_GROUPS).map((g) => (
              <section key={`${g.size}-${g.files[0].id}`}>
                <SectionLabel right={`${formatSize(g.size)} each`}>{g.files.length} copies</SectionLabel>
                <div className="pt-1">
                  <GroupRows group={g} />
                </div>
              </section>
            ))}
            {sets > MAX_GROUPS && (
              <p className="px-5 py-4 text-[12px] text-pencil">Showing the {MAX_GROUPS} largest sets.</p>
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
    <div className="mx-5 mt-3 shrink-0">
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-graphite">Comparing documents that share a size</span>
        <span className="tabular-nums text-pencil">
          {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-2">
        <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
