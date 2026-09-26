import type { FileKind } from "../lib/fileKinds";

const COLOR: Record<FileKind, string> = {
  pdf: "var(--pdf)",
  word: "var(--word)",
  excel: "var(--excel)",
  slides: "var(--slides)",
};

const BADGE: Record<FileKind, string> = { pdf: "PDF", word: "DOC", excel: "XLS", slides: "PPT" };

/**
 * A document icon: a page with a folded corner and a badge in the type's colour, like the
 * icons people know from Explorer. Short extensions (csv, rtf, odt…) name themselves.
 */
export function FileIcon({
  kind,
  ext,
  size = 30,
  className,
}: {
  kind: FileKind;
  ext?: string;
  size?: number;
  className?: string;
}) {
  const label = ext && ext.length <= 3 ? ext.toUpperCase() : BADGE[kind];
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M8.5 2.5h11L26.5 9.5v19a1.5 1.5 0 0 1-1.5 1.5H8.5A1.5 1.5 0 0 1 7 28.5v-24.5a1.5 1.5 0 0 1 1.5-1.5z"
        fill="var(--sheet)"
        stroke="var(--line-strong)"
      />
      <path d="M19.5 2.5v5.5a1.5 1.5 0 0 0 1.5 1.5h5.5" fill="var(--paper-2)" stroke="var(--line-strong)" />
      <path d="M11 9.5h5M11 12.5h11" stroke="var(--line-strong)" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="3" y="16" width="20" height="10" rx="2" fill={COLOR[kind]} />
      <text
        x="13"
        y="23.4"
        textAnchor="middle"
        fontSize="6.6"
        fontWeight="700"
        letterSpacing="0.2"
        fill="#fff"
        fontFamily="Segoe UI Variable Text, Segoe UI, sans-serif"
      >
        {label}
      </text>
    </svg>
  );
}

/** The small, badge-less version for navigation: a page outline in the type's colour. */
export function KindGlyph({ kind, className }: { kind: FileKind; className?: string }) {
  const color = COLOR[kind];
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        d="M4 1.75h5.25L12.75 5.25v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z"
        fill={color}
        fillOpacity="0.14"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9.25 1.75v3.5h3.5" fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
