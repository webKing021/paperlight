import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { useUi } from "./ui";

/**
 * In-app updates. New versions are published on GitHub Releases with a signed latest.json;
 * Paperlight reads it once per launch and at most twice a day after that (one small request,
 * no timers while idle) and downloads nothing until the user chooses "Update now".
 */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "current" }
  | { state: "available"; version: string; notes: string }
  | { state: "downloading"; version: string; notes: string; received: number; total: number | null }
  | { state: "installing"; version: string; notes: string }
  | { state: "error"; message: string };

interface UpdateState {
  status: UpdateStatus;
  /** When the last successful check finished (ms). */
  checkedAt: number | null;
  /** Look for updates on launch, and when the window comes back (at most every 12 hours). */
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** The "new version" dialog (opens by itself once per version). */
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** `manual` checks report "up to date" and errors; automatic ones stay quiet. */
  checkNow: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

const AUTO_KEY = "paperlight.updates.auto";
const CHECKED_KEY = "paperlight.updates.checkedAt";
/** The last version whose dialog was shown, so "Later" isn't asked again on every launch. */
const SEEN_KEY = "paperlight.updates.seen";
const INTERVAL = 12 * 3_600_000;
/** Let the launch sync and first paint go first. */
const LAUNCH_DELAY = 20_000;

/** The update found by the last check (holds a native resource, so kept out of the store). */
let pending: Update | null = null;
let checking = false;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export const useUpdates = create<UpdateState>((set, get) => ({
  status: { state: "idle" },
  checkedAt: Number(load(CHECKED_KEY)) || null,
  auto: load(AUTO_KEY) !== "0",
  setAuto: (auto) => {
    save(AUTO_KEY, auto ? "1" : "0");
    set({ auto });
    if (auto) autoCheck();
  },
  dialogOpen: false,
  openDialog: () => {
    const { status } = get();
    if ("version" in status) {
      save(SEEN_KEY, status.version);
      set({ dialogOpen: true });
    }
  },
  closeDialog: () => set({ dialogOpen: false }),
  checkNow: async (manual = false) => {
    const busy = get().status.state;
    if (checking || busy === "downloading" || busy === "installing") return;
    checking = true;
    // Background checks keep showing what is known (no flicker of the sidebar entry).
    if (manual) set({ status: { state: "checking" } });
    try {
      const update = await check();
      await pending?.close().catch(() => {});
      pending = update;
      const checkedAt = Date.now();
      save(CHECKED_KEY, String(checkedAt));
      if (!update) {
        set({ checkedAt, status: { state: "current" } });
        return;
      }
      set({ checkedAt, status: { state: "available", version: update.version, notes: update.body ?? "" } });
      // Announce each new version once; after that the sidebar entry keeps it in reach.
      if (manual || load(SEEN_KEY) !== update.version) get().openDialog();
    } catch (e) {
      // Offline or GitHub unreachable: only worth mentioning when the user asked.
      if (manual) set({ status: { state: "error", message: describe(e) } });
    } finally {
      checking = false;
    }
  },
  install: async () => {
    const update = pending;
    if (!update) {
      // Nothing downloadable behind the offer (e.g. it was withdrawn): look again instead.
      set({ status: { state: "idle" }, dialogOpen: false });
      useUi.getState().toast("That update is no longer available. Checking again…", "error");
      get().checkNow(true);
      return;
    }
    const { version } = update;
    const notes = update.body ?? "";
    set({ status: { state: "downloading", version, notes, received: 0, total: null } });
    try {
      let received = 0;
      let total: number | null = null;
      let shown = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          // Chunks are small; re-render about every 1% rather than per chunk.
          if (total === null || received - shown >= total / 100) {
            shown = received;
            set({ status: { state: "downloading", version, notes, received, total } });
          }
        } else {
          set({ status: { state: "installing", version, notes } });
        }
      });
      // On Windows the installer closes Paperlight and reopens it; this covers the rest.
      await relaunch();
    } catch (e) {
      // Keep the offer open so "Update now" can be tried again.
      set({ status: { state: "available", version, notes } });
      useUi.getState().toast(describe(e), "error");
    }
  },
}));

function describe(e: unknown): string {
  const text = String(e).replace(/^Error:\s*/, "");
  return text ? `Couldn't update: ${text}` : "Couldn't reach the update server.";
}

/** Checks in the background when automatic checks are on and the last one is old enough. */
export function autoCheck() {
  const { auto, checkedAt, checkNow } = useUpdates.getState();
  if (auto && (!checkedAt || Date.now() - checkedAt > INTERVAL)) checkNow();
}

/** Main window only: a check shortly after launch, then when the window comes back. */
export function wireUpdates() {
  const timer = setTimeout(() => {
    const { auto, checkNow } = useUpdates.getState();
    if (auto) checkNow();
  }, LAUNCH_DELAY);
  window.addEventListener("focus", autoCheck);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", autoCheck);
  };
}
