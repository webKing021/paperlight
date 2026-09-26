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
  favourites: number;
  opened: number;
}

export type TagColor = "brick" | "slate" | "moss" | "ochre" | "plum" | "teal" | "graphite";

export const TAG_COLORS: TagColor[] = ["brick", "slate", "moss", "ochre", "plum", "teal", "graphite"];

export interface Tag {
  id: number;
  name: string;
  color: TagColor;
  count: number;
}

export interface Overview {
  stats: Stats;
  roots: Root[];
  lastScanAt: number | null;
  scanning: boolean;
  /** Folders watched live, or null when not watching. */
  watching: number | null;
  /** Documents whose text is still waiting to be read. */
  contentPending: number;
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
  tags: number[];
  /** Matching passage from the text (search only), words marked with \u0002 … \u0003. */
  snippet?: string;
}

export interface FileDetails {
  file: FileRow;
  excerpt: string | null;
  /** 0 = waiting to be read, 1 = read, 2 = not a readable format / too large, 3 = failed. */
  textStatus: number;
}

export interface Page {
  total: number;
  offset: number;
  items: FileRow[];
}

export type SortKey = "modified" | "name" | "size" | "opened";

/** Which slice of the index a view shows; shared by browsing and searching. */
export interface ViewFilter {
  kind?: FileKind;
  modifiedAfter?: number;
  favourites?: boolean;
  opened?: boolean;
  tagId?: number;
}

export interface ListQuery extends ViewFilter {
  sort?: SortKey;
  ascending?: boolean;
  offset?: number;
  limit?: number;
}

export interface SearchQuery extends ViewFilter {
  text: string;
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

export interface ShellInfo {
  /** Global quick-search hotkey, e.g. "Alt+Space"; null if none could be registered. */
  hotkey: string | null;
  autostart: boolean;
}

export const api = {
  getOverview: () => invoke<Overview>("get_overview"),
  listFiles: (query: ListQuery) => invoke<Page>("list_files", { query }),
  searchFiles: (query: SearchQuery) => invoke<Page>("search_files", { query }),
  openFile: (id: number) => invoke<void>("open_file", { id }),
  revealFile: (id: number) => invoke<void>("reveal_file", { id }),
  fileDetails: (id: number) => invoke<FileDetails>("file_details", { id }),
  previewPdf: (id: number) => invoke<ArrayBuffer>("preview_pdf", { id }),
  addRoot: (path: string) => invoke<Root>("add_root", { path }),
  removeRoot: (id: number) => invoke<void>("remove_root", { id }),
  setRootEnabled: (id: number, enabled: boolean) =>
    invoke<void>("set_root_enabled", { id, enabled }),
  listExclusions: () => invoke<string[]>("list_exclusions"),
  addExclusion: (pattern: string) => invoke<void>("add_exclusion", { pattern }),
  removeExclusion: (pattern: string) => invoke<void>("remove_exclusion", { pattern }),
  startScan: () => invoke<boolean>("start_scan"),
  setFavourite: (id: number, on: boolean) => invoke<void>("set_favourite", { id, on }),
  listTags: () => invoke<Tag[]>("list_tags"),
  createTag: (name: string) => invoke<Tag>("create_tag", { name }),
  updateTag: (id: number, name: string, color: TagColor) =>
    invoke<void>("update_tag", { id, name, color }),
  deleteTag: (id: number) => invoke<void>("delete_tag", { id }),
  setFileTag: (fileId: number, tagId: number, on: boolean) =>
    invoke<void>("set_file_tag", { fileId, tagId, on }),
  cancelScan: () => invoke<void>("cancel_scan"),
  shellInfo: () => invoke<ShellInfo>("shell_info"),
  setAutostart: (on: boolean) => invoke<void>("set_autostart", { on }),
  hideQuick: () => invoke<void>("hide_quick"),
  showMain: () => invoke<void>("show_main"),
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
  onContentProgress: (cb: (pending: number) => void): Promise<UnlistenFn> =>
    listen<{ pending: number }>("content-progress", (e) => cb(e.payload.pending)),
  onScanError: (cb: (message: string) => void): Promise<UnlistenFn> =>
    listen<string>("scan-error", (e) => cb(e.payload)),
};
