import { create } from "zustand";
import { api, events, type Overview, type ScanProgress, type ScanSummary } from "../lib/api";

interface IndexState {
  overview: Overview | null;
  scanning: boolean;
  progress: ScanProgress | null;
  lastSummary: ScanSummary | null;
  error: string | null;
  /** Bumped whenever the index content changes so file lists reload. */
  revision: number;
  refresh: () => Promise<void>;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
}

export const useIndex = create<IndexState>((set, get) => ({
  overview: null,
  scanning: false,
  progress: null,
  lastSummary: null,
  error: null,
  revision: 0,

  refresh: async () => {
    try {
      const overview = await api.getOverview();
      set({ overview, scanning: overview.scanning || get().scanning });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  startScan: async () => {
    set({ error: null });
    const started = await api.startScan();
    if (started) set({ scanning: true, progress: null });
  },

  cancelScan: async () => {
    await api.cancelScan();
  },
}));

let wired = false;

/** Subscribes the store to backend scan events. Safe to call more than once. */
export function wireIndexEvents() {
  if (wired) return;
  wired = true;
  const { refresh } = useIndex.getState();
  let lastRefresh = 0;

  events.onScanStarted(() => useIndex.setState({ scanning: true, progress: null, error: null }));
  events.onScanProgress((progress) => {
    useIndex.setState({ scanning: true, progress });
    // Keep sidebar counts moving during long scans without hammering the DB.
    const now = Date.now();
    if (now - lastRefresh > 1500) {
      lastRefresh = now;
      refresh().then(() => useIndex.setState((s) => ({ revision: s.revision + 1 })));
    }
  });
  events.onScanFinished((summary) => {
    useIndex.setState((s) => ({
      scanning: false,
      progress: null,
      lastSummary: summary,
      revision: s.revision + 1,
    }));
    refresh();
  });
  events.onScanError((message) => {
    useIndex.setState({ scanning: false, progress: null, error: message });
    refresh();
  });
  refresh();
}
