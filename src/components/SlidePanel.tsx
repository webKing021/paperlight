import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type PanelState = "open" | "rail" | "hidden";

/**
 * A side panel that slides between open, a slim rail (collapsed) and hidden by animating its
 * width. The content keeps its full width and is clipped, so it slides rather than squashes;
 * it is unmounted once hidden.
 */
export function SlidePanel({
  state,
  width,
  rail,
  side,
  children,
}: {
  state: PanelState;
  width: number;
  rail: number;
  side: "left" | "right";
  children: ReactNode;
}) {
  const target = state === "open" ? width : state === "rail" ? rail : 0;
  const [mounted, setMounted] = useState(state !== "hidden");
  const [current, setCurrent] = useState(target);

  useEffect(() => {
    if (state !== "hidden") {
      setMounted(true);
      // Next frame, so a freshly mounted panel starts from its old width and animates.
      const id = requestAnimationFrame(() => setCurrent(target));
      return () => cancelAnimationFrame(id);
    }
    setCurrent(0);
    if (reducedMotion()) setMounted(false);
  }, [state, target]);

  if (!mounted) return null;
  return (
    <div
      className={clsx(
        "flex h-full shrink-0 overflow-hidden border-line transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
        side === "left" ? "border-r" : "justify-end border-l",
      )}
      style={{ width: current }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "width" && state === "hidden") {
          setMounted(false);
        }
      }}
    >
      <div className="h-full shrink-0" style={{ width }}>
        {children}
      </div>
    </div>
  );
}
