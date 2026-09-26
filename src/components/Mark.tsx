/** The Paperlight mark: an ink stem and a lamp-amber bowl — a "P" that is also a pool of light. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="4" y="3" width="3.4" height="18" rx="0.4" className="fill-ink" />
      <path d="M9 3a7 7 0 0 1 0 14z" className="fill-lamp" />
    </svg>
  );
}
