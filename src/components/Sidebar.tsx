import clsx from "clsx";
import { Clock, Copy, Files, History, Plus, Star, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, TAG_COLORS, type Tag } from "../lib/api";
import { FILE_KINDS, KIND_ORDER } from "../lib/fileKinds";
import { useIndex } from "../stores";
import { sameView, useUi, type View } from "../stores/ui";
import { Mark } from "./Mark";
import { TagDot } from "./TagDot";

interface NavItem {
  label: string;
  icon: LucideIcon;
  view: View;
  count?: (s: { total: number; favourites: number; opened: number }) => number;
}

const LIBRARY: NavItem[] = [
  { label: "All documents", icon: Files, view: { type: "all" }, count: (s) => s.total },
  { label: "Recent", icon: Clock, view: { type: "recent" } },
  { label: "Recently opened", icon: History, view: { type: "opened" }, count: (s) => s.opened },
  { label: "Favourites", icon: Star, view: { type: "favourites" }, count: (s) => s.favourites },
  { label: "Duplicates", icon: Copy, view: { type: "duplicates" } },
];

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between px-4 pb-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
          {title}
        </span>
        {action}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  onContextMenu,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={clsx(
        "relative flex h-8 items-center gap-2.5 px-4 text-left text-[13px] transition-colors",
        active ? "font-medium text-ink" : "text-graphite hover:bg-hover hover:text-ink",
      )}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-lamp" />}
      {children}
      {count !== undefined && (
        <span className="ml-auto font-mono text-[11px] tabular-nums text-pencil">
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

export function Sidebar() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const stats = useIndex((s) => s.overview?.stats);
  const tags = useIndex((s) => s.tags);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-paper-2">
      <div className="flex h-14 items-center gap-2 px-4">
        <Mark className="size-[22px]" />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">paperlight</span>
      </div>

      <nav className="flex-1 overflow-y-auto pt-3">
        <Section title="Library">
          {LIBRARY.map(({ label, icon: Icon, view: target, count }) => (
            <NavButton
              key={label}
              active={sameView(view, target)}
              onClick={() => setView(target)}
              count={stats && count ? count(stats) : undefined}
            >
              <Icon className="size-[15px]" strokeWidth={1.6} />
              {label}
            </NavButton>
          ))}
        </Section>

        <Section title="Types">
          {KIND_ORDER.map((kind) => {
            const target: View = { type: "kind", kind };
            return (
              <NavButton
                key={kind}
                active={sameView(view, target)}
                onClick={() => setView(target)}
                count={stats ? (stats.byKind[kind] ?? 0) : undefined}
              >
                <span className={clsx("mx-[3px] size-[9px] rounded-[2px]", FILE_KINDS[kind].swatch)} />
                {FILE_KINDS[kind].label}
              </NavButton>
            );
          })}
        </Section>

        <Section
          title="Tags"
          action={
            <button
              type="button"
              title="New tag"
              onClick={() => setCreating(true)}
              className="rounded p-0.5 text-pencil hover:bg-hover hover:text-ink"
            >
              <Plus className="size-3.5" strokeWidth={2} />
            </button>
          }
        >
          {tags.map((tag) =>
            editing === tag.id ? (
              <TagEditor key={tag.id} tag={tag} onDone={() => setEditing(null)} />
            ) : (
              <NavButton
                key={tag.id}
                active={sameView(view, { type: "tag", id: tag.id })}
                onClick={() => setView({ type: "tag", id: tag.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditing(tag.id);
                }}
                count={tag.count}
              >
                <TagDot color={tag.color} className="mx-[3px]" />
                <span className="truncate">{tag.name}</span>
              </NavButton>
            ),
          )}
          {creating && <NewTag onDone={() => setCreating(false)} />}
          {tags.length === 0 && !creating && (
            <p className="px-4 text-[12px] leading-relaxed text-pencil">
              Right-click a document to tag it. Tags live in Paperlight; your files are never
              changed.
            </p>
          )}
        </Section>
      </nav>
    </aside>
  );
}

function useAutoFocus() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}

function NewTag({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const ref = useAutoFocus();
  const touched = useIndex((s) => s.touched);
  const toast = useUi((s) => s.toast);

  const save = async () => {
    if (name.trim()) {
      try {
        await api.createTag(name);
        touched();
      } catch (e) {
        toast(String(e), "error");
      }
    }
    onDone();
  };

  return (
    <div className="px-3 py-1">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        onBlur={save}
        placeholder="Tag name"
        maxLength={40}
        className="h-7 w-full rounded border border-line-strong bg-sheet px-2 text-[12.5px] text-ink outline-none focus:border-ink"
      />
    </div>
  );
}

/** Inline editor opened by right-clicking a tag: rename, recolour, delete. */
function TagEditor({ tag, onDone }: { tag: Tag; onDone: () => void }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useAutoFocus();
  const touched = useIndex((s) => s.touched);
  const toast = useUi((s) => s.toast);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);

  const save = async () => {
    try {
      await api.updateTag(tag.id, name, color);
      touched();
      onDone();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const remove = async () => {
    await api.deleteTag(tag.id);
    if (view.type === "tag" && view.id === tag.id) setView({ type: "all" });
    touched();
    onDone();
  };

  return (
    <div className="mx-2 my-1 rounded-md border border-line-strong bg-sheet p-2">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        maxLength={40}
        className="h-7 w-full rounded border border-line bg-paper px-2 text-[12.5px] text-ink outline-none focus:border-ink"
      />
      <div className="mt-2 flex gap-1.5">
        {TAG_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            title={c}
            onClick={() => setColor(c)}
            className={clsx(
              "flex size-5 items-center justify-center rounded",
              c === color ? "ring-1 ring-ink" : "hover:bg-hover",
            )}
          >
            <TagDot color={c} />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1 text-[12px]">
        {confirmDelete ? (
          <>
            <span className="text-graphite">Delete tag?</span>
            <button type="button" onClick={remove} className="rounded px-1.5 py-0.5 font-medium text-danger hover:bg-hover">
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-0.5 text-graphite hover:bg-hover">
              Keep
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setConfirmDelete(true)} className="rounded px-1.5 py-0.5 text-graphite hover:bg-hover hover:text-danger">
              Delete
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onDone} className="rounded px-1.5 py-0.5 text-graphite hover:bg-hover">
              Cancel
            </button>
            <button type="button" onClick={save} className="rounded bg-ink px-2 py-0.5 font-medium text-on-ink hover:opacity-90">
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
