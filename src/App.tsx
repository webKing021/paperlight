import { lazy, Suspense, useEffect, useMemo, useRef, type ComponentType } from "react";
import { DETAILS_WIDTH, DetailsPane } from "./components/DetailsPane";
import { FileList, type Fetcher } from "./components/FileList";
import { Mark } from "./components/Mark";
import { Onboarding } from "./components/Onboarding";
import { ScanBanner } from "./components/ScanBanner";
import { SearchBar } from "./components/SearchBar";
import { Sidebar, SIDEBAR_RAIL, SIDEBAR_WIDTH } from "./components/Sidebar";
import { SlidePanel } from "./components/SlidePanel";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { api, type SortKey, type Tag, type ViewFilter } from "./lib/api";
import { FILE_KINDS } from "./lib/fileKinds";
import { hideSplash } from "./lib/splash";
import { useDebounced } from "./lib/useDebounced";
import { useApplyTheme } from "./lib/useTheme";
import { useIndex, wireIndexEvents } from "./stores";
import { useUi, type Sort, type View } from "./stores/ui";

// Report pages are loaded on first visit, keeping the startup bundle small.
const PAGES = {
  overview: lazy(() => import("./components/DashboardView")),
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
        title: "Changed in the last 30 days",
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
    case "overview":
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
  const revision = useIndex((s) => s.revision);
  const tags = useIndex((s) => s.tags);
  const view = useUi((s) => s.view);
  const userSort = useUi((s) => s.sort);
  const setSort = useUi((s) => s.setSort);
  const rawQuery = useUi((s) => s.query);
  const detailsOpen = useUi((s) => s.detailsOpen);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
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

  // First run: the welcome screens replace the app until the first scan is under way.
  const error = useIndex((s) => s.error);
  const onboarding = useUi((s) => s.onboarding);
  const setOnboarding = useUi((s) => s.setOnboarding);
  const decided = useRef(false);
  useEffect(() => {
    if (overview === null || decided.current) return;
    decided.current = true;
    if (overview.lastScanAt === null && !overview.scanning) setOnboarding(true);
  }, [overview, setOnboarding]);

  // The splash stays up until there is something real to show.
  useEffect(() => {
    if (overview !== null || error) hideSplash();
  }, [overview, error]);

  // The saved theme also colours the native title bar (a no-op when nothing changed).
  useEffect(() => {
    api.setTheme(useUi.getState().theme).catch(() => {});
  }, []);

  if (overview === null) return error ? <StartupError message={error} /> : null;
  if (onboarding) {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  }

  const hasDetails = view.type !== "settings";

  return (
    <div className="flex h-full flex-col animate-fade">
      <div className="flex min-h-0 flex-1">
        <SlidePanel
          side="left"
          width={SIDEBAR_WIDTH}
          rail={SIDEBAR_RAIL}
          state={sidebarOpen ? "open" : "rail"}
        >
          <Sidebar />
        </SlidePanel>
        <main className="flex min-w-0 flex-1 flex-col bg-paper">
          <SearchBar detailsToggle={hasDetails} />
          <ScanBanner />
          <section className="min-h-0 flex-1">
            {list ? (
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
        <SlidePanel side="right" width={DETAILS_WIDTH} state={hasDetails && detailsOpen ? "open" : "hidden"}>
          <DetailsPane />
        </SlidePanel>
      </div>
      <StatusBar />
      <Toasts />
    </div>
  );
}

/** The index couldn't be read at startup (e.g. the database is locked or damaged). */
function StartupError({ message }: { message: string }) {
  const refresh = useIndex((s) => s.refresh);
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center animate-fade">
      <Mark className="size-10" />
      <h1 className="mt-5 font-display text-[20px] font-semibold text-ink">Paperlight couldn't open its index</h1>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-graphite">{message}</p>
      <button
        type="button"
        onClick={() => {
          useIndex.setState({ error: null });
          refresh();
        }}
        className="mt-6 h-9 rounded-md bg-ink px-4 text-[13px] font-medium text-on-ink hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
