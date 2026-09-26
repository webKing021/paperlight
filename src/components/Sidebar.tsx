import clsx from "clsx";
import {
  ChartPie,
  FilePenLine,
  Files,
  History,
  LayoutDashboard,
  Layers2,
  PanelLeft,
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
import { KindGlyph } from "./FileIcon";
import { Mark } from "./Mark";
import { TagDot } from "./TagDot";

/** Width of the sidebar and of its collapsed rail (see App). */
export const SIDEBAR_WIDTH = 232;
export const SIDEBAR_RAIL = 56;

interface NavItem {
  label: string;
  icon: LucideIcon;
  view: View;
  count?: (s: { total: number; favourites: number; opened: number }) => number;
}

const LIBRARY: NavItem[] = [
  { label: "Overview", icon: LayoutDashboard, view: { type: "overview" } },
  { label: "All documents", icon: Files, view: { type: "all" }, count: (s) => s.total },
  { label: "Recently changed", icon: FilePenLine, view: { type: "recent" } },
  { label: "Recently opened", icon: History, view: { type: "opened" }, count: (s) => s.opened },
  { label: "Favourites", icon: Star, view: { type: "favourites" }, count: (s) => s.favourites },
];

const INSIGHTS: NavItem[] = [
  { label: "Duplicates", icon: Layers2, view: { type: "duplicates" } },
  { label: "Storage", icon: ChartPie, view: { type: "storage" } },
];

/** Fades a label out while the sidebar is collapsed to a rail. */
const FADE = "transition-opacity duration-200 group-data-[collapsed=true]/side:opacity-0";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="flex h-7 items-center justify-between pl-5 pr-3">
        <span className={clsx("text-[11.5px] font-semibold text-pencil", FADE)}>{title}</span>
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
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
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative mx-2 flex h-8 items-center gap-3 whitespace-nowrap rounded-md px-3 text-left text-[13px] transition-colors duration-100",
        active ? "bg-selected font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-lamp" />}
      {children}
      {count !== undefined && count > 0 && (
        <span className={clsx("ml-auto text-[12px] tabular-nums text-pencil", FADE)}>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

const ICON = "size-4 shrink-0";

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

  const item = ({ label, icon: Icon, view: target, count }: NavItem) => (
    <NavButton
      key={label}
      active={sameView(view, target)}
      onClick={() => setView(target)}
      count={stats && count ? count(stats) : undefined}
      title={open ? undefined : label}
    >
      <Icon className={ICON} strokeWidth={1.7} />
      <span className={clsx("truncate", FADE)}>{label}</span>
    </NavButton>
  );

  return (
    <aside
      data-collapsed={!open}
      className="group/side flex h-full flex-col bg-paper-2"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <div className="flex h-[52px] shrink-0 items-center pl-2 pr-3">
        {/* In the rail the mark doubles as the expand button, so nothing jumps around. */}
        <button
          type="button"
          onClick={open ? () => setView({ type: "overview" }) : toggleSidebar}
          title={open ? "Overview" : "Expand sidebar (Ctrl+B)"}
          className="group/mark relative flex h-9 w-10 shrink-0 items-center justify-center rounded-md hover:bg-hover"
        >
          <Mark
            className={clsx(
              "size-[22px] transition-opacity duration-150",
              !open && "group-hover/mark:opacity-0",
            )}
          />
          {!open && (
            <PanelLeft
              className="absolute size-4 text-ink-2 opacity-0 transition-opacity duration-150 group-hover/mark:opacity-100"
              strokeWidth={1.7}
            />
          )}
        </button>
        <span className={clsx("ml-1.5 font-display text-[15px] font-semibold tracking-[-0.01em] text-ink", FADE)}>
          Paperlight
        </span>
        <button
          type="button"
          onClick={toggleSidebar}
          title="Collapse sidebar (Ctrl+B)"
          tabIndex={open ? 0 : -1}
          className={clsx(
            "ml-auto flex size-8 items-center justify-center rounded-md text-graphite hover:bg-hover hover:text-ink",
            FADE,
          )}
        >
          <PanelLeft className={ICON} strokeWidth={1.7} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-1">
        <div className="flex flex-col gap-px">{LIBRARY.map(item)}</div>

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
                <KindGlyph kind={kind} className={ICON} />
                <span className={FADE}>{FILE_KINDS[kind].label}</span>
              </NavButton>
            );
          })}
        </Section>

        <Section title="Insights">{INSIGHTS.map(item)}</Section>

        <Section
          title="Tags"
          action={
            <button
              type="button"
              title="New tag"
              onClick={() => setCreating(true)}
              tabIndex={open ? 0 : -1}
              className={clsx("flex size-6 items-center justify-center rounded text-pencil hover:bg-hover hover:text-ink", FADE)}
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
                title={open ? "Right-click to rename, recolour or delete" : tag.name}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <TagDot color={tag.color} />
                </span>
                <span className={clsx("truncate", FADE)}>{tag.name}</span>
              </NavButton>
            ),
          )}
          {creating && <NewTag onDone={() => setCreating(false)} />}
          {tags.length === 0 && !creating && (
            <p className={clsx("w-[200px] px-5 pt-0.5 text-[12px] leading-relaxed text-pencil", FADE)}>
              Right-click a document to tag it. Tags stay in Paperlight; files aren't changed.
            </p>
          )}
        </Section>
      </nav>
      <div className="flex flex-col border-t border-line py-2">
        <NavButton
          active={view.type === "settings"}
          onClick={() => setView({ type: "settings" })}
          title={open ? undefined : "Settings"}
        >
          <Settings className={ICON} strokeWidth={1.7} />
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

const INPUT =
  "h-8 w-full rounded-md border border-line-strong bg-sheet px-2.5 text-[13px] text-ink outline-none focus:border-ink";

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
    <div className="px-2 py-1">
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
        className={INPUT}
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

  const small = "rounded-md px-2 py-1 text-[12px]";

  return (
    <div className="mx-2 my-1 rounded-lg border border-line bg-sheet p-2 shadow-pop">
      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onDone();
        }}
        maxLength={40}
        className={INPUT}
      />
      <div className="mt-2 flex gap-1">
        {TAG_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            title={c}
            onClick={() => setColor(c)}
            className={clsx(
              "flex size-6 items-center justify-center rounded-full",
              c === color ? "ring-2 ring-ink/80" : "hover:bg-hover",
            )}
          >
            <TagDot color={c} className="size-3" />
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1">
        {confirmDelete ? (
          <>
            <span className="px-1 text-[12px] text-graphite">Delete this tag?</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setConfirmDelete(false)} className={clsx(small, "text-graphite hover:bg-hover")}>
              Keep
            </button>
            <button type="button" onClick={remove} className={clsx(small, "bg-danger font-medium text-white hover:opacity-90")}>
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className={clsx(small, "text-graphite hover:bg-hover hover:text-danger")}
            >
              Delete
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onDone} className={clsx(small, "text-graphite hover:bg-hover")}>
              Cancel
            </button>
            <button type="button" onClick={save} className={clsx(small, "bg-ink font-medium text-on-ink hover:opacity-90")}>
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
