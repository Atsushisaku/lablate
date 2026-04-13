"use client";

import { useState, useEffect, useRef } from "react";
import { loadDataset, Dataset } from "@/lib/storage";

// ── 公開型 ──────────────────────────────────────────────────────────

export type ChartConfig = {
  xColumn: string;
  yColumn: string;
  title: string;
  headerRow: string;
  dataStartRow: string;
  dataEndRow: string;
};

export const defaultChartConfig: ChartConfig = {
  xColumn: "0", yColumn: "1", title: "",
  headerRow: "0", dataStartRow: "", dataEndRow: "",
};

// ── ユーティリティ ──────────────────────────────────────────────────

const colLetter = (i: number): string => {
  let r = "", n = i + 1;
  while (n > 0) { r = String.fromCharCode(64 + (n - 1) % 26 + 1) + r; n = Math.floor((n - 1) / 26); }
  return r;
};

function resolveRows(ds: Dataset, headerRow: string, dataStartRow: string, dataEndRow: string) {
  const total = ds.rows.length;
  const hIdx = parseInt(headerRow) > 0 ? parseInt(headerRow) - 1 : -1;
  const start = dataStartRow && parseInt(dataStartRow) > 0
    ? Math.min(parseInt(dataStartRow) - 1, total - 1) : 0;
  const end = dataEndRow && parseInt(dataEndRow) > 0
    ? Math.min(parseInt(dataEndRow) - 1, total - 1) : total - 1;
  const colLabel = (colIdx: number) =>
    hIdx >= 0 ? (ds.rows[hIdx]?.[colIdx] || ds.headers[colIdx] || colLetter(colIdx))
              : (ds.headers[colIdx] || colLetter(colIdx));
  const dataRows = ds.rows.filter((_, i) => i >= start && i <= end && i !== hIdx);
  return { hIdx, start, end, colLabel, dataRows };
}

// ── ChartRenderer ───────────────────────────────────────────────────

export interface ChartRendererProps {
  datasetId: string;
  config: ChartConfig;
  onConfigChange: (updates: Partial<ChartConfig>) => void;
  height: number;
  showToolbar?: boolean;
}

export function ChartRenderer({
  datasetId, config, onConfigChange, height, showToolbar = true,
}: ChartRendererProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const { xColumn, yColumn, title, headerRow, dataStartRow, dataEndRow } = config;

  // ── データセットのロード ──

  useEffect(() => {
    if (!datasetId) return;
    setDataset(loadDataset(datasetId));
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.datasetId === datasetId) setDataset(loadDataset(datasetId));
    };
    window.addEventListener("lablate-dataset-change", handler);
    return () => window.removeEventListener("lablate-dataset-change", handler);
  }, [datasetId]);

  // ── Plotly 描画 ──

  useEffect(() => {
    if (!plotRef.current || !dataset || dataset.rows.length === 0) return;
    const { colLabel, dataRows } = resolveRows(dataset, headerRow, dataStartRow, dataEndRow);
    const xIdx = Math.max(0, parseInt(xColumn) || 0);
    const yIdx = Math.max(0, parseInt(yColumn) || 0);
    const xLabel = colLabel(xIdx);
    const yLabel = colLabel(yIdx);

    const toVal = (s: string) => { const v = parseFloat(s); return isNaN(v) ? s : v; };
    const xData = dataRows.map((r) => toVal(r[xIdx] ?? ""));
    const yData = dataRows.map((r) => toVal(r[yIdx] ?? ""));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import("plotly.js-dist-min") as Promise<any>).then((Plotly) => {
      if (!plotRef.current) return;
      const P = Plotly.default ?? Plotly;
      P.react(
        plotRef.current,
        [{ x: xData, y: yData, mode: "markers", type: "scatter",
           marker: { color: "#3b82f6", size: 7, opacity: 0.8 } }],
        {
          title: { text: title || `${yLabel} vs ${xLabel}`, font: { size: 14 } },
          xaxis: { title: { text: xLabel }, automargin: true, showline: true, linecolor: "#d1d5db", mirror: true },
          yaxis: { title: { text: yLabel }, automargin: true, showline: true, linecolor: "#d1d5db", mirror: true },
          margin: { l: 55, r: 20, t: 45, b: 55 },
          autosize: true,
          plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
        },
        { responsive: true, displayModeBar: "hover" }
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, xColumn, yColumn, title, headerRow, dataStartRow, dataEndRow, height]);

  if (!datasetId) {
    return (
      <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
        テーブルブロックの「グラフ」からデータを渡してください
      </div>
    );
  }

  const colOptions = dataset
    ? dataset.headers.map((_, i) => {
        const { colLabel } = resolveRows(dataset, headerRow, dataStartRow, dataEndRow);
        return { value: String(i), label: colLabel(i) };
      })
    : [];
  const totalRows = dataset?.rows.length ?? 0;
  const inputCls = "text-xs border border-gray-200 rounded px-1 py-1 outline-none bg-white";

  return (
    <div>
      {/* ── ツールバー ── */}
      {showToolbar && dataset && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap text-sm">
          <input
            value={title}
            onChange={(e) => onConfigChange({ title: e.target.value })}
            placeholder="グラフタイトル"
            className="text-xs px-2 py-1 border border-gray-200 rounded outline-none bg-white min-w-0 w-32"
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <span className="text-xs text-gray-400">X</span>
          <select value={xColumn} onChange={(e) => onConfigChange({ xColumn: e.target.value })} className={inputCls}>
            {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="text-xs text-gray-400">Y</span>
          <select value={yColumn} onChange={(e) => onConfigChange({ yColumn: e.target.value })} className={inputCls}>
            {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          <div className="w-px h-4 bg-gray-200 shrink-0" />

          <span className="text-xs text-gray-400 shrink-0">ヘッダー行</span>
          <select value={headerRow} onChange={(e) => onConfigChange({ headerRow: e.target.value })} className={inputCls}>
            <option value="0">なし</option>
            {dataset.rows.map((_, i) => <option key={i} value={String(i + 1)}>行 {i + 1}</option>)}
          </select>

          <span className="text-xs text-gray-400 shrink-0">データ行</span>
          <input type="number" min="1" max={totalRows} value={dataStartRow}
            onChange={(e) => onConfigChange({ dataStartRow: e.target.value })}
            placeholder="1" className={`${inputCls} w-12`} />
          <span className="text-xs text-gray-400">〜</span>
          <input type="number" min="1" max={totalRows} value={dataEndRow}
            onChange={(e) => onConfigChange({ dataEndRow: e.target.value })}
            placeholder={String(totalRows)} className={`${inputCls} w-12`} />
          <span className="text-xs text-gray-400 shrink-0">行</span>
        </div>
      )}

      {/* ── Plotly 描画エリア ── */}
      {dataset ? (
        <div ref={plotRef} style={{ height }} className="w-full" />
      ) : (
        <div className="p-8 text-center text-gray-400 text-sm">データ読み込み中...</div>
      )}
    </div>
  );
}
