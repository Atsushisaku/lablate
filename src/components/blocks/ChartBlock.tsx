"use client";

import { useState, useEffect, useRef } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChartRenderer, ChartConfig, defaultChartConfig, normalizeConfig, resolveRows, seriesColor } from "./ChartRenderer";
import { getDatasetMeta, loadDataset, Dataset } from "@/lib/storage";

// ── ブロック固有設定（リサイズ・折りたたみを含む） ──────────────────

type BlockChartConfig = ChartConfig & {
  collapsed: boolean;
  chartWidth: number;   // px, 0 = auto
  chartHeight: number;  // px
};

const defaultBlockConfig: BlockChartConfig = {
  ...defaultChartConfig,
  collapsed: false,
  chartWidth: 0,
  chartHeight: 340,
};

function loadBlockConfig(blockId: string): BlockChartConfig {
  if (typeof window === "undefined") return defaultBlockConfig;
  try {
    const raw = localStorage.getItem(`lablate_chart_config_${blockId}`);
    if (raw) return { ...defaultBlockConfig, ...JSON.parse(raw) } as BlockChartConfig;
  } catch { /* ignore */ }
  return defaultBlockConfig;
}

function saveBlockConfig(blockId: string, config: BlockChartConfig): void {
  localStorage.setItem(`lablate_chart_config_${blockId}`, JSON.stringify(config));
}

// ── リサイズハンドル ──────────────────────────────────────────────

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

// ── ChartView（ブロックラッパー） ──────────────────────────────────

function ChartView({ block }: { block: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { datasetId } = block.props as { datasetId: string };
  const [config, setConfig] = useState<BlockChartConfig>(() => loadBlockConfig(block.id));
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const outerRef = useRef<HTMLDivElement>(null);

  // ── データセット名 ──
  const datasetName = getDatasetMeta(datasetId)?.name ?? "";

  // ── データセット読み込み（列オプション用） ──
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

  // ── リサイズ ──
  const dragRef = useRef<{ handle: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const liveSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null);
  const [chartFocused, setChartFocused] = useState(false);

  const updateConfig = (updates: Partial<BlockChartConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBlockConfig(block.id, next);
      return next;
    });
  };

  const normalized = normalizeConfig(config);
  const { collapsed: isCollapsed, chartWidth, chartHeight } = config;
  const { xColumn, yColumns, title, headerRow, dataStartRow, dataEndRow,
          showDataRange, showLegend, regressionDegree, regressionColumns } = normalized;

  // ── フォーカス追跡 ──
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      setChartFocused(el.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  // ── ドラッグリサイズ ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let newW = d.startW, newH = d.startH;
      if (d.handle.includes("e")) newW = Math.max(200, d.startW + (e.clientX - d.startX));
      if (d.handle.includes("w")) newW = Math.max(200, d.startW - (e.clientX - d.startX));
      if (d.handle.includes("s")) newH = Math.max(100, d.startH + (e.clientY - d.startY));
      if (d.handle.includes("n")) newH = Math.max(100, d.startH - (e.clientY - d.startY));
      liveSizeRef.current = { w: newW, h: newH };
      setLiveSize({ w: newW, h: newH });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      const size = liveSizeRef.current;
      if (size) updateConfig({ chartWidth: size.w, chartHeight: size.h });
      dragRef.current = null; liveSizeRef.current = null; setLiveSize(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const startDrag = (e: React.MouseEvent, handleId: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = outerRef.current;
    if (!el) return;
    dragRef.current = {
      handle: handleId,
      startX: e.clientX, startY: e.clientY,
      startW: el.getBoundingClientRect().width, startH: config.chartHeight,
    };
  };

  const displayW = liveSize?.w ?? (chartWidth > 0 ? chartWidth : 0);
  const displayH = liveSize?.h ?? chartHeight;
  const showHandles = (chartFocused || !!liveSize) && !isCollapsed;

  // ── 折りたたみサマリー ──
  const summaryLabel = config.title || datasetName || "グラフ";

  // ── 列オプション ──
  const colOptions = dataset
    ? dataset.headers.map((_, i) => {
        const { colLabel } = resolveRows(dataset, headerRow, dataStartRow, dataEndRow);
        return { value: String(i), label: colLabel(i) };
      })
    : [];
  const totalRows = dataset?.rows.length ?? 0;
  const inputCls = "text-xs border border-gray-200 rounded px-1 py-1 outline-none bg-white";

  if (!datasetId) {
    return (
      <div className="my-2 rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
        テーブルブロックの「グラフ」からデータを渡してください
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className="my-2 text-sm relative"
      style={{ width: displayW > 0 ? displayW : "100%" }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="rounded border border-gray-200 overflow-hidden">
        {/* ── 統合ツールバー（最小化 + 設定を同一行） ── */}
        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
          {/* 最小化 */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => updateConfig({ collapsed: !isCollapsed })}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {isCollapsed ? "展開" : "最小化"}
          </button>

          {isCollapsed ? (
            /* 折りたたみ時: サマリーのみ */
            <span className="text-xs text-gray-500 truncate">{summaryLabel}</span>
          ) : (
            /* 展開時: 全設定 */
            <>
              {/* データセット名 */}
              {datasetName && (
                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0 truncate max-w-[120px]">
                  {datasetName}
                </span>
              )}

              {/* タイトル */}
              <input
                value={title}
                onChange={(e) => updateConfig({ title: e.target.value })}
                placeholder="タイトル"
                className="text-xs px-2 py-1 border border-gray-200 rounded outline-none bg-white min-w-0 w-28"
                onKeyDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />

              {/* X軸 */}
              <span className="text-xs text-gray-400">X</span>
              <select value={xColumn} onChange={(e) => updateConfig({ xColumn: e.target.value })} className={inputCls}>
                {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>

              {/* Y列（複数） */}
              <span className="text-xs text-gray-400">Y</span>
              {yColumns.map((yCol, si) => {
                const hasReg = regressionColumns.includes(yCol);
                return (
                  <span key={yCol} className="inline-flex items-center gap-0.5 text-xs bg-white border border-gray-200 rounded pl-1 pr-0.5 py-0.5">
                    <span style={{ color: seriesColor(si) }} className="font-medium">
                      {colOptions.find((o) => o.value === yCol)?.label ?? yCol}
                    </span>
                    <button
                      title={hasReg ? "回帰OFF" : "回帰ON"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const next = hasReg
                          ? regressionColumns.filter((c) => c !== yCol)
                          : [...regressionColumns, yCol];
                        updateConfig({ regressionColumns: next });
                      }}
                      className="px-0.5 rounded"
                    >
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 8C4 6 7 3 13 1.5" stroke={hasReg ? seriesColor(si) : "#d1d5db"} strokeWidth="1.5"
                          strokeDasharray={hasReg ? "3 2" : "none"} strokeLinecap="round" />
                      </svg>
                    </button>
                    {yColumns.length > 1 && (
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const next = yColumns.filter((c) => c !== yCol);
                          updateConfig({
                            yColumns: next,
                            regressionColumns: regressionColumns.filter((c) => c !== yCol),
                          });
                        }}
                        className="text-gray-300 hover:text-gray-500 px-0.5"
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
              <select
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  if (!yColumns.includes(e.target.value)) {
                    updateConfig({ yColumns: [...yColumns, e.target.value] });
                  }
                  e.target.value = "";
                }}
                className={`${inputCls} text-gray-400 w-12`}
              >
                <option value="">+</option>
                {colOptions
                  .filter((o) => !yColumns.includes(o.value))
                  .map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>

              <div className="w-px h-4 bg-gray-200 shrink-0" />

              {/* 回帰次数（回帰が1つでもONなら表示） */}
              {regressionColumns.length > 0 && (
                <select
                  value={regressionDegree}
                  onChange={(e) => updateConfig({ regressionDegree: parseInt(e.target.value) })}
                  className={inputCls}
                >
                  <option value="1">1次</option>
                  <option value="2">2次</option>
                  <option value="3">3次</option>
                </select>
              )}

              {/* 凡例トグル */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateConfig({ showLegend: !showLegend })}
                className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
                  showLegend
                    ? "border-blue-300 bg-blue-50 text-blue-600"
                    : "border-gray-300 bg-white text-gray-400 hover:bg-gray-50"
                }`}
              >
                凡例
              </button>

              <div className="w-px h-4 bg-gray-200 shrink-0" />

              {/* 詳細設定トグル */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateConfig({ showDataRange: !showDataRange })}
                className="flex items-center gap-0.5 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
              >
                {showDataRange ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                詳細
              </button>
            </>
          )}
        </div>

        {/* ── 詳細設定（折りたたみ、デフォルト非表示） ── */}
        {!isCollapsed && showDataRange && dataset && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/60 border-b border-gray-200 flex-wrap text-sm">
            <span className="text-xs text-gray-400 shrink-0">ヘッダー行</span>
            <select value={headerRow} onChange={(e) => updateConfig({ headerRow: e.target.value })} className={inputCls}>
              <option value="0">なし</option>
              {dataset.rows.map((_, i) => <option key={i} value={String(i + 1)}>行 {i + 1}</option>)}
            </select>

            <span className="text-xs text-gray-400 shrink-0">データ行</span>
            <input type="number" min="1" max={totalRows} value={dataStartRow}
              onChange={(e) => updateConfig({ dataStartRow: e.target.value })}
              placeholder="1" className={`${inputCls} w-12`} />
            <span className="text-xs text-gray-400">〜</span>
            <input type="number" min="1" max={totalRows} value={dataEndRow}
              onChange={(e) => updateConfig({ dataEndRow: e.target.value })}
              placeholder={String(totalRows)} className={`${inputCls} w-12`} />
            <span className="text-xs text-gray-400 shrink-0">行</span>
          </div>
        )}

        {/* ── グラフ本体（ツールバーなし） ── */}
        {!isCollapsed && (
          <ChartRenderer
            datasetId={datasetId}
            config={config}
            onConfigChange={updateConfig}
            height={displayH}
            showToolbar={false}
          />
        )}
      </div>

      {/* ── リサイズハンドル ── */}
      {showHandles && HANDLES.map(({ id, style }) => (
        <div key={id} onMouseDown={(e) => startDrag(e, id)}
          style={{ position: "absolute", ...style, width: 8, height: 8,
            background: "#fff", border: "2px solid #3b82f6", borderRadius: 2, zIndex: 10 }} />
      ))}

      {liveSize && (
        <div style={{ position: "absolute", inset: 0, border: "2px dashed #3b82f6", borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 9 }}>
          <span style={{ background: "rgba(59,130,246,0.9)", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
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
