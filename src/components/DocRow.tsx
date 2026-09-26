import clsx from "clsx";
import { ExternalLink, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";
import { openFile, revealFile } from "../lib/actions";
import type { FileRow } from "../lib/api";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";
import { useUi } from "../stores/ui";
import { FileIcon } from "./FileIcon";

/** A document row for report-style views (duplicates, storage). Click selects, double-click opens. */
export function DocRow({ row, folder }: { row: FileRow; folder?: ReactNode }) {
  const selected = useUi((s) => s.selectedId === row.id);
  const setSelectedId = useUi((s) => s.setSelectedId);

  return (
    <div className="px-2">
      <div
        onClick={() => setSelectedId(row.id)}
        onDoubleClick={() => openFile(row)}
        title={row.path}
        className={clsx(
          "group grid h-[50px] cursor-default grid-cols-[minmax(0,1fr)_120px_72px_64px] items-center gap-4 rounded-md px-3",
          selected ? "bg-selected" : "hover:bg-hover/70",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <FileIcon kind={row.kind} ext={row.ext} />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-medium leading-5 text-ink">{row.name}</div>
            <div className="truncate text-[12px] leading-4 text-pencil">{folder ?? row.dir}</div>
          </div>
        </div>
        <span className="truncate text-[12.5px] text-graphite" title={formatDateTime(row.modifiedAt)}>
          {formatRelative(row.modifiedAt)}
        </span>
        <span className="text-right text-[12.5px] tabular-nums text-graphite">{formatSize(row.size)}</span>
        <div
          className={clsx(
            "flex justify-end gap-0.5",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <RowButton title="Open" onClick={() => openFile(row)}>
            <ExternalLink className="size-[15px]" strokeWidth={1.7} />
          </RowButton>
          <RowButton title="Show in folder" onClick={() => revealFile(row)}>
            <FolderOpen className="size-[15px]" strokeWidth={1.7} />
          </RowButton>
        </div>
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
      className="flex size-7 items-center justify-center rounded-md text-graphite hover:bg-paper hover:text-ink"
    >
      {children}
    </button>
  );
}

/** A heading inside a report view, with an optional note on the right. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mx-5 flex items-center justify-between border-b border-line pb-2 pt-6 text-[13px] font-semibold text-ink">
      <span>{children}</span>
      {right && <span className="text-[12px] font-normal text-pencil">{right}</span>}
    </div>
  );
}

/** Title and summary line at the top of a full-page view. */
export function PageHeader({
  title,
  summary,
  action,
}: {
  title: string;
  summary?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 px-5 pb-1 pt-5">
      <div className="min-w-0">
        <h1 className="font-display text-[22px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        {summary && <p className="mt-0.5 text-[13px] text-graphite">{summary}</p>}
      </div>
      {action}
    </div>
  );
}
