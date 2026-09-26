import clsx from "clsx";
import { useUi } from "../stores/ui";

/** Small inverted notes in the corner — ink on paper flipped, like a printed label. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-10 right-5 z-50 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <button
          type="button"
          key={t.id}
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex max-w-sm items-stretch overflow-hidden rounded-md bg-ink text-left text-[12.5px] text-on-ink shadow-[0_10px_30px_-12px_rgba(28,27,24,0.5)]"
        >
          <span className={clsx("w-[3px] shrink-0", t.tone === "error" ? "bg-danger" : "bg-lamp")} />
          <span className="px-3 py-2">{t.text}</span>
        </button>
      ))}
    </div>
  );
}
