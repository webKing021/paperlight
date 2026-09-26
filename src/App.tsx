import { useEffect, useMemo } from "react";
import { FileList, type Fetcher } from "./components/FileList";
import { Onboarding } from "./components/Onboarding";
import { ScanBanner } from "./components/ScanBanner";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { api, type ListQuery } from "./lib/api";
import { FILE_KINDS } from "./lib/fileKinds";
import { useDebounced } from "./lib/useDebounced";
import { useApplyTheme } from "./lib/useTheme";
import { useIndex, wireIndexEvents } from "./stores";
import { useUi, type View } from "./stores/ui";

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface ViewConfig {
  title: string;
  /** Filters shared by browsing and searching; `null` = view not available yet. */
  filter: Pick<ListQuery, "kind" | "modifiedAfter"> | null;
  emptyTitle: string;
  emptyHint: string;
}

function viewConfig(view: View): ViewConfig {
  switch (view.type) {
    case "all":
      return {
        title: "All documents",
        filter: {},
        emptyTitle: "No documents yet",
        emptyHint: "Add a location or rescan to find your documents.",
      };
    case "recent":
      return {
        title: "Modified in the last 30 days",
        // Rounded to the hour so the query (and its cache key) is stable between renders.
        filter: { modifiedAfter: Math.floor((Date.now() - 30 * DAY) / HOUR) * HOUR },
        emptyTitle: "Nothing changed recently",
        emptyHint: "Documents modified in the last 30 days show up here.",
      };
    case "kind":
      return {
        title: FILE_KINDS[view.kind].label,
        filter: { kind: view.kind },
        emptyTitle: `No ${FILE_KINDS[view.kind].label} files found`,
        emptyHint: "They will appear here as soon as they're indexed.",
      };
    case "opened":
      return {
        title: "Recently opened",
        filter: null,
        emptyTitle: "Recently opened",
        emptyHint: "Files you open from Paperlight will be listed here. Coming in the next update.",
      };
    case "favourites":
      return {
        title: "Favourites",
        filter: null,
        emptyTitle: "Favourites",
        emptyHint: "Star important documents to keep them one click away. Coming soon.",
      };
    case "duplicates":
      return {
        title: "Duplicates",
        filter: null,
        emptyTitle: "Duplicates",
        emptyHint: "Paperlight will spot identical copies of the same document. Coming soon.",
      };
  }
}

export default function App() {
  useApplyTheme();
  useEffect(wireIndexEvents, []);

  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const revision = useIndex((s) => s.revision);
  const view = useUi((s) => s.view);
  const rawQuery = useUi((s) => s.query);
  const text = useDebounced(rawQuery.trim(), 90);
  const config = useMemo(() => viewConfig(view), [view]);

  const list = useMemo(() => {
    if (text) {
      // Searching works in every view; views that aren't built yet search everything.
      const filter = config.filter ?? {};
      const fetcher: Fetcher = (offset, limit) =>
        api.searchFiles({ text, ...filter, offset, limit });
      return {
        fetcher,
        key: JSON.stringify(["search", text, filter]),
        title: config.filter && view.type !== "all" ? `Matches in ${config.title}` : "Best matches",
        emptyTitle: `No documents match “${text}”`,
        emptyHint: "Try fewer or shorter words — part of a name or folder is enough.",
        highlight: text.toLowerCase().split(/\s+/),
        autoSelect: true,
      };
    }
    if (!config.filter) return null;
    const filter = config.filter;
    const fetcher: Fetcher = (offset, limit) => api.listFiles({ ...filter, offset, limit });
    return {
      fetcher,
      key: JSON.stringify(["list", filter]),
      title: config.title,
      emptyTitle: config.emptyTitle,
      emptyHint: config.emptyHint,
      highlight: undefined,
      autoSelect: false,
    };
  }, [text, config, view.type]);

  const firstRun = overview !== null && overview.lastScanAt === null && !scanning;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <SearchBar />
          <ScanBanner />
          <section className="min-h-0 flex-1">
            {overview === null ? null : firstRun ? (
              <Onboarding />
            ) : list ? (
              <FileList
                fetcher={list.fetcher}
                fetchKey={list.key}
                revision={revision}
                title={list.title}
                emptyTitle={list.emptyTitle}
                emptyHint={list.emptyHint}
                highlight={list.highlight}
                autoSelect={list.autoSelect}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
                <p className="text-[14px] font-medium">{config.emptyTitle}</p>
                <p className="max-w-xs text-[12.5px] text-muted">{config.emptyHint}</p>
              </div>
            )}
          </section>
        </main>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}
