import clsx from "clsx";
import {
  Clock,
  LayoutGrid,
  PanelLeft,
  Copy,
  Files,
  HardDrive,
  History,
  Plus,
  Settings,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, TAG_COLORS, type Tag } from "../lib/api";
import { enabledKinds, FILE_KINDS } from "../lib/fileKinds";
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
  { label: "Overview", icon: LayoutGrid, view: { type: "overview" } },
  { label: "All documents", icon: Files, view: { type: "all" }, count: (s) => s.total },
  { label: "Recent", icon: Clock, view: { type: "recent" } },
  { label: "Recently opened", icon: History, view: { type: "opened" }, count: (s) => s.opened },
  { label: "Favourites", icon: Star, view: { type: "favourites" }, count: (s) => s.favourites },
  { label: "Duplicates", icon: Copy, view: { type: "duplicates" } },
  { label: "Storage", icon: HardDrive, view: { type: "storage" } },
];

/** Fades labels out while the sidebar is collapsed to a rail. */
const FADE = "transition-opacity duration-150 group-data-[collapsed=true]/side:opacity-0";

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
        <span
          className={clsx("font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil", FADE)}
        >
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
  title,
}: {
  title?: string;
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
      title={title}
      className={clsx(
        "relative flex h-8 items-center gap-2.5 px-4 text-left text-[13px] transition-colors",
        active ? "font-medium text-ink" : "text-graphite hover:bg-hover hover:text-ink",
      )}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-lamp" />}
      {children}
      {count !== undefined && (
        <span className={clsx("ml-auto font-mono text-[11px] tabular-nums text-pencil", FADE)}>
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
  const disabledFormats = useIndex((s) => s.overview?.disabledFormats);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const open = useUi((s) => s.sidebarOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  return (
    <aside
      data-collapsed={!open}
      className="group/side flex h-full w-56 shrink-0 flex-col bg-paper-2"
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-2">
        {open && (
          <>
            <Mark className="ml-2 size-[22px]" />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">paperlight</span>
          </>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          title={open ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
          className={clsx(
            "flex size-8 items-center justify-center rounded-md text-graphite transition-colors hover:bg-hover hover:text-ink",
            open && "ml-auto",
          )}
        >
          <PanelLeft className="size-4" strokeWidth={1.6} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto pt-3">
        <Section title="Library">
          {LIBRARY.map(({ label, icon: Icon, view: target, count }) => (
            <NavButton
              key={label}
              active={sameView(view, target)}
              onClick={() => setView(target)}
              count={stats && count ? count(stats) : undefined}
              title={open ? undefined : label}
            >
              <Icon className="size-[15px] shrink-0" strokeWidth={1.6} />
              <span className={clsx("truncate", FADE)}>{label}</span>
            </NavButton>
          ))}
        </Section>

        <Section title="Types">
          {enabledKinds(disabledFormats).map((kind) => {
            const target: View = { type: "kind", kind };
            return (
              <NavButton
                key={kind}
                active={sameView(view, target)}
                onClick={() => setView(target)}
                count={stats ? (stats.byKind[kind] ?? 0) : undefined}
                title={open ? undefined : FILE_KINDS[kind].label}
              >
                <span
                  className={clsx("mx-[3px] size-[9px] shrink-0 rounded-[2px]", FILE_KINDS[kind].swatch)}
                />
                <span className={FADE}>{FILE_KINDS[kind].label}</span>
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
                title={open ? undefined : tag.name}
              >
                <TagDot color={tag.color} className="mx-[3px] shrink-0" />
                <span className={clsx("truncate", FADE)}>{tag.name}</span>
              </NavButton>
            ),
          )}
          {creating && <NewTag onDone={() => setCreating(false)} />}
          {tags.length === 0 && !creating && (
            <p className={clsx("px-4 text-[12px] leading-relaxed text-pencil", FADE)}>
              Right-click a document to tag it. Tags live in Paperlight; your files are never
              changed.
            </p>
          )}
        </Section>
      </nav>
      <div className="border-t border-line py-1.5">
        <NavButton
          active={view.type === "settings"}
          onClick={() => setView({ type: "settings" })}
          title={open ? undefined : "Settings"}
        >
          <Settings className="size-[15px] shrink-0" strokeWidth={1.6} />
          <span className={FADE}>Settings</span>
        </NavButton>
      </div>
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
