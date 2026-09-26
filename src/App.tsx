import { useEffect, useMemo } from "react";
import { FileList } from "./components/FileList";
import { Onboarding } from "./components/Onboarding";
import { ScanBanner } from "./components/ScanBanner";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import type { ListQuery } from "./lib/api";
import { FILE_KINDS } from "./lib/fileKinds";
import { useApplyTheme } from "./lib/useTheme";
import { useIndex, wireIndexEvents } from "./stores";
import { useUi, type View } from "./stores/ui";

const DAY = 86_400_000;

interface ViewConfig {
  query: ListQuery | null;
  emptyTitle: string;
  emptyHint: string;
}

function viewConfig(view: View): ViewConfig {
  switch (view.type) {
    case "all":
      return {
        query: {},
        emptyTitle: "No documents yet",
        emptyHint: "Add a location or rescan to find your documents.",
      };
    case "recent":
      return {
        // Rounded to the hour so the query (and its cache key) is stable between renders.
        query: { modifiedAfter: Math.floor((Date.now() - 30 * DAY) / 3_600_000) * 3_600_000 },
        emptyTitle: "Nothing changed recently",
        emptyHint: "Documents modified in the last 30 days show up here.",
      };
    case "kind":
      return {
        query: { kind: view.kind },
        emptyTitle: `No ${FILE_KINDS[view.kind].label} files found`,
        emptyHint: "They will appear here as soon as they're indexed.",
      };
    case "opened":
      return {
        query: null,
        emptyTitle: "Recently opened",
        emptyHint: "Files you open from Paperlight will be listed here. Coming in the next update.",
      };
    case "favourites":
      return {
        query: null,
        emptyTitle: "Favourites",
        emptyHint: "Star important documents to keep them one click away. Coming soon.",
      };
    case "duplicates":
      return {
        query: null,
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
  const config = useMemo(() => viewConfig(view), [view]);

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
            ) : config.query ? (
              <FileList
                query={config.query}
                revision={revision}
                emptyTitle={config.emptyTitle}
                emptyHint={config.emptyHint}
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
    </div>
  );
}
