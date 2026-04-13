"use client";

import { useState, useEffect, useRef } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { loadDataset, Dataset } from "@/lib/storage";
import { ChevronDown, ChevronRight } from "lucide-react";

// ── チャート設定 ──────────────────────────────────────────────────────

type ChartConfig = {
  xColumn: string;
  yColumn: string;
  title: string;
  collapsed: boolean;
  headerRow: string;
  dataStartRow: string;
  dataEndRow: string;
  chartWidth: number;   // px, 0 = auto (100%)
  chartHeight: number;  // px
};

const defaultConfig: ChartConfig = {
  xColumn: "0", yColumn: "1", title: "",
  collapsed: false,
  headerRow: "0",
  dataStartRow: "",
  dataEndRow: "",
  chartWidth: 0,
  chartHeight: 340,
};

function loadChartConfig(blockId: string): ChartConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(`lablate_chart_config_${blockId}`);
    if (raw) return { ...defaultConfig, ...JSON.parse(raw) } as ChartConfig;
  } catch { /* ignore */ }
  return defaultConfig;
}

function saveChartConfig(blockId: string, config: ChartConfig): void {
  localStorage.setItem(`lablate_chart_config_${blockId}`, JSON.stringify(config));
}

// ── Excel 互換列ラベル ─────────────────────────────────────────────────

const colLetter = (i: number): string => {
  let r = "", n = i + 1;
  while (n > 0) { r = String.fromCharCode(64 + (n - 1) % 26 + 1) + r; n = Math.floor((n - 1) / 26); }
  return r;
};

// ── リサイズハンドル定義 ─────────────────────────────────────────────

const HANDLES: { id: string; style: React.CSSProperties }[] = [
  { id: "n",  style: { top: -4, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
  { id: "s",  style: { bottom: -4, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
  { id: "e",  style: { right: -4, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
  { id: "w",  style: { left: -4, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
  { id: "ne", style: { top: -4, right: -4, cursor: "nesw-resize" } },
  { id: "se", style: { bottom: -4, right: -4, cursor: "nwse-resize" } },
  { id: "sw", style: { bottom: -4, left: -4, cursor: "nesw-resize" } },
  { id: "nw", style: { top: -4, left: -4, cursor: "nwse-resize" } },
];

// ── グラフ表示コンポーネント ──────────────────────────────────────────

function ChartView({ block }: { block: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { datasetId } = block.props as { datasetId: string };
  const [config, setConfig] = useState<ChartConfig>(() => loadChartConfig(block.id));
  const plotRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);

  // ── リサイズ状態（ref で安定参照） ──
  const dragRef = useRef<{
    handle: string; startX: number; startY: number; startW: number; startH: number;
  } | null>(null);
  const liveSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null);
  const [chartFocused, setChartFocused] = useState(false);

  const updateConfig = (updates: Partial<ChartConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveChartConfig(block.id, next);
      return next;
    });
  };

  const {
    xColumn, yColumn, title, collapsed: isCollapsed,
    headerRow, dataStartRow, dataEndRow,
    chartWidth, chartHeight,
  } = config;

  // ── データセットのロード ──

  useEffect(() => {
    if (!datasetId) return;
    setDataset(loadDataset(datasetId));
  }, [datasetId]);

  // ── テーブル変更時にグラフを自動更新 ──

  useEffect(() => {
    if (!datasetId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.datasetId === datasetId) {
        setDataset(loadDataset(datasetId));
      }
    };
    window.addEventListener("lablate-dataset-change", handler);
    return () => window.removeEventListener("lablate-dataset-change", handler);
  }, [datasetId]);

  // ── 行範囲の計算ヘルパー ──

  const resolveRows = (ds: Dataset) => {
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
  };

  // ── ブロック全体のフォーカス追跡（capture フェーズで stopPropagation の影響を回避） ──

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      setChartFocused(el.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  // ── ドラッグリサイズ（document レベル） ──

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      let newW = d.startW, newH = d.startH;
      if (d.handle.includes("e")) newW = Math.max(200, d.startW + dx);
      if (d.handle.includes("w")) newW = Math.max(200, d.startW - dx);
      if (d.handle.includes("s")) newH = Math.max(100, d.startH + dy);
      if (d.handle.includes("n")) newH = Math.max(100, d.startH - dy);
      const size = { w: newW, h: newH };
      liveSizeRef.current = size;
      setLiveSize({ ...size });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      const size = liveSizeRef.current;
      if (size) {
        setConfig((prev) => {
          const next = { ...prev, chartWidth: size.w, chartHeight: size.h };
          saveChartConfig(block.id, next);
          return next;
        });
      }
      dragRef.current = null;
      liveSizeRef.current = null;
      setLiveSize(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [block.id]);

  const startDrag = (e: React.MouseEvent, handleId: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = outerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      handle: handleId,
      startX: e.clientX, startY: e.clientY,
      startW: rect.width, startH: config.chartHeight,
    };
  };

  // ── 表示サイズの計算 ──
  const displayW = liveSize?.w ?? (chartWidth > 0 ? chartWidth : 0);
  const displayH = liveSize?.h ?? chartHeight;

  // ── Plotly グラフ描画 ──

  useEffect(() => {
    if (isCollapsed || !plotRef.current || !dataset || dataset.rows.length === 0) return;

    const { colLabel, dataRows } = resolveRows(dataset);
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
          xaxis: {
            title: { text: xLabel }, automargin: true,
            showline: true, linecolor: "#d1d5db", mirror: true,
          },
          yaxis: {
            title: { text: yLabel }, automargin: true,
            showline: true, linecolor: "#d1d5db", mirror: true,
          },
          margin: { l: 55, r: 20, t: 45, b: 55 },
          autosize: true,
          plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
        },
        { responsive: true, displayModeBar: "hover" }
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, xColumn, yColumn, title, isCollapsed, headerRow, dataStartRow, dataEndRow,
      chartHeight, chartWidth]);

  if (!datasetId) {
    return (
      <div className="my-2 rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
        テーブルブロックの「グラフ」からデータを渡してください
      </div>
    );
  }

  // ── 折りたたみ時のサマリー ──
  const summaryLabel = (() => {
    if (!dataset) return "グラフ";
    const { colLabel } = resolveRows(dataset);
    const xl = colLabel(parseInt(xColumn) || 0);
    const yl = colLabel(parseInt(yColumn) || 0);
    return title || `${yl} vs ${xl}`;
  })();

  // ── 列選択用オプション ──
  const colOptions = dataset
    ? dataset.headers.map((_, i) => {
        const { colLabel } = resolveRows(dataset);
        return { value: String(i), label: colLabel(i) };
      })
    : [];

  const totalRows = dataset?.rows.length ?? 0;
  const showHandles = (chartFocused || !!liveSize) && !isCollapsed;

  const inputCls = "text-xs border border-gray-200 rounded px-1 py-1 outline-none bg-white";

  return (
    <div
      ref={outerRef}
      className="my-2 text-sm relative"
      style={{ width: displayW > 0 ? displayW : "100%" }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* ── メインブロック ── */}
      <div className="rounded border border-gray-200 overflow-hidden">
        {/* ── ツールバー ── */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => updateConfig({ collapsed: !isCollapsed })}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {isCollapsed ? "展開" : "最小化"}
          </button>

          {isCollapsed ? (
            <span className="text-xs text-gray-500 truncate">{summaryLabel}</span>
          ) : (
            <>
              <input
                value={title}
                onChange={(e) => updateConfig({ title: e.target.value })}
                placeholder="グラフタイトル"
                className="text-xs px-2 py-1 border border-gray-200 rounded outline-none bg-white min-w-0 w-32"
              />

              {dataset && (
                <>
                  <span className="text-xs text-gray-400">X</span>
                  <select value={xColumn} onChange={(e) => updateConfig({ xColumn: e.target.value })}
                    className={inputCls}>
                    {colOptions.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">Y</span>
                  <select value={yColumn} onChange={(e) => updateConfig({ yColumn: e.target.value })}
                    className={inputCls}>
                    {colOptions.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>

                  <div className="w-px h-4 bg-gray-200 shrink-0" />

                  <span className="text-xs text-gray-400 shrink-0">ヘッダー行</span>
                  <select value={headerRow} onChange={(e) => updateConfig({ headerRow: e.target.value })}
                    className={inputCls}>
                    <option value="0">なし</option>
                    {dataset.rows.map((_, i) => (
                      <option key={i} value={String(i + 1)}>行 {i + 1}</option>
                    ))}
                  </select>

                  <span className="text-xs text-gray-400 shrink-0">データ行</span>
                  <input
                    type="number" min="1" max={totalRows}
                    value={dataStartRow}
                    onChange={(e) => updateConfig({ dataStartRow: e.target.value })}
                    placeholder="1"
                    className={`${inputCls} w-12`}
                  />
                  <span className="text-xs text-gray-400">〜</span>
                  <input
                    type="number" min="1" max={totalRows}
                    value={dataEndRow}
                    onChange={(e) => updateConfig({ dataEndRow: e.target.value })}
                    placeholder={String(totalRows)}
                    className={`${inputCls} w-12`}
                  />
                  <span className="text-xs text-gray-400 shrink-0">行</span>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Plotly 描画エリア ── */}
        {!isCollapsed && (
          dataset ? (
            <div ref={plotRef} style={{ height: displayH }} className="w-full" />
          ) : (
            <div className="p-8 text-center text-gray-400 text-sm">データ読み込み中...</div>
          )
        )}
      </div>

      {/* ── リサイズハンドル（ブロック選択時のみ） ── */}
      {showHandles && HANDLES.map(({ id, style }) => (
        <div
          key={id}
          onMouseDown={(e) => startDrag(e, id)}
          style={{
            position: "absolute", ...style,
            width: 8, height: 8,
            background: "#fff", border: "2px solid #3b82f6",
            borderRadius: 2, zIndex: 10,
          }}
        />
      ))}

      {/* ── ドラッグ中サイズ表示 ── */}
      {liveSize && (
        <div
          style={{
            position: "absolute", inset: 0,
            border: "2px dashed #3b82f6",
            borderRadius: 4,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 9,
          }}
        >
          <span
            style={{
              background: "rgba(59,130,246,0.9)", color: "#fff",
              padding: "2px 8px", borderRadius: 4, fontSize: 11,
            }}
          >
            {Math.round(liveSize.w)} × {Math.round(liveSize.h)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const chartBlockSpec = createReactBlockSpec(
  {
    type: "chart" as const,
    propSchema: { datasetId: { default: "" } },
    content: "none" as const,
  },
  { render: ({ block }) => <ChartView block={block} /> }
);
