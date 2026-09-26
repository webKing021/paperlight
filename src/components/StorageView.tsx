import clsx from "clsx";
import { useEffect, useState } from "react";
import { api, type StorageInsights } from "../lib/api";
import { FILE_KINDS } from "../lib/fileKinds";
import { formatSize } from "../lib/format";
import { useIndex } from "../stores";
import { DocRow, SectionLabel } from "./DocRow";

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
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">
        Storage
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 border-b border-line">
          <Figure label="Documents" value={count.toLocaleString()} />
          <Figure label="Size on disk" value={formatSize(size)} />
          <Figure
            label="Paperlight index"
            value={formatSize(data.indexBytes)}
            note="Names, folders and searchable text"
          />
        </div>

        <SectionLabel right={<span>Share of size</span>}>By type</SectionLabel>
        {data.byKind.map((k) => {
          const info = FILE_KINDS[k.kind];
          const share = size > 0 ? k.size / size : 0;
          return (
            <div
              key={k.kind}
              className="grid h-10 grid-cols-[140px_90px_80px_minmax(0,1fr)_44px] items-center gap-4 border-b border-line/60 px-5"
            >
              <span className="flex items-center gap-2.5 text-[13px] text-ink">
                <span className={clsx("h-4 w-[3px] rounded-full", info?.swatch)} />
                {info?.label ?? k.kind}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-graphite">
                {k.count.toLocaleString()}
              </span>
              <span className="text-right font-mono text-[11.5px] tabular-nums text-graphite">
                {formatSize(k.size)}
              </span>
              <span className="h-[3px] bg-line">
                <span
                  className={clsx("block h-full", info?.swatch)}
                  style={{ width: `${share * 100}%` }}
                />
              </span>
              <span className="text-right font-mono text-[11px] tabular-nums text-pencil">
                {share > 0 && share < 0.005 ? "<1" : Math.round(share * 100)}%
              </span>
            </div>
          );
        })}

        <SectionLabel>Largest documents</SectionLabel>
        {data.largest.map((row) => (
          <DocRow key={row.id} row={row} />
        ))}
        <div className="h-6" />
      </div>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border-r border-line px-5 py-4 last:border-r-0">
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-pencil">{label}</div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.01em] text-ink">{value}</div>
      {note && <div className="text-[11.5px] text-pencil">{note}</div>}
    </div>
  );
}
