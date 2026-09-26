import clsx from "clsx";
import { Clock, Copy, Files, History, Star, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { FILE_KINDS, KIND_ORDER } from "../lib/fileKinds";
import { useIndex } from "../stores";
import { sameView, useUi, type View } from "../stores/ui";
import { Mark } from "./Mark";

interface NavItem {
  label: string;
  icon: LucideIcon;
  view: View;
}

const LIBRARY: NavItem[] = [
  { label: "All documents", icon: Files, view: { type: "all" } },
  { label: "Recent", icon: Clock, view: { type: "recent" } },
  { label: "Recently opened", icon: History, view: { type: "opened" } },
  { label: "Favourites", icon: Star, view: { type: "favourites" } },
  { label: "Duplicates", icon: Copy, view: { type: "duplicates" } },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <div className="px-4 pb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
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
  children: ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
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

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-paper-2">
      <div className="flex h-14 items-center gap-2 px-4">
        <Mark className="size-[22px]" />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">paperlight</span>
      </div>

      <nav className="flex-1 overflow-y-auto pt-3">
        <Section title="Library">
          {LIBRARY.map(({ label, icon: Icon, view: target }) => (
            <NavButton
              key={label}
              active={sameView(view, target)}
              onClick={() => setView(target)}
              count={target.type === "all" ? stats?.total : undefined}
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

        <Section title="Tags">
          <p className="px-4 text-[12px] leading-relaxed text-pencil">
            Label documents to group them here. Files stay where they are.
          </p>
        </Section>
      </nav>
    </aside>
  );
}
