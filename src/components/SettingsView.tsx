import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { ArrowUpRight, Check, Download, Folder, HardDrive, Moon, Plus, Sun, SunMoon, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type FormatInfo, type RootInfo, type SettingsInfo } from "../lib/api";
import { FILE_KINDS, KIND_ORDER } from "../lib/fileKinds";
import { formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi, type ThemeMode } from "../stores/ui";
import { FileIcon } from "./FileIcon";
import { Mark } from "./Mark";
import { Kbd } from "./SearchBar";
import { Switch } from "./Switch";

const THEMES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "system", label: "Match Windows", icon: SunMoon },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
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
    <div className="h-full overflow-y-auto animate-fade">
      <div className="mx-auto max-w-[760px] px-8 pb-16 pt-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-ink">Settings</h1>
        <p className="mt-1 text-[13px] text-graphite">
          Paperlight only reads your files. Nothing here moves, renames or deletes anything on disk.
        </p>

        <Locations info={info} change={change} refreshOverview={refreshOverview} />
        <Formats />
        <Exclusions info={info} change={change} />
        <Appearance />
        <Background info={info} change={change} />
        <IndexSection info={info} change={change} />
        <About />
      </div>
    </div>
  );
}

type Change = (fn: () => Promise<unknown>, rescan?: boolean) => Promise<void>;

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="mb-2.5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-graphite">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A Windows-Settings-like group of rows. */
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet", className)}>
      {children}
    </div>
  );
}

function Row({
  title,
  hint,
  icon,
  children,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("group flex min-h-[56px] items-center gap-3.5 px-4 py-2.5", className)}>
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-ink">{title}</div>
        {hint && <div className="text-[12px] leading-snug text-pencil">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-2 px-1 text-[12px] leading-relaxed text-pencil">{children}</p>;
}

const BUTTON = "flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium disabled:opacity-40";

function Button({
  onClick,
  disabled,
  tone = "secondary",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "secondary" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        BUTTON,
        tone === "primary" && "bg-ink text-on-ink hover:opacity-90",
        tone === "danger" && "bg-danger text-white hover:opacity-90",
        tone === "secondary" && "border border-line-strong bg-sheet text-ink hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

function IconBox({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-paper-2 text-graphite">
      {children}
    </span>
  );
}

function RemoveButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-pencil opacity-0 hover:bg-hover hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
    >
      <X className="size-4" />
    </button>
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
      description="Drives and folders Paperlight keeps an eye on."
      action={
        <Button onClick={add}>
          <Plus className="size-3.5" strokeWidth={2.2} />
          Add folder
        </Button>
      }
    >
      <Card>
        {info.roots.length === 0 && <Row title="No locations yet" hint="Add a folder to index." />}
        {info.roots.map((root) =>
          confirm === root.id ? (
            <div key={root.id} className="flex items-center gap-3 bg-paper-2 px-4 py-3">
              <span className="flex-1 text-[12.5px] leading-relaxed text-ink-2">
                Remove <span className="font-medium text-ink">{root.path}</span> and its{" "}
                {root.count.toLocaleString()} documents from Paperlight? Favourites and tags on
                them are lost. Your files stay where they are.
              </span>
              <Button onClick={() => setConfirm(null)}>Keep</Button>
              <Button tone="danger" onClick={() => change(() => api.removeRoot(root.id))}>
                Remove
              </Button>
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
      </Card>
      <Note>Paused locations keep what is already indexed but aren't watched or rescanned.</Note>
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
    <Row
      icon={
        <IconBox>
          {drive ? <HardDrive className="size-4" strokeWidth={1.7} /> : <Folder className="size-4" strokeWidth={1.7} />}
        </IconBox>
      }
      title={<span className={clsx(!root.enabled && "text-pencil")}>{drive ? `Local disk (${drive})` : root.path}</span>}
      hint={`${root.count.toLocaleString()} ${root.count === 1 ? "document" : "documents"}${root.enabled ? "" : " · paused"}`}
    >
      <RemoveButton title="Remove location" onClick={onRemove} />
      <Switch checked={root.enabled} onChange={onToggle} label={`Watch ${root.path}`} />
    </Row>
  );
}

/**
 * Which formats are indexed. Changes are staged and applied together, because turning a
 * format off removes its documents (with their favourites and tags) from the index.
 */
function Formats() {
  const revision = useIndex((s) => s.revision);
  const startScan = useIndex((s) => s.startScan);
  const touched = useIndex((s) => s.touched);
  const toast = useUi((s) => s.toast);
  const [formats, setFormats] = useState<FormatInfo[] | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listFormats().then((list) => {
      setFormats(list);
      setDraft(new Set(list.filter((f) => !f.enabled).map((f) => f.ext)));
    }, () => {});
  }, [revision]);

  if (!formats) return null;

  const saved = new Set(formats.filter((f) => !f.enabled).map((f) => f.ext));
  const turnedOff = formats.filter((f) => draft.has(f.ext) && !saved.has(f.ext));
  const turnedOn = formats.filter((f) => !draft.has(f.ext) && saved.has(f.ext));
  const dirty = turnedOff.length + turnedOn.length > 0;
  const removes = turnedOff.reduce((n, f) => n + f.count, 0);
  const noneLeft = draft.size === formats.length;

  const toggle = (exts: string[], off: boolean) =>
    setDraft((d) => {
      const next = new Set(d);
      for (const e of exts) {
        if (off) next.add(e);
        else next.delete(e);
      }
      return next;
    });

  const apply = async () => {
    setBusy(true);
    try {
      const removed = await api.setFormats([...draft]);
      if (removed > 0) toast(`${removed.toLocaleString()} documents removed from Paperlight`);
      if (turnedOn.length > 0) await startScan();
      touched();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="File formats" description="Only the formats you keep on are scanned, watched and shown.">
      <Card>
        {KIND_ORDER.map((kind) => {
          const group = formats.filter((f) => f.kind === kind);
          const exts = group.map((f) => f.ext);
          const onCount = exts.filter((e) => !draft.has(e)).length;
          return (
            <div key={kind} className="flex items-start gap-3.5 px-4 py-3">
              <FileIcon kind={kind} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex h-5 items-center text-[13px] text-ink">{FILE_KINDS[kind].label}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.map((f) => {
                    const on = !draft.has(f.ext);
                    return (
                      <button
                        type="button"
                        key={f.ext}
                        aria-pressed={on}
                        onClick={() => toggle([f.ext], on)}
                        title={f.readsText ? undefined : "Found by name only; the text isn't read"}
                        className={clsx(
                          "flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors",
                          on
                            ? "border-line-strong bg-selected text-ink"
                            : "border-dashed border-line-strong text-pencil hover:text-graphite",
                        )}
                      >
                        {on && <Check className="size-3" strokeWidth={2.4} />}
                        .{f.ext}
                        {!f.readsText && <span className="text-pencil">*</span>}
                        <span className="tabular-nums text-pencil">{f.count.toLocaleString()}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <Switch
                checked={onCount > 0}
                onChange={(on) => toggle(exts, !on)}
                label={`Index ${FILE_KINDS[kind].label} files`}
              />
            </div>
          );
        })}
      </Card>
      <Note>* Found by name only; the text inside isn't read.</Note>
      {dirty && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-line-strong bg-paper-2 px-4 py-3 animate-rise">
          <p className="flex-1 text-[12.5px] leading-snug text-ink-2">
            {noneLeft
              ? "Keep at least one format."
              : [
                  turnedOff.length > 0 &&
                    `Removes ${removes.toLocaleString()} ${removes === 1 ? "document" : "documents"} (with their favourites and tags)`,
                  turnedOn.length > 0 && "rescans to find the formats you added",
                ]
                  .filter(Boolean)
                  .join(" and ")
                  .replace(/^./, (c) => c.toUpperCase()) + "."}
          </p>
          <Button onClick={() => setDraft(saved)} disabled={busy}>
            Discard
          </Button>
          <Button tone="primary" onClick={apply} disabled={busy || noneLeft}>
            Apply
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Human description of an exclusion pattern (see filters.rs for the rules). */
function describe(pattern: string): string {
  if (pattern.startsWith("?:\\")) return "Top of every drive";
  if (/[\\:]/.test(pattern)) return "This folder and everything in it";
  return "Any folder with this name";
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
    <Section title="Excluded folders" description="Folders Paperlight never looks inside.">
      <Card>
        <div className="max-h-[300px] divide-y divide-line overflow-y-auto">
          {info.exclusions.map((p) => (
            <div key={p} className="group flex h-10 items-center gap-3 px-4">
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
              <RemoveButton title="Index this again" onClick={() => change(() => api.removeExclusion(p), true)} />
            </div>
          ))}
        </div>
        <div className="flex gap-2 bg-paper-2 px-4 py-3">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add(pattern)}
            placeholder="Folder name (build) or full path (D:\Archive)"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-sheet px-2.5 text-[12.5px] text-ink outline-none placeholder:text-pencil focus:border-ink"
          />
          <Button onClick={() => add(pattern)} disabled={!pattern.trim()}>
            Add
          </Button>
          <Button onClick={choose}>Choose folder…</Button>
        </div>
      </Card>
      <Note>
        The Recycle Bin and folders whose names start with $ or a dot are always skipped. You can
        also right-click any document and choose Exclude folder.
      </Note>
    </Section>
  );
}

function Appearance() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <Section title="Appearance">
      <Card>
        <Row title="Theme" hint="Match Windows follows your light or dark mode setting.">
          <div className="flex rounded-lg bg-paper-2 p-0.5">
            {THEMES.map(({ mode, label, icon: Icon }) => (
              <button
                type="button"
                key={mode}
                onClick={() => setTheme(mode)}
                aria-pressed={theme === mode}
                className={clsx(
                  "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition-colors",
                  theme === mode
                    ? "bg-sheet font-medium text-ink shadow-[0_0_0_1px_var(--line),0_1px_2px_rgb(0_0_0/0.06)]"
                    : "text-graphite hover:text-ink",
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Card>
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
      <Card>
        <Row
          title="Start with Windows"
          hint="Starts hidden in the tray and keeps the index current. About 6 MB of memory."
        >
          <Switch checked={info.autostart} onChange={setAutostart} label="Start with Windows" />
        </Row>
        <Row
          title="Quick search from any app"
          hint={
            info.hotkey
              ? "Alt+Space is used when free, otherwise Ctrl+Shift+Space or Ctrl+Alt+P."
              : "Alt+Space, Ctrl+Shift+Space and Ctrl+Alt+P are all taken by other apps."
          }
        >
          <Kbd className="h-6 px-2 text-[12px] text-ink-2">{info.hotkey ?? "Unavailable"}</Kbd>
        </Row>
      </Card>
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
    <Section title="Index" description="Rescans only write what changed. The live watcher normally makes them unnecessary.">
      <Card>
        <dl className="grid grid-cols-3 divide-x divide-line">
          <Stat label="Documents" value={(stats?.total ?? 0).toLocaleString()} />
          <Stat label="Index on disk" value={formatSize(info.indexBytes)} />
          <Stat
            label="Last full sync"
            value={overview?.lastScanAt ? formatRelative(overview.lastScanAt) : "Never"}
          />
        </dl>
        {confirmReset ? (
          <div className="bg-paper-2 px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Empty the index and scan again from scratch? Favourites, tags on documents and the
              open history are cleared. Locations, exclusions and tag names are kept. Your files
              are not touched.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setConfirmReset(false)}>Cancel</Button>
              <Button
                tone="danger"
                onClick={() => {
                  setConfirmReset(false);
                  change(() => api.resetIndex());
                }}
              >
                Reset index
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 px-4 py-3">
            <Button onClick={startScan} disabled={scanning}>
              {scanning ? "Scanning…" : "Rescan now"}
            </Button>
            <Button onClick={() => setConfirmReset(true)} disabled={scanning}>
              Reset index…
            </Button>
          </div>
        )}
      </Card>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-[12px] text-pencil">{label}</dt>
      <dd className="mt-0.5 font-display text-[17px] font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function About() {
  const setOnboarding = useUi((s) => s.setOnboarding);
  const toast = useUi((s) => s.toast);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

  const visit = (page: Parameters<typeof api.openWebsite>[0]) =>
    api.openWebsite(page).catch((e) => toast(String(e), "error"));

  return (
    <Section title="About">
      <Card>
        <Row
          icon={
            <IconBox>
              <Mark className="size-[18px]" />
            </IconBox>
          }
          title={`Paperlight ${version}`}
          hint="Every document on this PC, one search away. Free and open source (MIT)."
        >
          <Button onClick={() => setOnboarding(true)}>Show welcome screens</Button>
        </Row>
        <Row
          icon={
            <IconBox>
              <GitHubMark className="size-4" />
            </IconBox>
          }
          title="Made by webKing021"
          hint="See my other projects on GitHub, or get in touch."
        >
          <Button onClick={() => visit("author")}>
            GitHub profile
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </Button>
        </Row>
        <Row
          icon={
            <IconBox>
              <Download className="size-4" strokeWidth={1.7} />
            </IconBox>
          }
          title="Updates and feedback"
          hint="Download new versions, report a problem or suggest an idea."
        >
          <Button onClick={() => visit("releases")}>Releases</Button>
          <Button onClick={() => visit("issues")}>Report an issue</Button>
          <Button onClick={() => visit("repo")}>
            Source code
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </Button>
        </Row>
      </Card>
    </Section>
  );
}

/** GitHub's mark (Octicons, MIT), drawn in the current text colour. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
