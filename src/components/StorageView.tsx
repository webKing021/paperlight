import { useEffect, useState } from "react";
import { api, type StorageInsights } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { DocRow, PageHeader, SectionLabel } from "./DocRow";
import { FileIcon } from "./FileIcon";

export default function StorageView() {
  const revision = useIndex((s) => s.revision);
  const [data, setData] = useState<StorageInsights | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.storageInsights().then((d) => !cancelled && setData(d), () => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);

  if (!data) return null;
  const count = data.byKind.reduce((n, k) => n + k.count, 0);
  const size = data.byKind.reduce((n, k) => n + k.size, 0);

  return (
    <div className="h-full overflow-y-auto animate-fade">
      <PageHeader title="Storage" summary="How much space your documents take, and which ones take the most." />
      <div className="grid grid-cols-3 gap-3 px-5 pt-4">
        <Figure label="Documents" value={count.toLocaleString()} />
        <Figure label="Size on disk" value={formatSize(size)} />
        <Figure
          label="Paperlight index"
          value={formatSize(data.indexBytes)}
          note="Names, folders and searchable text"
        />
      </div>

      <SectionLabel right="Share of size">By type</SectionLabel>
      <div className="px-5 pt-1">
        {data.byKind.map((k) => {
          const info = FILE_KINDS[k.kind];
          const share = size > 0 ? k.size / size : 0;
          return (
            <div
              key={k.kind}
              className="grid h-12 grid-cols-[160px_90px_80px_minmax(0,1fr)_44px] items-center gap-4 border-b border-line last:border-b-0"
            >
              <span className="flex items-center gap-2.5 text-[13px] font-medium text-ink">
                <FileIcon kind={k.kind} size={24} />
                {info?.label ?? k.kind}
              </span>
              <span className="text-right text-[12.5px] tabular-nums text-graphite">
                {k.count.toLocaleString()} docs
              </span>
              <span className="text-right text-[12.5px] tabular-nums text-graphite">{formatSize(k.size)}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-paper-2">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(share * 100, share > 0 ? 1 : 0)}%`,
                    background: `var(--${k.kind})`,
                  }}
                />
              </span>
              <span className="text-right text-[12px] tabular-nums text-pencil">
                {share > 0 && share < 0.005 ? "<1" : Math.round(share * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      <SectionLabel>Largest documents</SectionLabel>
      <div className="pt-1">
        {data.largest.map((row) => (
          <DocRow key={row.id} row={row} />
        ))}
      </div>
      <div className="h-6" />
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-sheet px-4 py-3.5">
      <div className="text-[12.5px] text-graphite">{label}</div>
      <div className="mt-1 font-display text-[24px] font-semibold tabular-nums tracking-[-0.015em] text-ink">
        {value}
      </div>
      {note && <div className="text-[12px] text-pencil">{note}</div>}
    </div>
  );
}
