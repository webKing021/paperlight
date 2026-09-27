import { getVersion } from "@tauri-apps/api/app";
import clsx from "clsx";
import { ArrowRight, ArrowUpRight, Clock3, FolderCheck, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { formatSize } from "../lib/format";
import { useUpdates, type UpdateStatus } from "../stores/updates";
import { Mark } from "./Mark";

const BUTTON = "flex h-9 shrink-0 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium";

/** How far along an update is, for the ring: 1 = ready or done, null = size not known yet. */
export function updateProgress(status: UpdateStatus): number | null {
  if (status.state === "downloading") return status.total ? Math.min(1, status.received / status.total) : null;
  return 1;
}

/**
 * The update symbol: an amber ring that is full while an update waits, then refills as it
 * downloads (spinning while the size is unknown).
 */
export function UpdateRing({
  size,
  progress,
  children,
}: {
  size: number;
  progress: number | null;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className={clsx("absolute inset-0 -rotate-90", progress === null && "animate-spin")}>
        <circle cx="18" cy="18" r="16.5" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
        <circle
          cx="18"
          cy="18"
          r="16.5"
          fill="none"
          stroke="var(--lamp)"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${(progress ?? 0.25) * 100} 100`}
          className="transition-[stroke-dasharray] duration-300 ease-out"
        />
      </svg>
      {children}
    </span>
  );
}

/** "A new version is ready": what's new, then the download and install progress. */
export function UpdateDialog() {
  const open = useUpdates((s) => s.dialogOpen);
  const status = useUpdates((s) => s.status);
  const close = useUpdates((s) => s.closeDialog);
  const install = useUpdates((s) => s.install);
  const [current, setCurrent] = useState("");
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getVersion().then(setCurrent, () => {});
  }, []);

  const visible = open && "version" in status;
  const installing = status.state === "installing";

  useEffect(() => {
    if (!visible) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !installing) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, installing, close]);

  if (!visible) return null;

  const busy = status.state === "downloading" || installing;
  const progress = updateProgress(status);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-6 animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="flex max-h-full w-[500px] flex-col overflow-hidden rounded-xl border border-line-strong bg-sheet shadow-pop animate-rise"
      >
        <div className="min-h-0 overflow-y-auto px-7 pb-6 pt-7">
          <div className="flex items-center gap-4">
            <UpdateRing size={56} progress={busy ? progress : 1}>
              <Mark className="size-[22px]" />
            </UpdateRing>
            <div className="min-w-0">
              <h2 id="update-title" className="font-display text-[20px] font-semibold tracking-[-0.015em] text-ink">
                {installing ? "Installing the update" : busy ? "Downloading the update" : "A new Paperlight is ready"}
              </h2>
              <div className="mt-1.5 flex items-center gap-2 text-[12.5px]">
                {current && (
                  <>
                    <span className="rounded-md border border-line-strong px-1.5 py-px tabular-nums text-graphite">
                      {current}
                    </span>
                    <ArrowRight className="size-3.5 text-pencil" strokeWidth={2} />
                  </>
                )}
                <span className="rounded-md bg-lamp px-1.5 py-px font-semibold tabular-nums text-[#1b1b1e]">
                  {status.version}
                </span>
              </div>
            </div>
          </div>

          {status.notes.trim() && <ReleaseNotes text={status.notes} />}

          <ul className="mt-6 grid grid-cols-3 gap-3 text-[12px] leading-snug text-graphite">
            <Assurance icon={Clock3}>Installs in a few seconds</Assurance>
            <Assurance icon={FolderCheck}>Keeps your index, tags and settings</Assurance>
            <Assurance icon={ShieldCheck}>Signed and verified before install</Assurance>
          </ul>
        </div>

        <div className="border-t border-line bg-paper-2 px-7 py-4">
          {busy ? (
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="font-medium text-ink">
                    {installing
                      ? "Paperlight will close and reopen by itself"
                      : progress === null
                        ? "Starting download…"
                        : `${Math.round(progress * 100)}%`}
                  </span>
                  {status.state === "downloading" && status.total !== null && (
                    <span className="tabular-nums text-pencil">
                      {formatSize(status.received)} of {formatSize(status.total)}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-selected">
                  {progress === null ? (
                    <div className="h-full w-1/5 animate-[runner_1.6s_ease-in-out_infinite] rounded-full bg-lamp" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-lamp transition-[width] duration-200"
                      style={{ width: `${progress * 100}%` }}
                    />
                  )}
                </div>
              </div>
              {!installing && (
                <button
                  type="button"
                  onClick={close}
                  className={`${BUTTON} border border-line-strong bg-sheet text-ink hover:bg-hover`}
                >
                  Hide
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => api.openWebsite("releases").catch(() => {})}
                className={`${BUTTON} -ml-2.5 px-2.5 text-graphite hover:bg-hover hover:text-ink`}
              >
                Release notes
                <ArrowUpRight className="size-3.5" strokeWidth={2} />
              </button>
              <span className="flex-1" />
              <button
                type="button"
                onClick={close}
                className={`${BUTTON} text-ink-2 hover:bg-hover hover:text-ink`}
              >
                Not now
              </button>
              <button
                ref={primary}
                type="button"
                onClick={install}
                className={`${BUTTON} bg-lamp font-semibold text-[#1b1b1e] shadow-[inset_0_-1px_0_rgb(0_0_0/0.12)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-lamp/50 hover:brightness-105 active:brightness-95`}
              >
                Update now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Assurance({ icon: Icon, children }: { icon: typeof Clock3; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-px size-3.5 shrink-0 text-pencil" strokeWidth={1.9} />
      <span>{children}</span>
    </li>
  );
}

type Tone = "new" | "fixed" | "plain";

/** "### Added" style headings become labels; known Keep-a-Changelog kinds get a colour. */
function toneOf(heading: string): Tone {
  if (/^(added|new|features?)$/i.test(heading)) return "new";
  if (/^(fixed|fixes|bug ?fixes)$/i.test(heading)) return "fixed";
  return "plain";
}

const LABEL: Record<Tone, string> = {
  new: "bg-lamp-wash text-ink",
  fixed: "bg-ok/15 text-ok",
  plain: "bg-selected text-ink-2",
};

/** The release's CHANGELOG section: "### Heading" groups of "- " items (and plain lines). */
function ReleaseNotes({ text }: { text: string }) {
  const groups: { heading: string | null; items: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .trimEnd();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) {
      groups.push({ heading: heading[1].trim(), items: [] });
      continue;
    }
    if (groups.length === 0) groups.push({ heading: null, items: [] });
    const group = groups[groups.length - 1];
    const item = line.match(/^\s*[-*]\s+(.*)/);
    // Wrapped lines continue the item above them.
    if (!item && /^\s/.test(line) && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${line.trim()}`;
    } else {
      group.items.push((item ? item[1] : line).trim());
    }
  }

  return (
    <div className="mt-6 max-h-[260px] overflow-y-auto border-t border-line pt-5 select-text">
      {groups.map((g, i) => (
        <div key={i} className={clsx(i > 0 && "mt-4")}>
          {g.heading && (
            <span
              className={clsx(
                "mb-2 inline-flex h-5 items-center rounded px-1.5 text-[11.5px] font-semibold",
                LABEL[toneOf(g.heading)],
              )}
            >
              {g.heading}
            </span>
          )}
          <ul className="flex flex-col gap-1.5">
            {g.items.map((item, j) => (
              <li key={j} className="relative pl-4 text-[13px] leading-relaxed text-ink-2">
                <span className="absolute left-0.5 top-[0.62em] size-[5px] rounded-full bg-line-strong" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
