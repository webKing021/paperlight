import type { Root } from "./api";

const trim = (p: string) => p.replace(/\\+$/, "");

/** True when `child` is `parent` or lies below it (case-insensitive, like Windows). */
export function isWithin(child: string, parent: string): boolean {
  const c = trim(child).toLowerCase();
  const p = trim(parent).toLowerCase();
  return c === p || c.startsWith(`${p}\\`);
}

/**
 * Folders that could be excluded for a document in `dir`: its own folder and every parent
 * down to (not including) the location it belongs to, outermost first.
 * "D:\DevTools\gh\share" in location "D:\" → ["D:\DevTools", "D:\DevTools\gh", "D:\DevTools\gh\share"].
 */
export function excludableFolders(dir: string, roots: Root[]): string[] {
  const root = roots
    .filter((r) => isWithin(dir, r.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!root) return [];
  const stop = trim(root.path).length;
  const out: string[] = [];
  let current = trim(dir);
  while (current.length > stop) {
    out.push(current);
    const cut = current.lastIndexOf("\\");
    if (cut < 0) break;
    current = current.slice(0, cut);
  }
  return out.reverse();
}

/** Splits a path into the parent part and the last folder name, for display. */
export function splitLast(path: string): [string, string] {
  const p = trim(path);
  const cut = p.lastIndexOf("\\");
  return cut < 0 ? ["", p] : [p.slice(0, cut + 1), p.slice(cut + 1)];
}
