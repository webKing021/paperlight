// Typed wrappers around the Rust commands and events (see src-tauri/src/commands.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileKind } from "./fileKinds";

export interface Root {
  id: number;
  path: string;
  enabled: boolean;
}

export interface Stats {
  total: number;
  totalSize: number;
  byKind: Partial<Record<FileKind, number>>;
}

export interface Overview {
  stats: Stats;
  roots: Root[];
  lastScanAt: number | null;
  scanning: boolean;
  /** Folders watched live, or null when not watching. */
  watching: number | null;
}

export interface IndexChange {
  added: number;
  updated: number;
  removed: number;
}

export interface FileRow {
  id: number;
  path: string;
  name: string;
  ext: string;
  kind: FileKind;
  dir: string;
  size: number;
  createdAt: number | null;
  modifiedAt: number | null;
  isFavourite: boolean;
  openCount: number;
  lastOpenedAt: number | null;
}

export interface Page {
  total: number;
  offset: number;
  items: FileRow[];
}

export type SortKey = "modified" | "name" | "size";

export interface ListQuery {
  kind?: FileKind;
  modifiedAfter?: number;
  sort?: SortKey;
  ascending?: boolean;
  offset?: number;
  limit?: number;
}

export interface SearchQuery {
  text: string;
  kind?: FileKind;
  modifiedAfter?: number;
  offset?: number;
  limit?: number;
}

export interface ScanProgress {
  root: string;
  dirsScanned: number;
  filesFound: number;
  currentDir: string;
}

export interface ScanSummary {
  filesFound: number;
  dirsScanned: number;
  added: number;
  updated: number;
  removed: number;
  errors: number;
  durationMs: number;
  cancelled: boolean;
}

export const api = {
  getOverview: () => invoke<Overview>("get_overview"),
  listFiles: (query: ListQuery) => invoke<Page>("list_files", { query }),
  searchFiles: (query: SearchQuery) => invoke<Page>("search_files", { query }),
  openFile: (id: number) => invoke<void>("open_file", { id }),
  revealFile: (id: number) => invoke<void>("reveal_file", { id }),
  addRoot: (path: string) => invoke<Root>("add_root", { path }),
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),
  setRootEnabled: (id: number, enabled: boolean) =>
    invoke<void>("set_root_enabled", { id, enabled }),
  listExclusions: () => invoke<string[]>("list_exclusions"),
  addExclusion: (pattern: string) => invoke<void>("add_exclusion", { pattern }),
  removeExclusion: (pattern: string) => invoke<void>("remove_exclusion", { pattern }),
  startScan: () => invoke<boolean>("start_scan"),
  cancelScan: () => invoke<void>("cancel_scan"),
};

export const events = {
  /** Payload is `true` for automatic low-priority syncs, `false` for user-started scans. */
  onScanStarted: (cb: (background: boolean) => void): Promise<UnlistenFn> =>
    listen<boolean>("scan-started", (e) => cb(e.payload)),
  onScanProgress: (cb: (p: ScanProgress) => void): Promise<UnlistenFn> =>
    listen<ScanProgress>("scan-progress", (e) => cb(e.payload)),
  onScanFinished: (cb: (s: ScanSummary) => void): Promise<UnlistenFn> =>
    listen<ScanSummary>("scan-finished", (e) => cb(e.payload)),
  onIndexChanged: (cb: (change: IndexChange) => void): Promise<UnlistenFn> =>
    listen<IndexChange>("index-changed", (e) => cb(e.payload)),
  onScanError: (cb: (message: string) => void): Promise<UnlistenFn> =>
    listen<string>("scan-error", (e) => cb(e.payload)),
};
