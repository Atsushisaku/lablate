"use client";

import { useState, useEffect, useRef } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronDown, Download } from "lucide-react";
import {
  ChartRenderer, ChartConfig, ChartType, defaultChartConfig, normalizeConfig,
  resolveRows, seriesColor, regressionKey, parseRegressionKey, REGRESSION_LABELS,
} from "./ChartRenderer";
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

  // ── データセットタブ側からの設定変更を受信して同期 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.blockId === block.id && detail?.config) {
        setConfig((prev) => ({ ...prev, ...detail.config }));
      }
    };
    window.addEventListener("lablate-chart-config-change", handler);
    return () => window.removeEventListener("lablate-chart-config-change", handler);
  }, [block.id]);

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
  const {
    xColumn, yColumns, title, headerRow, dataStartRow, dataEndRow,
    showDataRange, showLegend, chartType, markerVisible, barMode, histogramBins,
    errorColumns, regressions,
    xAxisScale, yAxisScale, xAxisLabel, yAxisLabel,
    xAxisMin, xAxisMax, yAxisMin, yAxisMax,
    yAxisSide, y2AxisLabel, y2AxisScale,
  } = normalized;

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
  const inputCls = "shrink-0 text-xs border border-gray-200 rounded px-1.5 py-0.5 outline-none bg-white h-[22px]";

  // ── エクスポート ──
  const plotContainerRef = useRef<HTMLDivElement>(null);
  const handleExport = (format: "png" | "svg") => {
    const plotEl = outerRef.current?.querySelector("[class*='js-plotly-plot']") as HTMLDivElement | null;
    if (!plotEl) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import("plotly.js-dist-min") as Promise<any>).then((Plotly) => {
      const P = Plotly.default ?? Plotly;
      P.downloadImage(plotEl, {
        format,
        filename: title || "chart",
        width: plotEl.offsetWidth * (format === "png" ? 2 : 1),
        height: chartHeight * (format === "png" ? 2 : 1),
        scale: format === "png" ? 2 : 1,
      });
    });
  };

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
        {/* ── 統合ツールバー（最小化 + 設定を同一行、超過分は横スクロール） ── */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border-b border-gray-200 overflow-x-auto">
          {/* 最小化 */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => updateConfig({ collapsed: !isCollapsed })}
            title={isCollapsed ? "展開" : "最小化"}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
            />
          </button>

          {isCollapsed ? (
            <span className="text-xs text-gray-500 truncate">{summaryLabel}</span>
          ) : (
            <>
              {/* タイトル */}
              <input
                value={title}
                onChange={(e) => updateConfig({ title: e.target.value })}
                placeholder="グラフタイトル"
                className="shrink-0 text-[11px] px-1.5 h-[22px] border border-gray-200 rounded outline-none bg-white w-32"
                onKeyDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />

              {/* グラフ種別 */}
              <select
                value={chartType}
                onChange={(e) => updateConfig({ chartType: e.target.value as ChartType })}
                className={inputCls}
              >
                <option value="scatter">散布図</option>
                <option value="line">折れ線</option>
                <option value="bar">棒グラフ</option>
                <option value="histogram">ヒストグラム</option>
                <option value="box">箱ひげ図</option>
              </select>

              {/* 画像保存 */}
              <div className="shrink-0 relative group">
                <button
                  className="flex items-center justify-center text-xs px-1.5 py-0.5 h-[22px] rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
                  title="画像保存"
                >
                  <Download size={12} />
                </button>
                <div className="hidden group-hover:flex absolute top-full left-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg z-20 flex-col">
                  <button onClick={() => handleExport("png")} className="text-xs px-3 py-1.5 hover:bg-gray-100 text-left whitespace-nowrap">PNG</button>
                  <button onClick={() => handleExport("svg")} className="text-xs px-3 py-1.5 hover:bg-gray-100 text-left whitespace-nowrap">SVG</button>
                </div>
              </div>

              {/* 詳細設定トグル */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateConfig({ showDataRange: !showDataRange })}
                className="shrink-0 flex items-center gap-0.5 text-xs px-2 py-0.5 h-[22px] rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform duration-150 ${showDataRange ? "" : "-rotate-90"}`}
                />
                詳細
              </button>

              {/* データセット名（情報タグ、右端） */}
              {datasetName && (
                <span className="inline-flex items-center text-[11px] text-gray-400 bg-gray-100 px-1.5 h-[22px] rounded shrink-0 truncate max-w-[120px] ml-auto">
                  {datasetName}
                </span>
              )}
            </>
          )}
        </div>

        {/* ── 詳細設定（折りたたみ、デフォルト非表示） ── */}
        {!isCollapsed && showDataRange && dataset && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/60 border-b border-gray-200 flex-wrap text-sm">
            {/* X 列 */}
            <span className="shrink-0 text-xs text-gray-400">X</span>
            <select value={xColumn} onChange={(e) => updateConfig({ xColumn: e.target.value })} className={inputCls}>
              {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>

            {/* Y 列（複数 + 回帰） */}
            <span className="shrink-0 text-xs text-gray-400">Y</span>
            {yColumns.map((yCol, si) => {
              const regModel = regressions[yCol];
              const regKey = regModel ? regressionKey(regModel) : "";
              return (
                <span key={yCol} className="shrink-0 inline-flex items-center gap-0.5 text-xs bg-white border border-gray-200 rounded pl-1.5 pr-0.5 h-[22px]">
                  <span style={{ color: seriesColor(si) }} className="font-medium">
                    {colOptions.find((o) => o.value === yCol)?.label ?? yCol}
                  </span>
                  <select
                    value={regKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      const next = { ...regressions };
                      if (!val) { delete next[yCol]; } else { next[yCol] = parseRegressionKey(val); }
                      updateConfig({ regressions: next });
                    }}
                    className="text-[10px] border-0 bg-transparent outline-none cursor-pointer px-0 font-medium h-full"
                    style={{ color: regKey ? seriesColor(si) : "#1f2937", width: regKey ? "auto" : 28 }}
                    title="回帰モデル"
                  >
                    <option value="">--</option>
                    {Object.entries(REGRESSION_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  {yColumns.length > 1 && (
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const nextY = yColumns.filter((c) => c !== yCol);
                        const nextRegs = { ...regressions };
                        delete nextRegs[yCol];
                        const nextErr = { ...errorColumns };
                        delete nextErr[yCol];
                        updateConfig({ yColumns: nextY, regressions: nextRegs, errorColumns: nextErr });
                      }}
                      className="text-gray-400 hover:text-gray-600 px-0.5"
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

            {/* 凡例トグル */}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateConfig({ showLegend: !showLegend })}
              className={`shrink-0 text-xs px-2 py-0.5 h-[22px] rounded border font-medium transition-colors ${
                showLegend
                  ? "border-blue-300 bg-blue-50 text-blue-600"
                  : "border-gray-300 bg-white text-gray-400 hover:bg-gray-50"
              }`}
            >
              凡例
            </button>

            <div className="w-px h-4 bg-gray-200 shrink-0" />

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

            <div className="w-px h-4 bg-gray-200 shrink-0" />

            {/* 軸スケール */}
            <span className="text-xs text-gray-400">X軸</span>
            <select value={xAxisScale} onChange={(e) => updateConfig({ xAxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
              <option value="linear">線形</option>
              <option value="log">対数</option>
            </select>
            <span className="text-xs text-gray-400">Y軸</span>
            <select value={yAxisScale} onChange={(e) => updateConfig({ yAxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
              <option value="linear">線形</option>
              <option value="log">対数</option>
            </select>

            <div className="w-px h-4 bg-gray-200 shrink-0" />

            {/* 軸ラベル */}
            <span className="text-xs text-gray-400">X名</span>
            <input value={xAxisLabel} onChange={(e) => updateConfig({ xAxisLabel: e.target.value })}
              placeholder="自動" className={`${inputCls} w-16`}
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
            <span className="text-xs text-gray-400">Y名</span>
            <input value={yAxisLabel} onChange={(e) => updateConfig({ yAxisLabel: e.target.value })}
              placeholder="自動" className={`${inputCls} w-16`}
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

            <div className="w-px h-4 bg-gray-200 shrink-0" />

            {/* 軸範囲 */}
            <span className="text-xs text-gray-400">X範囲</span>
            <input value={xAxisMin} onChange={(e) => updateConfig({ xAxisMin: e.target.value })}
              placeholder="auto" className={`${inputCls} w-14`} type="number"
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
            <span className="text-xs text-gray-400">〜</span>
            <input value={xAxisMax} onChange={(e) => updateConfig({ xAxisMax: e.target.value })}
              placeholder="auto" className={`${inputCls} w-14`} type="number"
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

            <span className="text-xs text-gray-400">Y範囲</span>
            <input value={yAxisMin} onChange={(e) => updateConfig({ yAxisMin: e.target.value })}
              placeholder="auto" className={`${inputCls} w-14`} type="number"
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
            <span className="text-xs text-gray-400">〜</span>
            <input value={yAxisMax} onChange={(e) => updateConfig({ yAxisMax: e.target.value })}
              placeholder="auto" className={`${inputCls} w-14`} type="number"
              onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

            {/* 折れ線マーカー / 棒グラフモード / ヒストグラムビン */}
            {chartType === "line" && (
              <>
                <div className="w-px h-4 bg-gray-200 shrink-0" />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateConfig({ markerVisible: !markerVisible })}
                  className={`text-xs px-2 py-1 rounded border font-medium transition-colors ${
                    markerVisible ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-300 bg-white text-gray-400"
                  }`}
                >
                  マーカー
                </button>
              </>
            )}
            {chartType === "bar" && (
              <>
                <div className="w-px h-4 bg-gray-200 shrink-0" />
                <select value={barMode} onChange={(e) => updateConfig({ barMode: e.target.value as "group" | "stack" })} className={inputCls}>
                  <option value="group">グループ</option>
                  <option value="stack">積み上げ</option>
                </select>
              </>
            )}
            {chartType === "histogram" && (
              <>
                <div className="w-px h-4 bg-gray-200 shrink-0" />
                <span className="text-xs text-gray-400">ビン数</span>
                <input
                  value={histogramBins === "auto" ? "" : histogramBins}
                  onChange={(e) => updateConfig({ histogramBins: e.target.value ? parseInt(e.target.value) || "auto" : "auto" })}
                  placeholder="auto" className={`${inputCls} w-14`} type="number" min="1"
                  onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
              </>
            )}

            {/* エラーバー列選択 */}
            {(chartType === "scatter" || chartType === "line" || chartType === "bar") && (
              <>
                <div className="w-px h-4 bg-gray-200 shrink-0" />
                <span className="text-xs text-gray-400">誤差列</span>
                {yColumns.map((yCol, si) => (
                  <span key={`err-${yCol}`} className="inline-flex items-center gap-0.5 text-xs">
                    <span style={{ color: seriesColor(si) }} className="font-medium text-[10px]">
                      {colOptions.find((o) => o.value === yCol)?.label ?? yCol}:
                    </span>
                    <select
                      value={errorColumns[yCol] ?? ""}
                      onChange={(e) => {
                        const next = { ...errorColumns };
                        if (e.target.value) next[yCol] = e.target.value;
                        else delete next[yCol];
                        updateConfig({ errorColumns: next });
                      }}
                      className={`${inputCls} text-[10px]`}
                    >
                      <option value="">なし</option>
                      {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </span>
                ))}
              </>
            )}

            {/* 第2Y軸 */}
            {yColumns.length > 1 && (
              <>
                <div className="w-px h-4 bg-gray-200 shrink-0" />
                <span className="text-xs text-gray-400">Y軸割当</span>
                {yColumns.map((yCol, si) => (
                  <span key={`side-${yCol}`} className="inline-flex items-center gap-0.5 text-xs">
                    <span style={{ color: seriesColor(si) }} className="font-medium text-[10px]">
                      {colOptions.find((o) => o.value === yCol)?.label ?? yCol}:
                    </span>
                    <select
                      value={yAxisSide[yCol] ?? "y1"}
                      onChange={(e) => {
                        const next = { ...yAxisSide };
                        next[yCol] = e.target.value as "y1" | "y2";
                        updateConfig({ yAxisSide: next });
                      }}
                      className={`${inputCls} text-[10px]`}
                    >
                      <option value="y1">左</option>
                      <option value="y2">右</option>
                    </select>
                  </span>
                ))}
                {Object.values(yAxisSide).some((s) => s === "y2") && (
                  <>
                    <span className="text-xs text-gray-400">Y2名</span>
                    <input value={y2AxisLabel} onChange={(e) => updateConfig({ y2AxisLabel: e.target.value })}
                      placeholder="自動" className={`${inputCls} w-16`}
                      onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
                    <select value={y2AxisScale} onChange={(e) => updateConfig({ y2AxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
                      <option value="linear">線形</option>
                      <option value="log">対数</option>
                    </select>
                  </>
                )}
              </>
            )}
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
