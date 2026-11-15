import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { IS_WINDOWS } from "../lib/platform";
import { useUi } from "./ui";

/**
 * In-app updates. New versions are published on GitHub Releases with a signed latest.json;
 * Paperlight reads it a few seconds after each launch and at most twice a day after that (one
 * small request, no timers while idle) and downloads nothing until the user chooses "Update now".
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
  /** The "new version" dialog (opens by itself once each time Paperlight is started). */
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** `manual` checks report "up to date" and errors; automatic ones stay quiet. */
  checkNow: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

const AUTO_KEY = "paperlight.updates.auto";
const CHECKED_KEY = "paperlight.updates.checkedAt";
const INTERVAL = 12 * 3_600_000;
/** Let the first paint go first. The check is one small request, so it need not wait long. */
const LAUNCH_DELAY = 3_000;

/** The update found by the last check (holds a native resource, so kept out of the store). */
let pending: Update | null = null;
let checking = false;
/** "Check for updates" was pressed while a background check was still running. */
let askedMeanwhile = false;
/**
 * The version this launch has already announced with the dialog. Each start of Paperlight
 * announces a waiting update once; "Later" then leaves only the sidebar entry until the next
 * start. (It used to be once per version for good, so an update put off once was easy to miss.)
 */
let announced: string | null = null;

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
      announced = status.version;
      set({ dialogOpen: true });
    }
  },
  closeDialog: () => set({ dialogOpen: false }),
  checkNow: async (manual = false) => {
    const busy = get().status.state;
    if (busy === "downloading" || busy === "installing") return;
    if (checking) {
      // A background check is already on its way: let it answer as the manual one would.
      if (manual) {
        askedMeanwhile = true;
        set({ status: { state: "checking" } });
      }
      return;
    }
    checking = true;
    // Background checks keep showing what is known (no flicker of the sidebar entry).
    if (manual) set({ status: { state: "checking" } });
    try {
      const update = await check();
      manual = manual || askedMeanwhile;
      await pending?.close().catch(() => {});
      pending = update;
      const checkedAt = Date.now();
      save(CHECKED_KEY, String(checkedAt));
      if (!update) {
        set({ checkedAt, status: { state: "current" } });
        return;
      }
      set({ checkedAt, status: { state: "available", version: update.version, notes: update.body ?? "" } });
      // Announce it once per launch; after that the sidebar entry keeps it in reach.
      if (manual || announced !== update.version) get().openDialog();
    } catch (e) {
      // Offline or GitHub unreachable: only worth mentioning when the user asked.
      if (manual || askedMeanwhile) set({ status: { state: "error", message: describe(e) } });
      else if (get().status.state === "checking") set({ status: { state: "idle" } });
    } finally {
      checking = false;
      askedMeanwhile = false;
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
  if (!IS_WINDOWS) return; // no in-app updater on Linux yet (see Settings → About)
  const { auto, checkedAt, checkNow } = useUpdates.getState();
  if (auto && (!checkedAt || Date.now() - checkedAt > INTERVAL)) checkNow();
}

/** Main window only: a check shortly after launch, then when the window comes back. */
export function wireUpdates() {
  if (!IS_WINDOWS) return () => {};
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
