"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { loadDataset, Dataset } from "@/lib/storage";

// ── 公開型 ──────────────────────────────────────────────────────────

export type ChartConfig = {
  xColumn: string;
  yColumns: string[];             // 複数Y列
  title: string;
  headerRow: string;
  dataStartRow: string;
  dataEndRow: string;
  showDataRange: boolean;
  showLegend: boolean;
  regressionDegree: number;       // 1 | 2 | 3（全系列共通）
  regressionColumns: string[];    // 回帰を表示するY列のインデックス

  // ── 後方互換（旧形式からの移行用） ──
  yColumn?: string;
  showRegression?: boolean;
};

export const defaultChartConfig: ChartConfig = {
  xColumn: "0", yColumns: ["1"], title: "",
  headerRow: "0", dataStartRow: "", dataEndRow: "",
  showDataRange: false, showLegend: true, regressionDegree: 1,
  regressionColumns: [],
};

/** 旧形式の config を新形式に正規化 */
export function normalizeConfig(raw: Partial<ChartConfig>): ChartConfig {
  const config = { ...defaultChartConfig, ...raw };
  // 旧 yColumn → yColumns 移行
  if (!config.yColumns?.length && config.yColumn) {
    config.yColumns = [config.yColumn];
  }
  // 旧 showRegression → regressionColumns 移行
  if (config.showRegression && !config.regressionColumns?.length && config.yColumns?.length) {
    config.regressionColumns = [...config.yColumns];
  }
  return config;
}

// ── カラーパレット ──────────────────────────────────────────────────

const SERIES_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

// ── ユーティリティ ──────────────────────────────────────────────────

const colLetter = (i: number): string => {
  let r = "", n = i + 1;
  while (n > 0) { r = String.fromCharCode(64 + (n - 1) % 26 + 1) + r; n = Math.floor((n - 1) / 26); }
  return r;
};

export function resolveRows(ds: Dataset, headerRow: string, dataStartRow: string, dataEndRow: string) {
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

// ── 多項式回帰（最小二乗法） ────────────────────────────────────────

function polyFit(xs: number[], ys: number[], degree: number): { coeffs: number[]; rSquared: number } {
  const n = xs.length;
  const d = degree + 1;
  const mat: number[][] = [];
  for (let i = 0; i < d; i++) {
    mat[i] = new Array(d + 1).fill(0);
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += Math.pow(xs[k], i + j);
      mat[i][j] = s;
    }
    let s = 0;
    for (let k = 0; k < n; k++) s += ys[k] * Math.pow(xs[k], i);
    mat[i][d] = s;
  }
  for (let col = 0; col < d; col++) {
    let maxRow = col;
    for (let row = col + 1; row < d; row++) {
      if (Math.abs(mat[row][col]) > Math.abs(mat[maxRow][col])) maxRow = row;
    }
    [mat[col], mat[maxRow]] = [mat[maxRow], mat[col]];
    const pivot = mat[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let j = col; j <= d; j++) mat[col][j] /= pivot;
    for (let row = 0; row < d; row++) {
      if (row === col) continue;
      const factor = mat[row][col];
      for (let j = col; j <= d; j++) mat[row][j] -= factor * mat[col][j];
    }
  }
  const coeffs = mat.map((row) => row[d]);
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = polyEval(coeffs, xs[i]);
    ssRes += (ys[i] - yPred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { coeffs, rSquared };
}

function polyEval(coeffs: number[], x: number): number {
  let y = 0;
  for (let i = 0; i < coeffs.length; i++) y += coeffs[i] * Math.pow(x, i);
  return y;
}

function formatEquation(label: string, coeffs: number[], rSquared: number): string {
  const fmt = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 100) return v.toPrecision(4);
    if (abs >= 1) return v.toFixed(2);
    if (abs >= 0.01) return v.toFixed(4);
    return v.toExponential(2);
  };
  const parts: string[] = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (Math.abs(c) < 1e-15 && parts.length > 0) continue;
    const sign = parts.length > 0 ? (c >= 0 ? " + " : " − ") : (c < 0 ? "−" : "");
    const absC = fmt(Math.abs(c));
    if (i === 0) { parts.push(`${sign}${absC}`); }
    else if (i === 1) { parts.push(`${sign}${absC}x`); }
    else { parts.push(`${sign}${absC}x<sup>${i}</sup>`); }
  }
  const eq = `${label}: y = ${parts.join("") || "0"}`;
  return `${eq}  (R² = ${rSquared.toFixed(3)})`;
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
  datasetId, config: rawConfig, onConfigChange, height, showToolbar = true,
}: ChartRendererProps) {
  const config = normalizeConfig(rawConfig);
  const plotRef = useRef<HTMLDivElement>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const { xColumn, yColumns, title, headerRow, dataStartRow, dataEndRow,
          showDataRange, showLegend, regressionDegree, regressionColumns } = config;

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
    const xLabel = colLabel(xIdx);

    const xRaw = dataRows.map((r) => parseFloat(r[xIdx] ?? ""));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traces: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotations: any[] = [];
    let annotY = 0.98;

    yColumns.forEach((yCol, si) => {
      const yIdx = Math.max(0, parseInt(yCol) || 0);
      const yLabel = colLabel(yIdx);
      const color = seriesColor(si);

      // 有効なペアだけ抽出
      const pairs: { x: number; y: number }[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const xv = xRaw[i];
        const yv = parseFloat(dataRows[i][yIdx] ?? "");
        if (!isNaN(xv) && !isNaN(yv)) pairs.push({ x: xv, y: yv });
      }
      const xNum = pairs.map((p) => p.x);
      const yNum = pairs.map((p) => p.y);

      // データ点
      traces.push({
        x: xNum, y: yNum, mode: "markers", type: "scatter",
        marker: { color, size: 7, opacity: 0.8 },
        name: yLabel,
      });

      // 回帰線
      if (regressionColumns.includes(yCol) && xNum.length >= 2) {
        const degree = Math.min(regressionDegree, xNum.length - 1);
        const { coeffs, rSquared } = polyFit(xNum, yNum, degree);
        const xMin = Math.min(...xNum);
        const xMax = Math.max(...xNum);
        const steps = 200;
        const regX: number[] = [];
        const regY: number[] = [];
        for (let i = 0; i <= steps; i++) {
          const x = xMin + (xMax - xMin) * (i / steps);
          regX.push(x);
          regY.push(polyEval(coeffs, x));
        }
        traces.push({
          x: regX, y: regY, mode: "lines", type: "scatter",
          line: { color, width: 2, dash: "dash" },
          name: `${yLabel} 回帰`,
          showlegend: false,
        });
        annotations.push({
          text: formatEquation(yLabel, coeffs, rSquared),
          xref: "paper", yref: "paper", x: 0.02, y: annotY,
          showarrow: false, font: { size: 11, color },
          bgcolor: "rgba(255,255,255,0.85)", borderpad: 3,
          xanchor: "left", yanchor: "top",
        });
        annotY -= 0.07;
      }
    });

    const yAxisTitle = yColumns.length === 1
      ? colLabel(Math.max(0, parseInt(yColumns[0]) || 0))
      : "";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import("plotly.js-dist-min") as Promise<any>).then((Plotly) => {
      if (!plotRef.current) return;
      const P = Plotly.default ?? Plotly;
      P.react(
        plotRef.current,
        traces,
        {
          title: { text: title || (yAxisTitle ? `${yAxisTitle} vs ${xLabel}` : ""), font: { size: 14 } },
          xaxis: { title: { text: xLabel }, automargin: true, showline: true, linecolor: "#d1d5db", mirror: true },
          yaxis: { title: { text: yAxisTitle }, automargin: true, showline: true, linecolor: "#d1d5db", mirror: true },
          margin: { l: 55, r: showLegend ? 120 : 20, t: 45, b: 55 },
          autosize: true,
          showlegend: showLegend,
          legend: { x: 1.02, y: 1, xanchor: "left" as const, yanchor: "top" as const },
          plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
          annotations,
        },
        { responsive: true, displayModeBar: "hover" }
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, xColumn, JSON.stringify(yColumns), title, headerRow, dataStartRow, dataEndRow, height,
      regressionDegree, JSON.stringify(regressionColumns), showLegend]);

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
      {/* ── ツールバー（常時表示） ── */}
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
                    onConfigChange({ regressionColumns: next });
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
                      onConfigChange({
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
          {/* Y列追加 */}
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              if (!yColumns.includes(e.target.value)) {
                onConfigChange({ yColumns: [...yColumns, e.target.value] });
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

          {/* 回帰次数 */}
          {regressionColumns.length > 0 && (
            <select
              value={regressionDegree}
              onChange={(e) => onConfigChange({ regressionDegree: parseInt(e.target.value) })}
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
            onClick={() => onConfigChange({ showLegend: !showLegend })}
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
            onClick={() => onConfigChange({ showDataRange: !showDataRange })}
            className="flex items-center gap-0.5 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
          >
            {showDataRange ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            詳細
          </button>
        </div>
      )}

      {/* ── 詳細設定（折りたたみ、デフォルト非表示） ── */}
      {showToolbar && dataset && showDataRange && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/60 border-b border-gray-200 flex-wrap text-sm">
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
