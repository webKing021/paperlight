import { create } from "zustand";
import {
  api,
  events,
  type Overview,
  type ScanProgress,
  type ScanSummary,
  type ShellInfo,
  type Tag,
} from "../lib/api";

interface IndexState {
  overview: Overview | null;
  scanning: boolean;
  /** True while an automatic, low-priority sync is running (shown subtly). */
  background: boolean;
  progress: ScanProgress | null;
  lastSummary: ScanSummary | null;
  error: string | null;
  /** Bumped whenever the index content changes so file lists reload. */
  revision: number;
  tags: Tag[];
  shell: ShellInfo | null;
  refresh: () => Promise<void>;
  refreshTags: () => Promise<void>;
  /** Call after changing favourites/tags: reloads lists, counts and tags. */
  touched: () => void;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
}

export const useIndex = create<IndexState>((set, get) => ({
  overview: null,
  scanning: false,
  background: false,
  progress: null,
  lastSummary: null,
  error: null,
  revision: 0,
  tags: [],
  shell: null,

  refreshTags: async () => {
    try {
      set({ tags: await api.listTags() });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  touched: () => {
    set((s) => ({ revision: s.revision + 1 }));
    get().refresh();
    get().refreshTags();
  },

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
    if (started) set({ scanning: true, background: false, progress: null });
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

  events.onScanStarted((background) =>
    useIndex.setState({ scanning: true, background, progress: null, error: null }),
  );
  events.onScanProgress((progress) => {
    useIndex.setState({ scanning: true, progress });
    // On the very first scan, fill the UI as documents are found. Later syncs are diffs and
    // only refresh once, at the end.
    const now = Date.now();
    const firstScan = !useIndex.getState().overview?.lastScanAt;
    if (firstScan && now - lastRefresh > 1500) {
      lastRefresh = now;
      refresh().then(() => useIndex.setState((s) => ({ revision: s.revision + 1 })));
    }
  });
  events.onScanFinished((summary) => {
    const changed = summary.added + summary.updated + summary.removed > 0;
    useIndex.setState((s) => ({
      scanning: false,
      background: false,
      progress: null,
      lastSummary: summary,
      revision: changed ? s.revision + 1 : s.revision,
    }));
    refresh();
  });
  // Live changes from the file watcher: refresh counts and visible lists.
  events.onIndexChanged(() => useIndex.getState().touched());
  events.onContentProgress((pending) =>
    useIndex.setState((s) =>
      s.overview ? { overview: { ...s.overview, contentPending: pending } } : {},
    ),
  );
  events.onScanError((message) => {
    useIndex.setState({ scanning: false, background: false, progress: null, error: message });
    refresh();
  });
  refresh();
  useIndex.getState().refreshTags();
  api.shellInfo().then((shell) => useIndex.setState({ shell }), () => {});
}
