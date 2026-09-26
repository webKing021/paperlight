import clsx from "clsx";
import type { TagColor } from "../lib/api";

/** A tag's colour as a small label-tab swatch. */
export function TagDot({ color, className }: { color: TagColor; className?: string }) {
  return (
    <span
      className={clsx("inline-block size-[9px] shrink-0 rounded-[2px]", className)}
      style={{ background: `var(--tag-${color})` }}
    />
  );
}
