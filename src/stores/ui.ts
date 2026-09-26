import { create } from "zustand";
import type { SortKey } from "../lib/api";
import type { FileKind } from "../lib/fileKinds";

export type ThemeMode = "system" | "light" | "dark";

export type View =
  | { type: "overview" }
  | { type: "all" }
  | { type: "recent" }
  | { type: "opened" }
  | { type: "favourites" }
  | { type: "duplicates" }
  | { type: "storage" }
  | { type: "settings" }
  | { type: "kind"; kind: FileKind }
  | { type: "tag"; id: number };

export interface Sort {
  key: SortKey;
  ascending: boolean;
}

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface UiState {
  theme: ThemeMode;
  view: View;
  query: string;
  /** Sort for browsing (search results are always ranked by relevance). */
  sort: Sort;
  setSort: (sort: Sort) => void;
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  setView: (view: View) => void;
  setQuery: (query: string) => void;
  /** Id of the document selected in the list (drives the details panel). */
  selectedId: number | null;
  setSelectedId: (id: number | null) => void;
  detailsOpen: boolean;
  toggleDetails: () => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  /** Bucket (document type) chosen on the overview. */
  bucket: FileKind;
  setBucket: (bucket: FileKind) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;
const DETAILS_KEY = "paperlight.details";
const SIDEBAR_KEY = "paperlight.sidebar";

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore
  }
}

const THEME_KEY = "paperlight.theme";

function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {
    // storage unavailable: fall back to system theme
  }
  return "system";
}

export const useUi = create<UiState>((set, get) => ({
  theme: loadTheme(),
  view: { type: "overview" },
  query: "",
  sort: { key: "modified", ascending: false },
  setSort: (sort) => set({ sort }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
    set({ theme });
  },
  cycleTheme: () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(get().theme) + 1) % order.length];
    get().setTheme(next);
  },
  setView: (view) => set({ view }),
  setQuery: (query) => set({ query }),
  selectedId: null,
  setSelectedId: (selectedId) => set({ selectedId }),
  detailsOpen: loadFlag(DETAILS_KEY, true),
  toggleDetails: () => {
    const detailsOpen = !get().detailsOpen;
    saveFlag(DETAILS_KEY, detailsOpen);
    set({ detailsOpen });
  },
  bucket: "pdf",
  setBucket: (bucket) => set({ bucket }),
  sidebarOpen: loadFlag(SIDEBAR_KEY, true),
  toggleSidebar: () => {
    const sidebarOpen = !get().sidebarOpen;
    saveFlag(SIDEBAR_KEY, sidebarOpen);
    set({ sidebarOpen });
  },
  toasts: [],
  toast: (text, tone = "info") => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 5000 : 2500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function sameView(a: View, b: View): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "kind" && b.type === "kind") return a.kind === b.kind;
  if (a.type === "tag" && b.type === "tag") return a.id === b.id;
  return true;
}
