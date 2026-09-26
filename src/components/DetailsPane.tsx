import clsx from "clsx";
import { Copy, FolderOpen, Star, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { copyPath, openFile, revealFile, toggleFavourite, toggleTag } from "../lib/actions";
import { api, type FileDetails } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatDateTime, formatRelative, formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { useUi } from "../stores/ui";
import { PdfPreview } from "./PdfPreview";
import { TagDot } from "./TagDot";

const PANE_WIDTH = 320;
const PREVIEW_WIDTH = PANE_WIDTH - 48;

const TEXT_STATUS: Record<number, string> = {
  0: "Text not read yet. It will be searchable in a moment.",
  2: "Text isn't read for this format (or the file is very large); its name is still searchable.",
  3: "This file's text couldn't be read; its name is still searchable.",
};

export function DetailsPane() {
  const selectedId = useUi((s) => s.selectedId);
  const toggleDetails = useUi((s) => s.toggleDetails);
  const revision = useIndex((s) => s.revision);
  const tags = useIndex((s) => s.tags);
  const [details, setDetails] = useState<FileDetails | null>(null);

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
    <aside
      className="flex shrink-0 flex-col border-l border-line bg-sheet"
      style={{ width: PANE_WIDTH }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-4">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">Details</span>
        <button
          type="button"
          title="Hide details"
          onClick={toggleDetails}
          className="rounded p-1 text-pencil hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {!file ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-[12.5px] text-pencil">
          Select a document to see a preview and its details.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex justify-center">
            {file.kind === "pdf" ? (
              <PdfPreview id={file.id} width={PREVIEW_WIDTH} />
            ) : (
              <TextCard excerpt={details.excerpt} />
            )}
          </div>

          <div className="mt-5 flex items-start gap-2">
            <h2 className="min-w-0 flex-1 break-words text-[14.5px] font-semibold leading-snug text-ink">
              {file.name}
            </h2>
            <button
              type="button"
              title={file.isFavourite ? "Remove from favourites" : "Add to favourites"}
              onClick={() => toggleFavourite(file)}
              className="mt-0.5 rounded p-0.5 text-pencil hover:text-ink"
            >
              <Star className={clsx("size-4", file.isFavourite && "fill-lamp text-lamp")} strokeWidth={1.6} />
            </button>
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] uppercase text-graphite">
            <span className={clsx("h-3 w-[3px] rounded-full", kind?.swatch)} />
            {kind?.label}
            {kind && kind.label.toLowerCase() !== file.ext && ` · ${file.ext}`} · {formatSize(file.size)}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => openFile(file)}
              className="h-8 flex-1 rounded-md bg-ink text-[12.5px] font-medium text-on-ink hover:opacity-90"
            >
              Open
            </button>
            <IconAction title="Show in folder" onClick={() => revealFile(file)}>
              <FolderOpen className="size-4" strokeWidth={1.6} />
            </IconAction>
            <IconAction title="Copy path" onClick={() => copyPath(file)}>
              <Copy className="size-[15px]" strokeWidth={1.6} />
            </IconAction>
          </div>

          <dl className="mt-5 border-t border-line text-[12px]">
            <Field label="Folder">
              <button
                type="button"
                onClick={() => revealFile(file)}
                className="break-all text-left text-ink-2 hover:text-ink hover:underline"
              >
                {file.dir}
              </button>
            </Field>
            <Field label="Modified">{formatDateTime(file.modifiedAt)}</Field>
            <Field label="Created">{formatDateTime(file.createdAt)}</Field>
            <Field label="Opened">
              {file.openCount > 0
                ? `${file.openCount}× · last ${formatRelative(file.lastOpenedAt)}`
                : "Not from Paperlight yet"}
            </Field>
          </dl>

          <div className="mt-4">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">Tags</div>
            {tags.length === 0 ? (
              <p className="text-[12px] text-pencil">Create a tag from the sidebar or with Ctrl+T.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const on = file.tags.includes(tag.id);
                  return (
                    <button
                      type="button"
                      key={tag.id}
                      onClick={() => toggleTag(file, tag.id)}
                      className={clsx(
                        "flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11.5px] transition-colors",
                        on
                          ? "border-line-strong bg-paper text-ink"
                          : "border-dashed border-line text-pencil hover:border-line-strong hover:text-graphite",
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
            <p className="mt-5 text-[11.5px] leading-relaxed text-pencil">{TEXT_STATUS[details.textStatus]}</p>
          )}
        </div>
      )}
    </aside>
  );
}

/** A paper-like card with the start of the document's text (Word, Excel, PowerPoint…). */
function TextCard({ excerpt }: { excerpt: string | null }) {
  return (
    <div
      className="overflow-hidden rounded-sm bg-white px-4 py-4 shadow-[0_1px_0_rgba(28,27,24,0.08),0_8px_24px_-12px_rgba(28,27,24,0.35)] dark:bg-paper-2"
      style={{ width: PREVIEW_WIDTH, height: Math.round(PREVIEW_WIDTH * 1.2) }}
    >
      {excerpt ? (
        <p className="line-clamp-[18] text-[10.5px] leading-[1.55] text-ink-2">{excerpt}</p>
      ) : (
        <div className="flex h-full items-center justify-center text-[11.5px] text-pencil">No preview</div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-line py-2">
      <dt className="w-16 shrink-0 font-mono text-[10.5px] uppercase leading-5 tracking-[0.06em] text-pencil">
        {label}
      </dt>
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
      className="flex size-8 items-center justify-center rounded-md border border-line text-graphite hover:border-line-strong hover:text-ink"
    >
      {children}
    </button>
  );
}
