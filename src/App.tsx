import { lazy, Suspense, useEffect, useMemo, type ComponentType } from "react";
import { DetailsPane } from "./components/DetailsPane";
import { FileList, type Fetcher } from "./components/FileList";
import { Onboarding } from "./components/Onboarding";
import { ScanBanner } from "./components/ScanBanner";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { api, type SortKey, type Tag, type ViewFilter } from "./lib/api";
import { FILE_KINDS } from "./lib/fileKinds";
import { useDebounced } from "./lib/useDebounced";
import { useApplyTheme } from "./lib/useTheme";
import { useIndex, wireIndexEvents } from "./stores";
import { useUi, type Sort, type View } from "./stores/ui";

// Report pages are loaded on first visit, keeping the startup bundle small.
const PAGES = {
  duplicates: lazy(() => import("./components/DuplicatesView")),
  storage: lazy(() => import("./components/StorageView")),
  settings: lazy(() => import("./components/SettingsView")),
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface ViewConfig {
  title: string;
  /** Filter shared by browsing and searching; `null` = not a document list. */
  filter: ViewFilter | null;
  /** Full-page view shown instead of a document list (when not searching). */
  page?: ComponentType;
  /** Fixed sort for views whose order is their point (e.g. recently opened). */
  sort?: Sort;
  emptyTitle: string;
  emptyHint: string;
}

function viewConfig(view: View, tags: Tag[]): ViewConfig {
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
        filter: { opened: true },
        sort: { key: "opened", ascending: false },
        emptyTitle: "Nothing opened yet",
        emptyHint: "Documents you open from Paperlight are listed here, most recent first.",
      };
    case "favourites":
      return {
        title: "Favourites",
        filter: { favourites: true },
        emptyTitle: "No favourites yet",
        emptyHint: "Star a document (Ctrl+D) to keep it one click away.",
      };
    case "tag": {
      const tag = tags.find((t) => t.id === view.id);
      return {
        title: tag?.name ?? "Tag",
        filter: { tagId: view.id },
        emptyTitle: `Nothing tagged “${tag?.name ?? ""}” yet`,
        emptyHint: "Right-click a document (or press Ctrl+T) to add tags.",
      };
    }
    case "duplicates":
    case "storage":
    case "settings":
      return {
        title: "",
        filter: null,
        page: PAGES[view.type],
        emptyTitle: "",
        emptyHint: "",
      };
  }
}

export default function App() {
  useApplyTheme();
  useEffect(wireIndexEvents, []);

  const overview = useIndex((s) => s.overview);
  const scanning = useIndex((s) => s.scanning);
  const revision = useIndex((s) => s.revision);
  const tags = useIndex((s) => s.tags);
  const view = useUi((s) => s.view);
  const userSort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  const rawQuery = useUi((s) => s.query);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const text = useDebounced(rawQuery.trim(), 90);
  const config = useMemo(() => viewConfig(view, tags), [view, tags]);

  const onSort = (key: SortKey) =>
    setSort(
      userSort.key === key
        ? { key, ascending: !userSort.ascending }
        : { key, ascending: key === "name" },
    );

  const list = useMemo(() => {
    if (text) {
      // Searching works in every view; pages that aren't document lists search everything.
      const filter = config.filter ?? {};
      const fetcher: Fetcher = (offset, limit) =>
        api.searchFiles({ text, ...filter, offset, limit });
      return {
        fetcher,
        key: JSON.stringify(["search", text, filter]),
        title: view.type !== "all" && config.filter ? `Matches in ${config.title}` : "Best matches",
        emptyTitle: `No documents match “${text}”`,
        emptyHint: "Try fewer or shorter words. Part of a name, a folder or a phrase from inside the document is enough.",
        highlight: text.toLowerCase().split(/\s+/),
        autoSelect: true,
        sortable: false,
      };
    }
    if (!config.filter) return null;
    const filter = config.filter;
    const sort = config.sort ?? userSort;
    const fetcher: Fetcher = (offset, limit) =>
      api.listFiles({ ...filter, sort: sort.key, ascending: sort.ascending, offset, limit });
    return {
      fetcher,
      key: JSON.stringify(["list", filter, sort]),
      title: config.title,
      emptyTitle: config.emptyTitle,
      emptyHint: config.emptyHint,
      highlight: undefined,
      autoSelect: false,
      sortable: !config.sort,
    };
  }, [text, config, view.type, userSort]);

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
                sort={list.sortable ? userSort : undefined}
                onSort={list.sortable ? onSort : undefined}
              />
            ) : config.page ? (
              <Suspense fallback={null}>
                <config.page />
              </Suspense>
            ) : null}
          </section>
        </main>
        {detailsOpen && !firstRun && view.type !== "settings" && <DetailsPane />}
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}
