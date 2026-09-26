import clsx from "clsx";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useUi } from "../stores/ui";

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
          className={clsx(
            "pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] shadow-lg",
            t.tone === "error"
              ? "border-red-500/30 bg-surface text-red-600 dark:text-red-400"
              : "border-line bg-surface text-fg",
          )}
        >
          {t.tone === "error" ? (
            <CircleAlert className="size-4 shrink-0" />
          ) : (
            <CircleCheck className="size-4 shrink-0 text-emerald-500" />
          )}
          {t.text}
        </button>
      ))}
    </div>
  );
}
