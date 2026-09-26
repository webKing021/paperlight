import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Folder,
  HardDrive,
  Moon,
  Plus,
  Radar,
  Search,
  ShieldCheck,
  Sun,
  SunMoon,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { FileKind } from "../lib/fileKinds";
import { useIndex } from "../stores";
import { useUi, type ThemeMode } from "../stores/ui";
import { FileIcon } from "./FileIcon";
import { Mark } from "./Mark";
import { Kbd } from "./SearchBar";
import { Switch } from "./Switch";

type Step = "welcome" | "locations" | "preferences" | "indexing";
const STEPS: Step[] = ["welcome", "locations", "preferences", "indexing"];

/** First run (or Settings → Show welcome screens): full window, one decision per screen. */
export function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");
  const setOnboarding = useUi((s) => s.setOnboarding);
  // Opened again from Settings (there is an index already): it can be left at any point, and
  // locations aren't removed from here (that drops their documents; Settings asks first).
  const [rerun] = useState(() => !!useIndex.getState().overview?.lastScanAt);
  const shell = useIndex((s) => s.shell);
  const [autostart, setAutostart] = useState(true);
  const touchedAutostart = useRef(false);

  // Coming back from Settings: start from the current choice rather than the default.
  useEffect(() => {
    if (shell && !touchedAutostart.current && useIndex.getState().overview?.lastScanAt) {
      setAutostart(shell.autostart);
    }
  }, [shell]);

  const index = STEPS.indexOf(step);
  const go = (to: Step) => setStep(to);

  return (
    <div className="flex h-full flex-col bg-paper animate-fade">
      <header className="flex h-16 shrink-0 items-center justify-between px-8">
        <div className="flex items-center gap-2.5">
          <Mark className="size-[22px]" />
          <span className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">Paperlight</span>
        </div>
        {rerun && step !== "indexing" && (
          <button
            type="button"
            onClick={() => setOnboarding(false)}
            className="ml-auto mr-6 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-graphite hover:bg-hover hover:text-ink"
          >
            <X className="size-3.5" strokeWidth={2} />
            Back to Paperlight
          </button>
        )}
        {step !== "welcome" && (
          <div className="flex items-center gap-3 text-[12px] text-pencil">
            Step {index} of 3
            <div className="flex gap-1">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={clsx(
                    "h-1 w-6 rounded-full transition-colors duration-300",
                    n <= index ? "bg-ink" : "bg-line-strong",
                  )}
                />
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div key={step} className="mx-auto flex min-h-full w-full max-w-[600px] flex-col justify-center px-8 pb-16 pt-4 animate-rise">
          {step === "welcome" && <Welcome onNext={() => go("locations")} />}
          {step === "locations" && (
            <Locations rerun={rerun} onBack={() => go("welcome")} onNext={() => go("preferences")} />
          )}
          {step === "preferences" && (
            <Preferences
              autostart={autostart}
              setAutostart={(on) => {
                touchedAutostart.current = true;
                setAutostart(on);
              }}
              onBack={() => go("locations")}
              onNext={() => go("indexing")}
            />
          )}
          {step === "indexing" && <Indexing autostart={autostart} />}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

const FAN: { kind: FileKind; rotate: number; lift: number }[] = [
  { kind: "word", rotate: -9, lift: 6 },
  { kind: "pdf", rotate: -3, lift: 0 },
  { kind: "excel", rotate: 3, lift: 0 },
  { kind: "slides", rotate: 9, lift: 6 },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: Search,
    title: "Search names, folders and the words inside",
    text: "Type part of a name or a phrase you remember. Results appear as you type.",
  },
  {
    icon: Radar,
    title: "Always up to date",
    text: "New, changed, moved and deleted documents are noticed on their own.",
  },
  {
    icon: ShieldCheck,
    title: "Private and read-only",
    text: "Nothing is uploaded, moved or renamed. Your files stay exactly where they are.",
  },
];

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div className="flex items-end gap-1" aria-hidden="true">
        {FAN.map(({ kind, rotate, lift }, i) => (
          <span
            key={kind}
            className="animate-rise"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <span className="block" style={{ transform: `translateY(${lift}px) rotate(${rotate}deg)` }}>
              <FileIcon kind={kind} size={46} />
            </span>
          </span>
        ))}
      </div>
      <h1 className="mt-8 font-display text-[34px] font-semibold leading-[1.12] tracking-[-0.025em] text-ink">
        Every document on this PC,
        <br />
        one search away.
      </h1>
      <p className="mt-3 max-w-[480px] text-[14px] leading-relaxed text-graphite">
        Paperlight keeps a list of every PDF, Word, Excel and PowerPoint file on your computer, so
        you can find any of them in a second.
      </p>

      <ul className="mt-8 flex flex-col gap-4">
        {FEATURES.map(({ icon: Icon, title, text }, i) => (
          <li
            key={title}
            className="flex gap-3.5 animate-rise"
            style={{ animationDelay: `${260 + i * 80}ms` }}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
              <Icon className="size-[18px]" strokeWidth={1.7} />
            </span>
            <span>
              <span className="block text-[13.5px] font-medium text-ink">{title}</span>
              <span className="block text-[13px] leading-relaxed text-graphite">{text}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-10">
        <Primary onClick={onNext}>
          Get started
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Primary>
      </div>
    </>
  );
}

function Locations({
  rerun,
  onBack,
  onNext,
}: {
  rerun: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const roots = useIndex((s) => s.overview?.roots ?? []);
  const refresh = useIndex((s) => s.refresh);
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
    <>
      <Title
        title="Where are your documents?"
        text="Paperlight starts with every drive in this PC. Remove any you don't need, or add specific folders instead."
      />
      <div className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
        {roots.length === 0 && (
          <div className="px-4 py-4 text-[13px] text-graphite">No locations yet. Add a folder to begin.</div>
        )}
        {roots.map((root) => {
          const drive = /^[A-Za-z]:\\$/.test(root.path) ? root.path.slice(0, 2) : null;
          return (
            <div key={root.id} className="group flex h-14 items-center gap-3.5 px-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-paper-2 text-graphite">
                {drive ? <HardDrive className="size-4" strokeWidth={1.7} /> : <Folder className="size-4" strokeWidth={1.7} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{drive ? `Local disk (${drive})` : root.path}</span>
                <span className="block text-[12px] text-pencil">{drive ? "The whole drive" : "This folder and its subfolders"}</span>
              </span>
              {!rerun && (
                <button
                  type="button"
                  title="Remove"
                  onClick={() => remove(root.id)}
                  className="flex size-7 items-center justify-center rounded-md text-pencil hover:bg-hover hover:text-ink"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={addFolder}
          className="flex h-12 w-full items-center gap-3.5 px-4 text-left text-[13px] font-medium text-ink-2 hover:bg-hover hover:text-ink"
        >
          <span className="flex size-8 items-center justify-center">
            <Plus className="size-4" strokeWidth={2} />
          </span>
          Add a folder…
        </button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <p className="mt-3 text-[12.5px] leading-relaxed text-pencil">
        Windows, Program Files, AppData, the Recycle Bin and developer folders are always skipped.
        {rerun && " To remove or pause a location, use Settings → Locations."}
      </p>

      <Nav onBack={onBack}>
        <Primary onClick={onNext} disabled={roots.length === 0}>
          Continue
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Primary>
      </Nav>
    </>
  );
}

const THEMES: { mode: ThemeMode; label: string; icon: LucideIcon }[] = [
  { mode: "system", label: "Match Windows", icon: SunMoon },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

function Preferences({
  autostart,
  setAutostart,
  onBack,
  onNext,
}: {
  autostart: boolean;
  setAutostart: (on: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const hotkey = useIndex((s) => s.shell?.hotkey);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);

  return (
    <>
      <Title title="A few preferences" text="You can change all of these later in Settings." />
      <div className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-sheet">
        <PrefRow
          title="Start with Windows"
          text="Waits quietly in the tray and keeps the list current, using about 6 MB of memory."
        >
          <Switch checked={autostart} onChange={setAutostart} label="Start with Windows" />
        </PrefRow>
        <PrefRow
          title="Quick search from any app"
          text={
            hotkey
              ? "Press the shortcut anywhere to find and open a document without switching windows."
              : "Every shortcut Paperlight could use is taken by another app right now."
          }
        >
          {hotkey && <Kbd className="h-6 px-2 text-[12px] text-ink-2">{hotkey}</Kbd>}
        </PrefRow>
        <PrefRow title="Theme">
          <div className="flex rounded-lg bg-paper-2 p-0.5">
            {THEMES.map(({ mode, label, icon: Icon }) => (
              <button
                type="button"
                key={mode}
                title={label}
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
        </PrefRow>
      </div>

      <Nav onBack={onBack}>
        <Primary onClick={onNext}>
          Start indexing
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Primary>
      </Nav>
    </>
  );
}

function Indexing({ autostart }: { autostart: boolean }) {
  const scanning = useIndex((s) => s.scanning);
  const progress = useIndex((s) => s.progress);
  const total = useIndex((s) => s.overview?.stats.total ?? 0);
  const error = useIndex((s) => s.error);
  const startScan = useIndex((s) => s.startScan);
  const setOnboarding = useUi((s) => s.setOnboarding);
  const [started, setStarted] = useState(false);
  const sawScan = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.setAutostart(autostart);
        const shell = useIndex.getState().shell;
        if (shell) useIndex.setState({ shell: { ...shell, autostart } });
      } catch {
        // Not fatal: it can be changed later in Settings or from the tray.
      }
      await startScan().catch(() => {});
      if (!cancelled) setStarted(true);
    })();
    return () => {
      cancelled = true;
    };
    // Runs once, when this screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (scanning) sawScan.current = true;
  const done = started && !scanning && (sawScan.current || !!error || total > 0);
  const found = progress?.filesFound ?? total;

  return (
    <>
      <div
        className={clsx(
          "flex size-12 items-center justify-center rounded-full transition-colors duration-300",
          done && !error ? "bg-ink text-on-ink" : "bg-paper-2 text-ink",
        )}
      >
        {done && !error ? (
          <Check className="size-6 animate-fade" strokeWidth={2.2} />
        ) : (
          <Mark className="size-6" />
        )}
      </div>
      <Title
        title={error ? "Indexing stopped" : done ? "You're all set" : "Finding your documents…"}
        text={
          error
            ? error
            : done
              ? "Paperlight now keeps this list current by itself. The text inside documents is read in the background, so searching inside them gets better over the next few minutes."
              : "You can start using Paperlight right away. Documents appear as they're found."
        }
      />

      <div className="mt-7 rounded-lg border border-line bg-sheet px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-display text-[32px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-ink">
            {found.toLocaleString()}
          </span>
          <span className="text-[12.5px] text-pencil">
            {progress ? `${progress.dirsScanned.toLocaleString()} folders checked` : ""}
          </span>
        </div>
        <div className="mt-1 text-[13px] text-graphite">{done ? "documents found" : "documents found so far"}</div>
        <div className="relative mt-4 h-1 overflow-hidden rounded-full bg-paper-2">
          {done ? (
            <div className="h-full w-full rounded-full bg-ink" />
          ) : (
            <div className="h-full w-1/4 animate-[runner_1.4s_ease-in-out_infinite] rounded-full bg-lamp" />
          )}
        </div>
        {!done && (
          <div className="mt-2 h-4 truncate text-[12px] text-pencil" title={progress?.currentDir}>
            {progress?.currentDir}
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <Primary onClick={() => setOnboarding(false)}>
          {done ? "Open Paperlight" : "Continue in the background"}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Primary>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function Title({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h1 className="mt-5 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink first:mt-0">
        {title}
      </h1>
      <p className="mt-2 max-w-[500px] text-[14px] leading-relaxed text-graphite">{text}</p>
    </>
  );
}

function PrefRow({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[60px] items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-ink">{title}</div>
        {text && <div className="mt-0.5 text-[12.5px] leading-snug text-pencil">{text}</div>}
      </div>
      {children}
    </div>
  );
}

function Nav({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="mt-10 flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        className="flex h-10 items-center gap-1.5 rounded-md px-3 text-[13.5px] font-medium text-graphite hover:bg-hover hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>
      {children}
    </div>
  );
}

function Primary({
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
      className="group flex h-10 items-center gap-2 rounded-md bg-ink px-5 text-[13.5px] font-medium text-on-ink transition-opacity hover:opacity-90 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
