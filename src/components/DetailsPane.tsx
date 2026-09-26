import clsx from "clsx";
import { ClipboardCopy, FolderOpen, MousePointerClick, Star } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { copyPath, openFile, revealFile, toggleFavourite, toggleTag } from "../lib/actions";
import { api, type FileDetails } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";
import { FileIcon } from "./FileIcon";
import { FolderChooser } from "./FolderChooser";
import { PdfPreview } from "./PdfPreview";
import { usePanelSettled } from "./SlidePanel";
import { TagDot } from "./TagDot";

export const DETAILS_WIDTH = 320;
const PREVIEW_WIDTH = DETAILS_WIDTH - 72;

const TEXT_STATUS: Record<number, string> = {
  0: "The text inside hasn't been read yet. It will be searchable in a moment.",
  2: "The text isn't read for this format (or the file is very large); its name is still searchable.",
  3: "This file's text couldn't be read; its name is still searchable.",
};

export function DetailsPane() {
  const selectedId = useUi((s) => s.selectedId);
  const revision = useIndex((s) => s.revision);
  const tags = useIndex((s) => s.tags);
  // Rendering a PDF page is heavy: wait until the panel has finished sliding in.
  const settled = usePanelSettled();
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [excluding, setExcluding] = useState(false);
  useEffect(() => setExcluding(false), [selectedId]);

  useEffect(() => {
    if (selectedId === null) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    api.fileDetails(selectedId).then(
      (d) => !cancelled && setDetails(d),
      () => !cancelled && setDetails(null),
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId, revision]);

  const file = details?.file;
  const kind = file ? FILE_KINDS[file.kind] : undefined;

  return (
    <aside className="flex h-full shrink-0 flex-col bg-paper" style={{ width: DETAILS_WIDTH }}>
      <div className="flex h-[52px] shrink-0 items-center border-b border-line px-5">
        <span className="text-[13px] font-semibold text-ink">Details</span>
      </div>

      {!file ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-paper-2 text-pencil">
            <MousePointerClick className="size-5" strokeWidth={1.6} />
          </span>
          <p className="text-[13px] font-medium text-ink-2">Nothing selected</p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-pencil">
            Select a document to preview it and see where it lives.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex justify-center border-b border-line bg-paper-2 px-6 py-6">
            {file.kind === "pdf" ? (
              settled ? (
                <PdfPreview id={file.id} width={PREVIEW_WIDTH} />
              ) : (
                <PageSkeleton />
              )
            ) : (
              <TextCard excerpt={details.excerpt} />
            )}
          </div>

          <div className="px-5 pb-6 pt-4">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 break-words font-display text-[15px] font-semibold leading-snug text-ink">
                {file.name}
              </h2>
              <button
                type="button"
                title={file.isFavourite ? "Remove from favourites" : "Add to favourites"}
                onClick={() => toggleFavourite(file)}
                className="-mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-pencil hover:bg-hover hover:text-ink"
              >
                <Star className={clsx("size-4", file.isFavourite && "fill-lamp text-lamp")} strokeWidth={1.7} />
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-graphite">
              <FileIcon kind={file.kind} ext={file.ext} size={18} />
              {kind?.label}
              {kind && kind.label.toLowerCase() !== file.ext && <span className="text-pencil">.{file.ext}</span>}
              <span className="text-pencil">·</span>
              {formatSize(file.size)}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => openFile(file)}
                className="h-8 flex-1 rounded-md bg-ink text-[13px] font-medium text-on-ink transition-opacity hover:opacity-90"
              >
                Open
              </button>
              <IconAction title="Show in folder" onClick={() => revealFile(file)}>
                <FolderOpen className="size-4" strokeWidth={1.7} />
              </IconAction>
              <IconAction title="Copy path" onClick={() => copyPath(file)}>
                <ClipboardCopy className="size-4" strokeWidth={1.7} />
              </IconAction>
            </div>

            <dl className="mt-5 text-[12.5px]">
              <Field label="Folder">
                <button
                  type="button"
                  onClick={() => revealFile(file)}
                  className="break-all text-left text-ink-2 hover:text-ink hover:underline"
                >
                  {file.dir}
                </button>
                <button
                  type="button"
                  onClick={() => setExcluding((v) => !v)}
                  className="mt-1 block text-[12px] text-pencil hover:text-ink"
                >
                  {excluding ? "Cancel" : "Exclude folder…"}
                </button>
                {excluding && (
                  <div className="mt-1.5 rounded-md border border-line bg-paper-2 py-1">
                    <p className="px-2.5 pb-1 text-[11.5px] leading-snug text-pencil">
                      Stop indexing which folder? Nothing on disk changes.
                    </p>
                    <FolderChooser dir={file.dir} onDone={() => setExcluding(false)} />
                  </div>
                )}
              </Field>
              <Field label="Modified">{formatDateTime(file.modifiedAt)}</Field>
              <Field label="Created">{formatDateTime(file.createdAt)}</Field>
              <Field label="Opened">
                {file.openCount > 0
                  ? `${file.openCount}× · last ${formatRelative(file.lastOpenedAt)}`
                  : "Not from Paperlight yet"}
              </Field>
            </dl>

            <div className="mt-5">
              <div className="mb-2 text-[12px] font-semibold text-pencil">Tags</div>
              {tags.length === 0 ? (
                <p className="text-[12.5px] text-pencil">Create a tag from the sidebar or with Ctrl+T.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const on = file.tags.includes(tag.id);
                    return (
                      <button
                        type="button"
                        key={tag.id}
                        onClick={() => toggleTag(file, tag.id)}
                        aria-pressed={on}
                        className={clsx(
                          "flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors",
                          on
                            ? "border-line-strong bg-selected text-ink"
                            : "border-dashed border-line-strong text-pencil hover:text-graphite",
                        )}
                      >
                        <TagDot color={tag.color} className={clsx(!on && "opacity-50")} />
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {details.textStatus !== 1 && (
              <p className="mt-5 rounded-md bg-paper-2 px-3 py-2 text-[12px] leading-relaxed text-graphite">
                {TEXT_STATUS[details.textStatus]}
              </p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

const PAGE_SHADOW = "shadow-[0_0_0_1px_rgb(0_0_0/0.05),0_2px_4px_rgb(0_0_0/0.04),0_12px_28px_-12px_rgb(0_0_0/0.28)]";

function PageSkeleton() {
  return (
    <div
      className={clsx("rounded-[3px] bg-sheet", PAGE_SHADOW)}
      style={{ width: PREVIEW_WIDTH, height: Math.round(PREVIEW_WIDTH * 1.3) }}
    />
  );
}

/** A page-like card with the start of the document's text (Word, Excel, PowerPoint…). */
function TextCard({ excerpt }: { excerpt: string | null }) {
  return (
    <div
      className={clsx("overflow-hidden rounded-[3px] bg-white px-4 py-4 dark:bg-sheet", PAGE_SHADOW)}
      style={{ width: PREVIEW_WIDTH, height: Math.round(PREVIEW_WIDTH * 1.25) }}
    >
      {excerpt ? (
        <p className="line-clamp-[18] text-[10.5px] leading-[1.6] text-ink-2">{excerpt}</p>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-pencil">No preview</div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-line py-2.5">
      <dt className="w-16 shrink-0 leading-5 text-pencil">{label}</dt>
      <dd className="min-w-0 flex-1 leading-5 text-ink-2">{children}</dd>
    </div>
  );
}

function IconAction({
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
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-md border border-line-strong text-graphite hover:bg-hover hover:text-ink"
    >
      {children}
    </button>
  );
}
