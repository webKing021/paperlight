import clsx from "clsx";
import { ExternalLink, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { openFile, revealFile } from "../lib/actions";
import type { FileRow } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";
import { useUi } from "../stores/ui";

/** A document row for report-style views (duplicates, storage). Click selects, double-click opens. */
export function DocRow({ row, folder }: { row: FileRow; folder?: ReactNode }) {
  const selected = useUi((s) => s.selectedId === row.id);
  const setSelectedId = useUi((s) => s.setSelectedId);
  const kind = FILE_KINDS[row.kind];

  return (
    <div
      onClick={() => setSelectedId(row.id)}
      onDoubleClick={() => openFile(row)}
      title={row.path}
      className={clsx(
        "group relative grid h-[50px] cursor-default grid-cols-[minmax(0,1fr)_112px_72px_64px] items-center gap-4 border-b border-line/60 px-5",
        selected ? "bg-lamp-wash" : "hover:bg-paper-2",
      )}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-[3px] bg-lamp" />}
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex w-11 shrink-0 items-center gap-1.5">
          <span className={clsx("h-4 w-[3px] rounded-full", kind?.swatch)} />
          <span className="font-mono text-[10.5px] uppercase text-graphite">{row.ext.slice(0, 4)}</span>
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium leading-5 text-ink">{row.name}</div>
          <div className="truncate text-[11.5px] leading-4 text-pencil">{folder ?? row.dir}</div>
        </div>
      </div>
      <span className="text-[12px] text-graphite" title={formatDateTime(row.modifiedAt)}>
        {formatRelative(row.modifiedAt)}
      </span>
      <span className="text-right font-mono text-[11.5px] tabular-nums text-graphite">
        {formatSize(row.size)}
      </span>
      <div
        className={clsx(
          "flex justify-end gap-0.5",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <RowButton title="Open" onClick={() => openFile(row)}>
          <ExternalLink className="size-[14px]" strokeWidth={1.6} />
        </RowButton>
        <RowButton title="Show in folder" onClick={() => revealFile(row)}>
          <FolderOpen className="size-[15px]" strokeWidth={1.6} />
        </RowButton>
      </div>
    </div>
  );
}

function RowButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="flex size-7 items-center justify-center rounded text-graphite hover:bg-sheet hover:text-ink"
    >
      {children}
    </button>
  );
}

/** Mono section label with a hairline, used by the report views. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 pb-2 pt-6 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
      <span>{children}</span>
      {right}
    </div>
  );
}
