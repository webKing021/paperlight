import clsx from "clsx";
import {
  Clock,
  Copy,
  FileStack,
  History,
  Star,
  type LucideIcon,
} from "lucide-react";
import { FILE_KINDS, KIND_DOT, KIND_ORDER } from "../lib/fileKinds";
import { useIndex } from "../stores";
import { sameView, useUi, type View } from "../stores/ui";

interface NavItem {
  label: string;
  icon: LucideIcon;
  view: View;
}

const LIBRARY: NavItem[] = [
  { label: "All documents", icon: FileStack, view: { type: "all" } },
  { label: "Recent", icon: Clock, view: { type: "recent" } },
  { label: "Recently opened", icon: History, view: { type: "opened" } },
  { label: "Favourites", icon: Star, view: { type: "favourites" } },
  { label: "Duplicates", icon: Copy, view: { type: "duplicates" } },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex h-8 items-center gap-2.5 rounded-md px-3 text-left text-[13px] transition-colors",
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {children}
      {count !== undefined && (
        <span className="ml-auto text-xs tabular-nums text-faint">{count.toLocaleString()}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const stats = useIndex((s) => s.overview?.stats);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <img src="/paperlight.svg" alt="" className="size-6" />
        <span className="text-[15px] font-semibold tracking-tight">Paperlight</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pt-2">
        <Section title="Library">
          {LIBRARY.map(({ label, icon: Icon, view: target }) => (
            <NavButton
              key={label}
              active={sameView(view, target)}
              onClick={() => setView(target)}
              count={target.type === "all" ? stats?.total : undefined}
            >
              <Icon className="size-4" strokeWidth={1.75} />
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
                <span className={clsx("mx-1 size-2 rounded-full", KIND_DOT[kind])} />
                {FILE_KINDS[kind].label}
              </NavButton>
            );
          })}
        </Section>

        <Section title="Tags">
          <p className="px-3 text-xs leading-relaxed text-faint">
            Tag documents to group them here — your files stay where they are.
          </p>
        </Section>
      </nav>
    </aside>
  );
}
