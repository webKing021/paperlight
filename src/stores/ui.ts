import { create } from "zustand";
import type { SortKey } from "../lib/api";
import type { FileKind } from "../lib/fileKinds";

export type ThemeMode = "system" | "light" | "dark";

export type View =
  | { type: "all" }
  | { type: "recent" }
  | { type: "opened" }
  | { type: "favourites" }
  | { type: "duplicates" }
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
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

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
  view: { type: "all" },
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
