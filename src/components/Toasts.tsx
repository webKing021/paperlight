import { CircleAlert, CircleCheck } from "lucide-react";
import { useUi } from "../stores/ui";

/** Small notes in the corner, above the status bar. */
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
          className="pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg bg-ink px-3.5 py-2.5 text-left text-[13px] leading-snug text-on-ink shadow-pop animate-rise"
        >
          {t.tone === "error" ? (
            <CircleAlert className="mt-px size-4 shrink-0 text-danger" strokeWidth={2} />
          ) : (
            <CircleCheck className="mt-px size-4 shrink-0 opacity-70" strokeWidth={2} />
          )}
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
