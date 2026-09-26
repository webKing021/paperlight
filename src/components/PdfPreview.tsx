import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

type PdfJs = typeof import("pdfjs-dist");

let pdfjs: Promise<PdfJs> | null = null;

/** pdf.js (~1.7 MB) is only downloaded into memory the first time a PDF is previewed. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjs;
}

/** Renders page 1 of an indexed PDF at the given CSS width. */
export function PdfPreview({ id, width }: { id: number; width: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const [lib, bytes] = await Promise.all([loadPdfJs(), api.previewPdf(id)]);
        if (cancelled) return;
        const task = lib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
        try {
          const doc = await task.promise;
          const page = await doc.getPage(1);
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          const ratio = window.devicePixelRatio || 1;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * ratio });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = `${width}px`;
          canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
          await page.render({ canvas, viewport }).promise;
          if (!cancelled) setState("ready");
        } finally {
          // Only the bitmap is kept; the parsed document is released right away.
          task.destroy();
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, width]);

  if (state === "error") return null;
  const page =
    "rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_2px_4px_rgb(0_0_0/0.04),0_12px_28px_-12px_rgb(0_0_0/0.28)]";
  return (
    <div className="relative">
      {state === "loading" && (
        <div className={`${page} dark:bg-sheet`} style={{ width, height: Math.round(width * 1.3) }} />
      )}
      <canvas ref={canvasRef} className={state === "ready" ? `block ${page} animate-fade` : "hidden"} />
    </div>
  );
}
