import { EmptyState } from "./components/EmptyState";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { useApplyTheme } from "./lib/useTheme";

export default function App() {
  useApplyTheme();

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <SearchBar />
          <section className="min-h-0 flex-1 overflow-auto">
            <EmptyState />
          </section>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
