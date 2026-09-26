import clsx from "clsx";
import type { TagColor } from "../lib/api";

/** A tag's colour as a small dot. */
export function TagDot({ color, className }: { color: TagColor; className?: string }) {
  return (
    <span
      className={clsx("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ background: `var(--tag-${color})` }}
    />
  );
}
