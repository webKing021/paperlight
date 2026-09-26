import clsx from "clsx";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type PanelState = "open" | "rail" | "hidden";

const Settled = createContext(true);

/** False while the surrounding panel is sliding: heavy work (PDF rendering) should wait. */
export const usePanelSettled = () => useContext(Settled);

/**
 * A side panel that slides between open, a slim rail and hidden by animating its width.
 * The frame is always in the layout, so every change animates from where it is (also when
 * reversed halfway). The content keeps its full width and is clipped, so it slides rather
 * than squashes, and it is unmounted once hidden.
 */
export function SlidePanel({
  state,
  width,
  rail = 0,
  side,
  children,
}: {
  state: PanelState;
  width: number;
  rail?: number;
  side: "left" | "right";
  children: ReactNode;
}) {
  const target = state === "open" ? width : state === "rail" ? rail : 0;
  const [mounted, setMounted] = useState(state !== "hidden");
  const [moving, setMoving] = useState(false);
  const last = useRef(target);

  useEffect(() => {
    if (last.current === target) return;
    last.current = target;
    if (state !== "hidden") setMounted(true);
    if (reducedMotion()) {
      if (state === "hidden") setMounted(false);
      return;
    }
    setMoving(true);
  }, [state, target]);
  // Also true for the render in which the target changes, before the effect above has run.
  const animating = moving || last.current !== target;

  return (
    <div
      className={clsx(
        "flex h-full shrink-0 overflow-hidden transition-[width] duration-[280ms] ease-out-soft motion-reduce:transition-none",
        side === "right" && "justify-end",
        // The edge line belongs to the frame, so the rail keeps it; gone once fully hidden.
        (state !== "hidden" || animating) && (side === "left" ? "border-r border-line" : "border-l border-line"),
        animating && "will-change-[width]",
      )}
      style={{ width: target }}
      onTransitionEnd={(e) => {
        if (e.target !== e.currentTarget || e.propertyName !== "width") return;
        setMoving(false);
        if (state === "hidden") setMounted(false);
      }}
    >
      {mounted && (
        <div
          className={clsx(
            "h-full shrink-0 transition-opacity duration-200",
            state === "hidden" && "opacity-0",
          )}
          style={{ width }}
        >
          <Settled.Provider value={!animating}>{children}</Settled.Provider>
        </div>
      )}
    </div>
  );
}
