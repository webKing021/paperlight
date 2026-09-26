import clsx from "clsx";

/** An on/off switch, like the ones in Windows Settings. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  /** Accessible name when there is no visible label next to it. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-150 disabled:opacity-40",
        checked ? "border-ink bg-ink" : "border-line-strong bg-paper-2 hover:border-pencil",
      )}
    >
      <span
        className={clsx(
          "absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-[left,background-color] duration-150 ease-out-soft",
          checked ? "left-[19px] bg-on-ink" : "left-[3px] bg-graphite",
        )}
      />
    </button>
  );
}
