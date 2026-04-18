"use client";

import { useState, useEffect, useRef } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronDown, ChevronRight, Download, ExternalLink } from "lucide-react";
import {
  ChartRenderer, ChartConfig, ChartType, defaultChartConfig, normalizeConfig,
  resolveRows, seriesColor, regressionKey, parseRegressionKey, REGRESSION_LABELS,
} from "./ChartRenderer";
import { getDatasetMeta, loadDataset, listDatasetsWithPageNames, Dataset } from "@/lib/storage";

// ── ブロック固有設定 ──────────────────────────────────────────────

type BlockChartConfig = ChartConfig & {
  collapsed: boolean;
  chartWidth: number;
  chartHeight: number;
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

// ── データセット選択ダイアログ ──────────────────────────────────────

function DatasetSelector({ onSelect, onClose }: { onSelect: (id: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const datasets = listDatasetsWithPageNames();
  const filtered = datasets.filter((d) => {
    const q = filter.toLowerCase();
    return !q || d.name.toLowerCase().includes(q) || d.pageName.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-[420px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">データセットを選択</h3>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="検索..."
            className="w-full text-sm px-3 py-2 border border-gray-200 rounded outline-none focus:border-blue-400"
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-6">データセットが見つかりません</div>
          )}
          {filtered.map((d) => {
            const ds = loadDataset(d.id);
            const rows = ds?.rows.length ?? 0;
            const cols = ds?.headers.length ?? 0;
            return (
              <button
                key={d.id}
                onClick={() => onSelect(d.id)}
                className="w-full text-left px-3 py-2 rounded hover:bg-blue-50 text-sm flex items-center gap-2"
              >
                <span className="flex-1 min-w-0">
                  {d.pageName && <span className="text-gray-400">{d.pageName} / </span>}
                  <span className="font-medium text-gray-700">{d.name}</span>
                </span>
                <span className="text-xs text-gray-400 shrink-0">{cols}列 × {rows}行</span>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-2 border-t border-gray-100 text-right">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1">キャンセル</button>
        </div>
      </div>
    </div>
  );
}

// ── ChartRefView ──────────────────────────────────────────────────

function ChartRefView({ block, editor }: { block: any; editor: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { datasetId, sourcePageId } = block.props as { datasetId: string; sourcePageId: string };
  const [config, setConfig] = useState<BlockChartConfig>(() => loadBlockConfig(block.id));
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [showSelector, setShowSelector] = useState(!datasetId);
  const outerRef = useRef<HTMLDivElement>(null);

  const meta = datasetId ? getDatasetMeta(datasetId) : null;
  const datasetName = meta?.name ?? "";

  // ── ソースページ名の解決 ──
  const [sourceName, setSourceName] = useState("");
  useEffect(() => {
    if (!meta) { setSourceName(""); return; }
    const pid = meta.pageId || sourcePageId;
    if (!pid) { setSourceName(""); return; }
    try {
      const { loadTree } = require("@/lib/storage");
      const tree = loadTree();
      setSourceName(tree[pid]?.title ?? "");
    } catch { setSourceName(""); }
  }, [meta, sourcePageId]);

  // ── データセット読み込み ──
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
  const {
    xColumn, yColumns, title, headerRow, dataStartRow, dataEndRow,
    showDataRange, showLegend, chartType, regressions, errorColumns,
    xAxisScale, yAxisScale, xAxisLabel, yAxisLabel,
    yAxisSide, y2AxisLabel, y2AxisScale,
  } = normalized;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      setChartFocused(el.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

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

  const handleSelectDataset = (id: string) => {
    const m = getDatasetMeta(id);
    try {
      editor.updateBlock(block, { props: { datasetId: id, sourcePageId: m?.pageId ?? "" } });
    } catch { /* ignore */ }
    setShowSelector(false);
  };

  const navigateToSource = () => {
    const pid = meta?.pageId || sourcePageId;
    if (pid) {
      window.dispatchEvent(new CustomEvent("lablate-navigate-page", { detail: { pageId: pid } }));
    }
  };

  // ── 列オプション ──
  const colOptions = dataset
    ? dataset.headers.map((_, i) => {
        const { colLabel } = resolveRows(dataset, headerRow, dataStartRow, dataEndRow);
        return { value: String(i), label: colLabel(i) };
      })
    : [];
  const inputCls = "text-xs border border-gray-200 rounded px-1 py-1 outline-none bg-white";

  // データ元なし
  if (!datasetId || (!meta && datasetId)) {
    return (
      <>
        {showSelector && <DatasetSelector onSelect={handleSelectDataset} onClose={() => setShowSelector(false)} />}
        <div className="my-2 rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
          {datasetId ? (
            <>
              データソースが見つかりません
              <button onClick={() => setShowSelector(true)} className="ml-2 text-blue-500 hover:text-blue-700 underline">
                再選択
              </button>
            </>
          ) : (
            <button onClick={() => setShowSelector(true)} className="text-blue-500 hover:text-blue-700 underline">
              データセットを選択
            </button>
          )}
        </div>
      </>
    );
  }

  const summaryLabel = `${sourceName ? sourceName + " / " : ""}${title || datasetName || "グラフ参照"}`;

  return (
    <>
      {showSelector && <DatasetSelector onSelect={handleSelectDataset} onClose={() => setShowSelector(false)} />}
      <div
        ref={outerRef}
        className="my-2 text-sm relative"
        style={{ width: displayW > 0 ? displayW : "100%" }}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="rounded border border-blue-200 overflow-hidden">
          {/* ── ツールバー ── */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-50/50 border-b border-blue-200 flex-wrap">
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateConfig({ collapsed: !isCollapsed })}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
            >
              {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {isCollapsed ? "展開" : "最小化"}
            </button>

            {/* ソース表示 */}
            <button
              onClick={navigateToSource}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-100/60 px-1.5 py-0.5 rounded shrink-0"
              title="元ページに移動"
            >
              <ExternalLink size={10} />
              {sourceName ? `${sourceName} / ${datasetName}` : datasetName}
            </button>

            {isCollapsed ? (
              <span className="text-xs text-gray-500 truncate">{title || "グラフ参照"}</span>
            ) : (
              <>
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

                <input
                  value={title}
                  onChange={(e) => updateConfig({ title: e.target.value })}
                  placeholder="タイトル"
                  className="text-xs px-2 py-1 border border-gray-200 rounded outline-none bg-white min-w-0 w-28"
                  onKeyDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />

                <span className="text-xs text-gray-400">X</span>
                <select value={xColumn} onChange={(e) => updateConfig({ xColumn: e.target.value })} className={inputCls}>
                  {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>

                <span className="text-xs text-gray-400">Y</span>
                {yColumns.map((yCol, si) => {
                  const regModel = regressions[yCol];
                  const regKey = regModel ? regressionKey(regModel) : "";
                  return (
                    <span key={yCol} className="inline-flex items-center gap-0.5 text-xs bg-white border border-gray-200 rounded pl-1 pr-0.5 py-0.5">
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
                        className="text-[10px] border-0 bg-transparent outline-none cursor-pointer px-0"
                        style={{ color: regKey ? seriesColor(si) : "#d1d5db", width: regKey ? "auto" : 28 }}
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
                            updateConfig({ yColumns: nextY, regressions: nextRegs });
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

                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setShowSelector(true)}
                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
                >
                  変更
                </button>

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

          {/* ── 詳細設定 ── */}
          {!isCollapsed && showDataRange && dataset && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/60 border-b border-gray-200 flex-wrap text-sm">
              <span className="text-xs text-gray-400 shrink-0">ヘッダー行</span>
              <select value={headerRow} onChange={(e) => updateConfig({ headerRow: e.target.value })} className={inputCls}>
                <option value="0">なし</option>
                {dataset.rows.map((_, i) => <option key={i} value={String(i + 1)}>行 {i + 1}</option>)}
              </select>

              <span className="text-xs text-gray-400 shrink-0">データ行</span>
              <input type="number" min="1" max={dataset.rows.length} value={dataStartRow}
                onChange={(e) => updateConfig({ dataStartRow: e.target.value })}
                placeholder="1" className={`${inputCls} w-12`} />
              <span className="text-xs text-gray-400">〜</span>
              <input type="number" min="1" max={dataset.rows.length} value={dataEndRow}
                onChange={(e) => updateConfig({ dataEndRow: e.target.value })}
                placeholder={String(dataset.rows.length)} className={`${inputCls} w-12`} />

              <div className="w-px h-4 bg-gray-200 shrink-0" />

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

              <span className="text-xs text-gray-400">X名</span>
              <input value={xAxisLabel} onChange={(e) => updateConfig({ xAxisLabel: e.target.value })}
                placeholder="自動" className={`${inputCls} w-16`}
                onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
              <span className="text-xs text-gray-400">Y名</span>
              <input value={yAxisLabel} onChange={(e) => updateConfig({ yAxisLabel: e.target.value })}
                placeholder="自動" className={`${inputCls} w-16`}
                onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
            </div>
          )}

          {/* ── グラフ本体 ── */}
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
    </>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const chartRefBlockSpec = createReactBlockSpec(
  {
    type: "chartRef" as const,
    propSchema: {
      datasetId: { default: "" },
      sourcePageId: { default: "" },
    },
    content: "none" as const,
  },
  { render: ({ block, editor }) => <ChartRefView block={block} editor={editor} /> }
);
