import { FileSearch } from "lucide-react";

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <FileSearch className="size-7" strokeWidth={1.5} />
      </div>
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Every document, one place</h1>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
          Paperlight will find every PDF, Word, Excel and PowerPoint file on your PC and keep track
          of them — without moving a thing.
        </p>
      </div>
    </div>
  );
}
