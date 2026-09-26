import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type RootInfo, type SettingsInfo } from "../lib/api";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi, type ThemeMode } from "../stores/ui";

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: "Match Windows" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export default function SettingsView() {
  const revision = useIndex((s) => s.revision);
  const scanning = useIndex((s) => s.scanning);
  const refreshOverview = useIndex((s) => s.refresh);
  const touched = useIndex((s) => s.touched);
  const startScan = useIndex((s) => s.startScan);
  const toast = useUi((s) => s.toast);
  const [info, setInfo] = useState<SettingsInfo | null>(null);

  const load = useCallback(() => {
    api.getSettings().then(setInfo, (e) => toast(String(e), "error"));
  }, [toast]);

  // Reload after scans and live changes (document counts, index size).
  useEffect(load, [load, revision, scanning]);

  /** Runs a change, then refreshes this page and the rest of the app. */
  const change = async (fn: () => Promise<unknown>, rescan = false) => {
    try {
      await fn();
      if (rescan) await startScan();
      touched();
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  if (!info) return null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[680px] px-10 pb-16 pt-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-ink">Settings</h1>
        <p className="mt-1 text-[12.5px] text-graphite">
          Paperlight only reads your files. Nothing here moves, renames or deletes anything on
          disk.
        </p>

        <Locations info={info} change={change} refreshOverview={refreshOverview} />
        <Exclusions info={info} change={change} />
        <Appearance />
        <Background info={info} change={change} />
        <IndexSection info={info} change={change} />
      </div>
    </div>
  );
}

type Change = (fn: () => Promise<unknown>, rescan?: boolean) => Promise<void>;

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="flex items-center justify-between border-b border-line pb-2">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TextButton({
  onClick,
  disabled,
  tone = "plain",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "plain" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[12.5px] font-medium disabled:opacity-40",
        tone === "danger" ? "text-danger hover:bg-hover" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function OutlineButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-8 rounded-md border border-line-strong px-3 text-[12.5px] font-medium text-ink hover:bg-hover disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-graphite">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-[var(--ink)]"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------

function Locations({
  info,
  change,
  refreshOverview,
}: {
  info: SettingsInfo;
  change: Change;
  refreshOverview: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState<number | null>(null);

  const add = async () => {
    const picked = await open({ directory: true, multiple: true, title: "Choose folders to index" });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (paths.length === 0) return;
    await change(async () => {
      for (const path of paths) await api.addRoot(path);
    }, true);
    refreshOverview();
  };

  return (
    <Section
      title="Locations"
      action={
        <TextButton onClick={add}>
          <Plus className="size-3.5" strokeWidth={2} />
          Add folder
        </TextButton>
      }
    >
      {info.roots.length === 0 && (
        <p className="border-b border-line py-3 text-[13px] text-graphite">No locations. Add a folder to index.</p>
      )}
      {info.roots.map((root) =>
        confirm === root.id ? (
          <div key={root.id} className="flex items-center gap-3 border-b border-line bg-sheet px-2 py-2.5">
            <span className="flex-1 text-[12.5px] text-ink-2">
              Remove <span className="font-mono">{root.path}</span> and its{" "}
              {root.count.toLocaleString()} documents from Paperlight? Favourites and tags on
              them are lost.
            </span>
            <TextButton tone="danger" onClick={() => change(() => api.removeRoot(root.id))}>
              Remove
            </TextButton>
            <TextButton onClick={() => setConfirm(null)}>Keep</TextButton>
          </div>
        ) : (
          <LocationRow
            key={root.id}
            root={root}
            onToggle={(on) => change(() => api.setRootEnabled(root.id, on), on)}
            onRemove={() => setConfirm(root.id)}
          />
        ),
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-pencil">
        Paused locations keep what is already indexed but aren't watched or rescanned.
      </p>
    </Section>
  );
}

function LocationRow({
  root,
  onToggle,
  onRemove,
}: {
  root: RootInfo;
  onToggle: (on: boolean) => void;
  onRemove: () => void;
}) {
  const drive = /^[A-Za-z]:\\$/.test(root.path) ? root.path.slice(0, 2) : null;
  return (
    <div className="group flex items-center gap-3 border-b border-line py-2.5">
      <span className="w-8 font-mono text-[12px] font-medium text-ink">{drive ?? "DIR"}</span>
      <div className={clsx("min-w-0 flex-1", !root.enabled && "opacity-50")}>
        <div className="truncate text-[13px] text-ink">{drive ? `Local disk ${root.path}` : root.path}</div>
        <div className="font-mono text-[11px] text-pencil">
          {root.count.toLocaleString()} {root.count === 1 ? "document" : "documents"}
        </div>
      </div>
      <Check checked={root.enabled} onChange={onToggle} label="Watch" />
      <button
        type="button"
        title="Remove location"
        onClick={onRemove}
        className="rounded p-1 text-pencil opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** Human description of an exclusion pattern (see filters.rs for the rules). */
function describe(pattern: string): string {
  if (pattern.startsWith("?:\\")) return "top of every drive";
  if (/[\\:]/.test(pattern)) return "this folder and everything in it";
  return "any folder with this name";
}

function Exclusions({ info, change }: { info: SettingsInfo; change: Change }) {
  const [pattern, setPattern] = useState("");
  const toast = useUi((s) => s.toast);

  const add = async (value: string) => {
    const p = value.trim();
    if (!p) return;
    await change(async () => {
      const removed = await api.addExclusion(p);
      if (removed > 0) toast(`${removed.toLocaleString()} documents removed from Paperlight`);
    });
    setPattern("");
  };

  const choose = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a folder to skip" });
    if (typeof picked === "string") add(picked);
  };

  return (
    <Section title="Excluded folders">
      <ul>
        {info.exclusions.map((p) => (
          <li key={p} className="group flex items-center gap-3 border-b border-line py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
              {p.startsWith("?:\\") ? (
                <>
                  <span className="text-pencil">?:\</span>
                  {p.slice(3)}
                </>
              ) : (
                p
              )}
            </span>
            <span className="shrink-0 text-[12px] text-pencil">{describe(p)}</span>
            <button
              type="button"
              title="Index this again"
              onClick={() => change(() => api.removeExclusion(p), true)}
              className="rounded p-1 text-pencil opacity-0 hover:bg-hover hover:text-ink group-hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add(pattern)}
          placeholder="Folder name (build) or full path (D:\DevTools)"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-sheet px-2.5 font-mono text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-pencil focus:border-ink"
        />
        <OutlineButton onClick={() => add(pattern)} disabled={!pattern.trim()}>
          Add
        </OutlineButton>
        <OutlineButton onClick={choose}>Choose folder…</OutlineButton>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-pencil">
        The Recycle Bin and folders whose names start with $ or a dot are always skipped. You
        can also right-click any document and choose Exclude folder.
      </p>
    </Section>
  );
}

function Appearance() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between py-3">
        <span className="text-[13px] text-ink">Theme</span>
        <div className="flex rounded-md border border-line-strong p-0.5">
          {THEMES.map(({ mode, label }) => (
            <button
              type="button"
              key={mode}
              onClick={() => setTheme(mode)}
              className={clsx(
                "rounded px-3 py-1 text-[12.5px]",
                theme === mode ? "bg-ink font-medium text-on-ink" : "text-graphite hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </Section>
  );
}

function Background({ info, change }: { info: SettingsInfo; change: Change }) {
  const setAutostart = (on: boolean) =>
    change(async () => {
      await api.setAutostart(on);
      const shell = useIndex.getState().shell;
      if (shell) useIndex.setState({ shell: { ...shell, autostart: on } });
    });

  return (
    <Section title="In the background">
      <div className="flex items-start justify-between gap-6 border-b border-line py-3">
        <div>
          <div className="text-[13px] text-ink">Start with Windows</div>
          <div className="text-[12px] text-pencil">
            Starts hidden in the tray and keeps the index current. About 6 MB of memory.
          </div>
        </div>
        <Check checked={info.autostart} onChange={setAutostart} label={info.autostart ? "On" : "Off"} />
      </div>
      <div className="flex items-start justify-between gap-6 py-3">
        <div>
          <div className="text-[13px] text-ink">Quick search from any app</div>
          <div className="text-[12px] text-pencil">
            {info.hotkey
              ? "Alt+Space is used when free, otherwise Ctrl+Shift+Space or Ctrl+Alt+P."
              : "Alt+Space, Ctrl+Shift+Space and Ctrl+Alt+P are all taken by other apps."}
          </div>
        </div>
        <kbd className="shrink-0 rounded border border-line-strong bg-sheet px-2 py-0.5 font-mono text-[12px] text-ink">
          {info.hotkey ?? "Unavailable"}
        </kbd>
      </div>
    </Section>
  );
}

function IndexSection({ info, change }: { info: SettingsInfo; change: Change }) {
  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const startScan = useIndex((s) => s.startScan);
  const [confirmReset, setConfirmReset] = useState(false);
  const stats = overview?.stats;

  return (
    <Section title="Index">
      <dl className="grid grid-cols-3 border-b border-line py-3">
        <Stat label="Documents" value={(stats?.total ?? 0).toLocaleString()} />
        <Stat label="Index on disk" value={formatSize(info.indexBytes)} />
        <Stat
          label="Last full sync"
          value={overview?.lastScanAt ? formatRelative(overview.lastScanAt) : "Never"}
        />
      </dl>
      {confirmReset ? (
        <div className="mt-3 rounded-md border border-line-strong bg-sheet p-3">
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Empty the index and scan again from scratch? Favourites, tags on documents and the
            open history are cleared. Locations, exclusions and tag names are kept. Your files
            are not touched.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmReset(false);
                change(() => api.resetIndex());
              }}
              className="h-8 rounded-md bg-danger px-3 text-[12.5px] font-medium text-on-ink hover:opacity-90"
            >
              Reset index
            </button>
            <OutlineButton onClick={() => setConfirmReset(false)}>Cancel</OutlineButton>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <OutlineButton onClick={startScan} disabled={scanning}>
            {scanning ? "Scanning…" : "Rescan now"}
          </OutlineButton>
          <OutlineButton onClick={() => setConfirmReset(true)} disabled={scanning}>
            Reset index…
          </OutlineButton>
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-pencil">
        Rescans only write what changed. The live watcher normally makes them unnecessary.
      </p>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
