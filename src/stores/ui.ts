import { create } from "zustand";
import type { FileKind } from "../lib/fileKinds";

export type ThemeMode = "system" | "light" | "dark";

export type View =
  | { type: "all" }
  | { type: "recent" }
  | { type: "opened" }
  | { type: "favourites" }
  | { type: "duplicates" }
  | { type: "kind"; kind: FileKind };

interface UiState {
  theme: ThemeMode;
  view: View;
  query: string;
  setTheme: (theme: ThemeMode) => void;
  cycleTheme: () => void;
  setView: (view: View) => void;
  setQuery: (query: string) => void;
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
  view: { type: "all" },
  query: "",
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
}));

export function sameView(a: View, b: View): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "kind" && b.type === "kind") return a.kind === b.kind;
  return true;
}
