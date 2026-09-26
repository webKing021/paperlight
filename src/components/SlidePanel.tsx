import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A side panel that slides open and closed by animating its width. The content keeps its full
 * width and is clipped, so it slides rather than squashes; it is unmounted once closed, so a
 * closed panel costs nothing.
 */
export function SlidePanel({
  open,
  width,
  side,
  children,
}: {
  open: boolean;
  width: number;
  side: "left" | "right";
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: mount at width 0 first, then grow, so the transition runs.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    if (reducedMotion()) setMounted(false);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={clsx(
        "flex h-full shrink-0 overflow-hidden transition-[width,opacity] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        side === "right" && "justify-end",
        shown ? "opacity-100" : "opacity-60",
      )}
      style={{ width: shown ? width : 0 }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width" && !open) setMounted(false);
      }}
    >
      <div className="h-full shrink-0" style={{ width }}>
        {children}
      </div>
    </div>
  );
}
