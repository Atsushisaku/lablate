"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Download } from "lucide-react";
import { loadDataset, Dataset } from "@/lib/storage";

// ── 公開型 ──────────────────────────────────────────────────────────

export type ChartType = "scatter" | "line" | "bar" | "histogram" | "box";

export type RegressionModel =
  | { type: "poly"; degree: 1 | 2 | 3 }
  | { type: "exp" }
  | { type: "log" }
  | { type: "power" }
  | { type: "4pl" };

export type ChartConfig = {
  xColumn: string;
  yColumns: string[];
  title: string;
  headerRow: string;
  dataStartRow: string;
  dataEndRow: string;
  showDataRange: boolean;
  showLegend: boolean;

  // --- グラフ種別 ---
  chartType: ChartType;
  markerVisible: boolean;
  barMode: "group" | "stack";
  histogramBins: number | "auto";

  // --- エラーバー ---
  errorColumns: Record<string, string>; // { [yColIdx]: errorColIdx }

  // --- 回帰 (新: 系列ごと独立) ---
  regressions: Record<string, RegressionModel>;

  // --- 軸 ---
  xAxisScale: "linear" | "log";
  yAxisScale: "linear" | "log";
  xAxisLabel: string;
  yAxisLabel: string;
  xAxisMin: string;
  xAxisMax: string;
  yAxisMin: string;
  yAxisMax: string;

  // --- 第2Y軸 ---
  yAxisSide: Record<string, "y1" | "y2">;
  y2AxisLabel: string;
  y2AxisScale: "linear" | "log";
  y2AxisMin: string;
  y2AxisMax: string;

  // ── 後方互換 ──
  regressionDegree?: number;
  regressionColumns?: string[];
  yColumn?: string;
  showRegression?: boolean;
};

export const defaultChartConfig: ChartConfig = {
  xColumn: "0",
  yColumns: ["1"],
  title: "",
  headerRow: "0",
  dataStartRow: "",
  dataEndRow: "",
  showDataRange: false,
  showLegend: true,
  chartType: "scatter",
  markerVisible: true,
  barMode: "group",
  histogramBins: "auto",
  errorColumns: {},
  regressions: {},
  xAxisScale: "linear",
  yAxisScale: "linear",
  xAxisLabel: "",
  yAxisLabel: "",
  xAxisMin: "",
  xAxisMax: "",
  yAxisMin: "",
  yAxisMax: "",
  yAxisSide: {},
  y2AxisLabel: "",
  y2AxisScale: "linear",
  y2AxisMin: "",
  y2AxisMax: "",
};

/** 旧形式の config を新形式に正規化 */
export function normalizeConfig(raw: Partial<ChartConfig>): ChartConfig {
  const config = { ...defaultChartConfig, ...raw };
  // 旧 yColumn → yColumns 移行
  if (!config.yColumns?.length && config.yColumn) {
    config.yColumns = [config.yColumn];
  }
  // 旧 regressionColumns + regressionDegree → regressions 移行
  if (config.regressionColumns?.length && !Object.keys(config.regressions ?? {}).length) {
    const deg = (config.regressionDegree ?? 1) as 1 | 2 | 3;
    const regs: Record<string, RegressionModel> = {};
    for (const col of config.regressionColumns) {
      regs[col] = { type: "poly", degree: deg };
    }
    config.regressions = regs;
  }
  // 旧 showRegression → regressions 移行
  if (config.showRegression && !Object.keys(config.regressions ?? {}).length && config.yColumns?.length) {
    const deg = (config.regressionDegree ?? 1) as 1 | 2 | 3;
    const regs: Record<string, RegressionModel> = {};
    for (const col of config.yColumns) {
      regs[col] = { type: "poly", degree: deg };
    }
    config.regressions = regs;
  }
  // ensure objects
  if (!config.errorColumns) config.errorColumns = {};
  if (!config.regressions) config.regressions = {};
  if (!config.yAxisSide) config.yAxisSide = {};
  return config;
}

// ── カラーパレット ──────────────────────────────────────────────────

const SERIES_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
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

// ── 指数回帰: y = a * exp(b * x) ──

function expFit(xs: number[], ys: number[]): { a: number; b: number; rSquared: number } | null {
  // ln(y) = ln(a) + b*x → 正の y のみ使用
  const pairs = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => p.y > 0);
  if (pairs.length < 2) return null;
  const lnYs = pairs.map((p) => Math.log(p.y));
  const xp = pairs.map((p) => p.x);
  const { coeffs, rSquared } = polyFit(xp, lnYs, 1);
  return { a: Math.exp(coeffs[0]), b: coeffs[1], rSquared };
}

// ── 対数回帰: y = a * ln(x) + b ──

function logFit(xs: number[], ys: number[]): { a: number; b: number; rSquared: number } | null {
  const pairs = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => p.x > 0);
  if (pairs.length < 2) return null;
  const lnXs = pairs.map((p) => Math.log(p.x));
  const yp = pairs.map((p) => p.y);
  const { coeffs, rSquared } = polyFit(lnXs, yp, 1);
  return { a: coeffs[1], b: coeffs[0], rSquared }; // y = a*ln(x) + b
}

// ── べき乗回帰: y = a * x^b ──

function powerFit(xs: number[], ys: number[]): { a: number; b: number; rSquared: number } | null {
  const pairs = xs.map((x, i) => ({ x, y: ys[i] })).filter((p) => p.x > 0 && p.y > 0);
  if (pairs.length < 2) return null;
  const lnXs = pairs.map((p) => Math.log(p.x));
  const lnYs = pairs.map((p) => Math.log(p.y));
  const { coeffs, rSquared } = polyFit(lnXs, lnYs, 1);
  return { a: Math.exp(coeffs[0]), b: coeffs[1], rSquared };
}

// ── 4PL: y = d + (a - d) / (1 + (x/c)^b) ──

function fourPLFit(xs: number[], ys: number[]): { a: number; b: number; c: number; d: number; rSquared: number } | null {
  if (xs.length < 4) return null;
  // 初期値推定
  const sorted = xs.map((x, i) => ({ x, y: ys[i] })).sort((a, b) => a.x - b.x);
  let aInit = sorted[0].y;
  let dInit = sorted[sorted.length - 1].y;
  if (Math.abs(aInit - dInit) < 1e-12) return null;
  const cInit = (sorted[0].x + sorted[sorted.length - 1].x) / 2;
  let bInit = 1;

  let a = aInit, b = bInit, c = Math.max(cInit, 1e-10), d = dInit;

  // Levenberg-Marquardt 簡易実装
  let lambda = 0.01;
  const maxIter = 200;

  for (let iter = 0; iter < maxIter; iter++) {
    // 残差と Jacobian
    const r: number[] = [];
    const J: number[][] = [];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      const ratio = Math.max(x / c, 1e-30);
      const rb = Math.pow(ratio, b);
      const denom = 1 + rb;
      const yPred = d + (a - d) / denom;
      r.push(ys[i] - yPred);

      // 偏微分
      const da = 1 / denom;
      const dd = 1 - 1 / denom;
      const db = -(a - d) * rb * Math.log(Math.max(ratio, 1e-30)) / (denom * denom);
      const dc = -(a - d) * (-b / c) * rb / (denom * denom);
      J.push([da, db, dc, dd]);
    }

    // J^T * J + lambda * diag
    const params = [a, b, c, d];
    const JtJ: number[][] = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const JtR: number[] = new Array(4).fill(0);
    for (let i = 0; i < xs.length; i++) {
      for (let p = 0; p < 4; p++) {
        JtR[p] += J[i][p] * r[i];
        for (let q = 0; q < 4; q++) {
          JtJ[p][q] += J[i][p] * J[i][q];
        }
      }
    }
    for (let p = 0; p < 4; p++) JtJ[p][p] += lambda * (JtJ[p][p] + 1e-8);

    // Solve 4x4 system (Gauss elimination)
    const aug = JtJ.map((row, i) => [...row, JtR[i]]);
    let solvable = true;
    for (let col = 0; col < 4; col++) {
      let maxRow = col;
      for (let row = col + 1; row < 4; row++) {
        if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
      }
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
      if (Math.abs(aug[col][col]) < 1e-20) { solvable = false; break; }
      const pivot = aug[col][col];
      for (let j = col; j <= 4; j++) aug[col][j] /= pivot;
      for (let row = 0; row < 4; row++) {
        if (row === col) continue;
        const f = aug[row][col];
        for (let j = col; j <= 4; j++) aug[row][j] -= f * aug[col][j];
      }
    }
    if (!solvable) break;

    const delta = aug.map((row) => row[4]);
    const newParams = params.map((p, i) => p + delta[i]);
    // c must be positive
    if (newParams[2] <= 0) newParams[2] = c * 0.5;

    // Evaluate new residuals
    let oldSS = 0, newSS = 0;
    for (let i = 0; i < xs.length; i++) {
      oldSS += r[i] ** 2;
      const ratio = Math.max(xs[i] / newParams[2], 1e-30);
      const yPred = newParams[3] + (newParams[0] - newParams[3]) / (1 + Math.pow(ratio, newParams[1]));
      newSS += (ys[i] - yPred) ** 2;
    }

    if (newSS < oldSS) {
      a = newParams[0]; b = newParams[1]; c = newParams[2]; d = newParams[3];
      lambda *= 0.5;
    } else {
      lambda *= 5;
    }
    if (lambda > 1e10) break;
  }

  // R²
  const yMean = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < xs.length; i++) {
    const ratio = Math.max(xs[i] / c, 1e-30);
    const yPred = d + (a - d) / (1 + Math.pow(ratio, b));
    ssRes += (ys[i] - yPred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { a, b, c, d, rSquared };
}

// ── 数式フォーマット ────────────────────────────────────────────────

const fmtCoeff = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toPrecision(4);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.01) return v.toFixed(4);
  return v.toExponential(2);
};

function formatPolyEquation(label: string, coeffs: number[], rSquared: number): string {
  const parts: string[] = [];
  for (let i = coeffs.length - 1; i >= 0; i--) {
    const c = coeffs[i];
    if (Math.abs(c) < 1e-15 && parts.length > 0) continue;
    const sign = parts.length > 0 ? (c >= 0 ? " + " : " − ") : (c < 0 ? "−" : "");
    const absC = fmtCoeff(Math.abs(c));
    if (i === 0) parts.push(`${sign}${absC}`);
    else if (i === 1) parts.push(`${sign}${absC}x`);
    else parts.push(`${sign}${absC}x<sup>${i}</sup>`);
  }
  return `${label}: y = ${parts.join("") || "0"}  (R² = ${rSquared.toFixed(3)})`;
}

function formatRegressionEquation(label: string, model: RegressionModel, params: Record<string, number>, rSquared: number): string {
  const f = fmtCoeff;
  switch (model.type) {
    case "poly":
      return ""; // handled separately
    case "exp":
      return `${label}: y = ${f(params.a)}·e<sup>${f(params.b)}x</sup>  (R² = ${rSquared.toFixed(3)})`;
    case "log":
      return `${label}: y = ${f(params.a)}·ln(x) + ${f(params.b)}  (R² = ${rSquared.toFixed(3)})`;
    case "power":
      return `${label}: y = ${f(params.a)}·x<sup>${f(params.b)}</sup>  (R² = ${rSquared.toFixed(3)})`;
    case "4pl":
      return `${label}: 4PL (c=${f(params.c)})  (R² = ${rSquared.toFixed(3)})`;
  }
}

/** 回帰線のX値とY値を生成する */
function generateRegressionCurve(
  model: RegressionModel,
  xs: number[],
  ys: number[],
  xMin: number,
  xMax: number,
): { regX: number[]; regY: number[]; equation: string; rSquared: number } | null {
  const steps = 200;
  const makeXs = (min: number, max: number) => {
    const arr: number[] = [];
    for (let i = 0; i <= steps; i++) arr.push(min + (max - min) * (i / steps));
    return arr;
  };

  switch (model.type) {
    case "poly": {
      const degree = Math.min(model.degree, xs.length - 1);
      if (degree < 1) return null;
      const { coeffs, rSquared } = polyFit(xs, ys, degree);
      const regX = makeXs(xMin, xMax);
      return { regX, regY: regX.map((x) => polyEval(coeffs, x)), equation: "", rSquared };
    }
    case "exp": {
      const result = expFit(xs, ys);
      if (!result) return null;
      const regX = makeXs(xMin, xMax);
      return { regX, regY: regX.map((x) => result.a * Math.exp(result.b * x)), equation: "", rSquared: result.rSquared };
    }
    case "log": {
      const result = logFit(xs, ys);
      if (!result) return null;
      const safeMin = Math.max(xMin, 1e-10);
      const regX = makeXs(safeMin, xMax);
      return { regX, regY: regX.map((x) => result.a * Math.log(x) + result.b), equation: "", rSquared: result.rSquared };
    }
    case "power": {
      const result = powerFit(xs, ys);
      if (!result) return null;
      const safeMin = Math.max(xMin, 1e-10);
      const regX = makeXs(safeMin, xMax);
      return { regX, regY: regX.map((x) => result.a * Math.pow(x, result.b)), equation: "", rSquared: result.rSquared };
    }
    case "4pl": {
      const result = fourPLFit(xs, ys);
      if (!result) return null;
      const regX = makeXs(xMin, xMax);
      return {
        regX,
        regY: regX.map((x) => {
          const ratio = Math.max(x / result.c, 1e-30);
          return result.d + (result.a - result.d) / (1 + Math.pow(ratio, result.b));
        }),
        equation: "",
        rSquared: result.rSquared,
      };
    }
  }
}

// ── 回帰モデル表示名 ────────────────────────────────────────────────

export const REGRESSION_LABELS: Record<string, string> = {
  "poly1": "1次", "poly2": "2次", "poly3": "3次",
  "exp": "指数", "log": "対数", "power": "べき乗", "4pl": "4PL",
};

export function regressionKey(model: RegressionModel): string {
  return model.type === "poly" ? `poly${model.degree}` : model.type;
}

export function parseRegressionKey(key: string): RegressionModel {
  if (key === "poly1") return { type: "poly", degree: 1 };
  if (key === "poly2") return { type: "poly", degree: 2 };
  if (key === "poly3") return { type: "poly", degree: 3 };
  if (key === "exp") return { type: "exp" };
  if (key === "log") return { type: "log" };
  if (key === "power") return { type: "power" };
  if (key === "4pl") return { type: "4pl" };
  return { type: "poly", degree: 1 };
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
  const {
    xColumn, yColumns, title, headerRow, dataStartRow, dataEndRow,
    showDataRange, showLegend, chartType, markerVisible, barMode, histogramBins,
    errorColumns, regressions,
    xAxisScale, yAxisScale, xAxisLabel, yAxisLabel,
    xAxisMin, xAxisMax, yAxisMin, yAxisMax,
    yAxisSide, y2AxisLabel, y2AxisScale, y2AxisMin, y2AxisMax,
  } = config;

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
    const xLabel = xAxisLabel || colLabel(xIdx);

    const xRaw = dataRows.map((r) => parseFloat(r[xIdx] ?? ""));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traces: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const annotations: any[] = [];
    let annotY = 0.98;

    const hasY2 = Object.values(yAxisSide).some((s) => s === "y2");

    // ── ヒストグラム: X 軸で選んだ列の分布を表示 ──
    if (chartType === "histogram") {
      const color = seriesColor(0);
      const vals = dataRows.map((r) => parseFloat(r[xIdx] ?? "")).filter((v) => !isNaN(v));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trace: any = {
        x: vals, type: "histogram",
        marker: { color, opacity: 0.75 },
        name: xLabel,
      };
      if (histogramBins !== "auto" && typeof histogramBins === "number" && histogramBins > 0) {
        trace.nbinsx = histogramBins;
      }
      traces.push(trace);
    }
    // ── 箱ひげ図: X がカテゴリ列ならグループ化、数値の一意値ばかりなら単一箱 ──
    else if (chartType === "box") {
      const xCategoriesAll = dataRows.map((r) => r[xIdx] ?? "");
      const nonEmptyX = xCategoriesAll.filter((v) => v !== "");
      // 判定: 非数値が混ざっている or 重複が多い（≒実際のカテゴリ）なら category 扱い
      const hasNonNumeric = nonEmptyX.some((v) => isNaN(parseFloat(v)));
      const uniqueCount = new Set(nonEmptyX).size;
      const useAsCategory = nonEmptyX.length > 0 && (
        hasNonNumeric || uniqueCount <= Math.max(1, Math.floor(nonEmptyX.length / 2))
      );
      yColumns.forEach((yCol, si) => {
        const yIdx = Math.max(0, parseInt(yCol) || 0);
        const yLbl = colLabel(yIdx);
        const color = seriesColor(si);
        const xs: string[] = [];
        const ys: number[] = [];
        for (let i = 0; i < dataRows.length; i++) {
          const yv = parseFloat(dataRows[i][yIdx] ?? "");
          if (isNaN(yv)) continue;
          ys.push(yv);
          xs.push(xCategoriesAll[i]);
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trace: any = {
          y: ys, type: "box",
          marker: { color }, name: yLbl,
          boxpoints: "outliers",
        };
        if (useAsCategory) trace.x = xs;
        traces.push(trace);
      });
    }
    // ── 棒グラフ: X はカテゴリ（文字列）も数値も受け付け ──
    else if (chartType === "bar") {
      yColumns.forEach((yCol, si) => {
        const yIdx = Math.max(0, parseInt(yCol) || 0);
        const yLbl = colLabel(yIdx);
        const color = seriesColor(si);
        const side = yAxisSide[yCol] ?? "y1";
        const errColIdx = errorColumns[yCol] ? parseInt(errorColumns[yCol]) : -1;

        const xs: (string | number)[] = [];
        const ys: number[] = [];
        const errs: number[] = [];
        for (let i = 0; i < dataRows.length; i++) {
          const yv = parseFloat(dataRows[i][yIdx] ?? "");
          if (isNaN(yv)) continue;
          const xRawStr = dataRows[i][xIdx] ?? "";
          const xNum = parseFloat(xRawStr);
          xs.push(!isNaN(xNum) && String(xNum) === xRawStr.trim() ? xNum : xRawStr);
          ys.push(yv);
          if (errColIdx >= 0) {
            const ev = parseFloat(dataRows[i][errColIdx] ?? "");
            errs.push(isNaN(ev) ? 0 : ev);
          }
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trace: any = {
          x: xs, y: ys, type: "bar", marker: { color }, name: yLbl,
          yaxis: side === "y2" ? "y2" : "y",
        };
        if (errColIdx >= 0) {
          trace.error_y = { type: "data", array: errs, visible: true };
        }
        traces.push(trace);
      });
    }
    // ── 散布図 / 折れ線 ──
    else {
      yColumns.forEach((yCol, si) => {
        const yIdx = Math.max(0, parseInt(yCol) || 0);
        const yLbl = colLabel(yIdx);
        const color = seriesColor(si);
        const side = yAxisSide[yCol] ?? "y1";

        const pairs: { x: number; y: number; err?: number }[] = [];
        const errColIdx = errorColumns[yCol] ? parseInt(errorColumns[yCol]) : -1;
        for (let i = 0; i < dataRows.length; i++) {
          const xv = xRaw[i];
          const yv = parseFloat(dataRows[i][yIdx] ?? "");
          if (!isNaN(xv) && !isNaN(yv)) {
            const ev = errColIdx >= 0 ? parseFloat(dataRows[i][errColIdx] ?? "") : NaN;
            pairs.push({ x: xv, y: yv, err: isNaN(ev) ? undefined : ev });
          }
        }
        const xNum = pairs.map((p) => p.x);
        const yNum = pairs.map((p) => p.y);

        const mode = chartType === "line"
          ? (markerVisible ? "lines+markers" : "lines")
          : "markers";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const trace: any = {
          x: xNum, y: yNum, mode, type: "scatter",
          marker: { color, size: 7, opacity: 0.8 },
          line: { color },
          name: yLbl,
          yaxis: side === "y2" ? "y2" : "y",
        };
        if (pairs.some((p) => p.err !== undefined)) {
          trace.error_y = {
            type: "data", array: pairs.map((p) => p.err ?? 0), visible: true,
          };
        }
        traces.push(trace);

        // 回帰線
        const regModel = regressions[yCol];
        if (regModel && xNum.length >= 2) {
          const xMinVal = Math.min(...xNum);
          const xMaxVal = Math.max(...xNum);
          const result = generateRegressionCurve(regModel, xNum, yNum, xMinVal, xMaxVal);
          if (result) {
            traces.push({
              x: result.regX, y: result.regY, mode: "lines", type: "scatter",
              line: { color, width: 2, dash: "dash" },
              name: `${yLbl} 回帰`,
              showlegend: false,
              yaxis: side === "y2" ? "y2" : "y",
            });

            // 数式表示
            let eqText = "";
            if (regModel.type === "poly") {
              const degree = Math.min(regModel.degree, xNum.length - 1);
              const { coeffs, rSquared } = polyFit(xNum, yNum, degree);
              eqText = formatPolyEquation(yLbl, coeffs, rSquared);
            } else {
              let params: Record<string, number> = {};
              if (regModel.type === "exp") {
                const r = expFit(xNum, yNum);
                if (r) params = { a: r.a, b: r.b };
              } else if (regModel.type === "log") {
                const r = logFit(xNum, yNum);
                if (r) params = { a: r.a, b: r.b };
              } else if (regModel.type === "power") {
                const r = powerFit(xNum, yNum);
                if (r) params = { a: r.a, b: r.b };
              } else if (regModel.type === "4pl") {
                const r = fourPLFit(xNum, yNum);
                if (r) params = { a: r.a, b: r.b, c: r.c, d: r.d };
              }
              eqText = formatRegressionEquation(yLbl, regModel, params, result.rSquared);
            }

            if (eqText) {
              annotations.push({
                text: eqText,
                xref: "paper", yref: "paper", x: 0.02, y: annotY,
                showarrow: false, font: { size: 11, color },
                bgcolor: "rgba(255,255,255,0.85)", borderpad: 3,
                xanchor: "left", yanchor: "top",
              });
              annotY -= 0.07;
            }
          }
        }
      });
    }

    const autoYLabel = yAxisLabel || (yColumns.length === 1
      ? colLabel(Math.max(0, parseInt(yColumns[0]) || 0))
      : "");

    const parseRange = (min: string, max: string): [number, number] | undefined => {
      const mn = parseFloat(min);
      const mx = parseFloat(max);
      if (!isNaN(mn) && !isNaN(mx)) return [mn, mx];
      return undefined;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout: any = {
      title: { text: title || (autoYLabel ? `${autoYLabel} vs ${xLabel}` : ""), font: { size: 14 } },
      xaxis: {
        // 箱ひげ図・ヒストグラムは X 列名が軸として意味を持たないケースが多いので、ユーザー指定ラベルのみ
        title: { text: (chartType === "box" || chartType === "histogram") ? xAxisLabel : xLabel },
        automargin: true,
        showline: true, linecolor: "#d1d5db", mirror: true,
        // log のときだけ明示、それ以外は Plotly に auto 判定させる（bar/box でカテゴリ文字列に対応するため）
        ...(xAxisScale === "log" ? { type: "log" } : {}),
        ...(parseRange(xAxisMin, xAxisMax) ? { range: parseRange(xAxisMin, xAxisMax) } : {}),
      },
      yaxis: {
        title: { text: autoYLabel }, automargin: true,
        showline: true, linecolor: "#d1d5db", mirror: true,
        type: yAxisScale === "log" ? "log" : "linear",
        ...(parseRange(yAxisMin, yAxisMax) ? { range: parseRange(yAxisMin, yAxisMax) } : {}),
      },
      margin: { l: 55, r: (showLegend ? 120 : 20) + (hasY2 ? 50 : 0), t: 45, b: 55 },
      autosize: true,
      showlegend: showLegend,
      legend: { x: 1.02, y: 1, xanchor: "left" as const, yanchor: "top" as const },
      plot_bgcolor: "#ffffff",
      paper_bgcolor: "#ffffff",
      annotations,
    };

    if (chartType === "bar") {
      layout.barmode = barMode;
    }

    if (hasY2) {
      layout.yaxis2 = {
        title: { text: y2AxisLabel },
        overlaying: "y", side: "right", automargin: true,
        showline: true, linecolor: "#d1d5db",
        type: y2AxisScale === "log" ? "log" : "linear",
        ...(parseRange(y2AxisMin, y2AxisMax) ? { range: parseRange(y2AxisMin, y2AxisMax) } : {}),
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import("plotly.js-dist-min") as Promise<any>).then((Plotly) => {
      if (!plotRef.current) return;
      const P = Plotly.default ?? Plotly;
      P.react(plotRef.current, traces, layout, { responsive: true, displayModeBar: "hover" });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset, xColumn, JSON.stringify(yColumns), title, headerRow, dataStartRow, dataEndRow, height,
      chartType, markerVisible, barMode, histogramBins,
      JSON.stringify(regressions), JSON.stringify(errorColumns),
      showLegend, xAxisScale, yAxisScale, xAxisLabel, yAxisLabel,
      xAxisMin, xAxisMax, yAxisMin, yAxisMax,
      JSON.stringify(yAxisSide), y2AxisLabel, y2AxisScale, y2AxisMin, y2AxisMax]);

  // ── 親要素のリサイズに追従（Plotly の responsive は window resize にしか反応しないため、
  //    パネル幅変更には別途 ResizeObserver で Plots.resize を呼ぶ） ──
  //    dataset が読み込まれてから plotRef が DOM に attach されるので dep は [dataset]
  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      // 無駄な発火を抑えるため、サイズが実際に変わったときだけ resize 発火
      if (Math.abs(cr.width - lastW) < 1 && Math.abs(cr.height - lastH) < 1) return;
      lastW = cr.width;
      lastH = cr.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        import("plotly.js-dist-min").then((Plotly: any) => {
          const P = Plotly.default ?? Plotly;
          if (plotRef.current) {
            try { P.Plots.resize(plotRef.current); } catch { /* ignore */ }
          }
        });
      });
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [dataset]);

  // ── エクスポート ──

  const handleExport = (format: "png" | "svg") => {
    if (!plotRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import("plotly.js-dist-min") as Promise<any>).then((Plotly) => {
      const P = Plotly.default ?? Plotly;
      P.downloadImage(plotRef.current!, {
        format,
        filename: title || "chart",
        width: plotRef.current!.offsetWidth * (format === "png" ? 2 : 1),
        height: height * (format === "png" ? 2 : 1),
        scale: format === "png" ? 2 : 1,
      });
    });
  };

  if (!datasetId) {
    return (
      <div className="rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
        テーブルブロックの「グラフ」からデータを渡してください
      </div>
    );
  }

  const colOptions = dataset
    ? dataset.headers.map((_, i) => {
        const { colLabel: cl } = resolveRows(dataset, headerRow, dataStartRow, dataEndRow);
        return { value: String(i), label: cl(i) };
      })
    : [];
  const totalRows = dataset?.rows.length ?? 0;
  const inputCls = "shrink-0 text-[11px] border border-gray-200 rounded px-1.5 outline-none bg-white h-[22px]";

  return (
    <div>
      {/* ── ツールバー（常時表示、超過分は横スクロール） ── */}
      {showToolbar && dataset && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border-b border-gray-200 overflow-x-auto">
          {/* グラフタイトル（左端） */}
          <input
            value={title}
            onChange={(e) => onConfigChange({ title: e.target.value })}
            placeholder="グラフタイトル"
            className="shrink-0 text-[11px] px-1.5 h-[22px] border border-gray-200 rounded outline-none bg-white w-32"
            onKeyDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />

          {/* グラフ種別 */}
          <select
            value={chartType}
            onChange={(e) => onConfigChange({ chartType: e.target.value as ChartType })}
            className={inputCls}
          >
            <option value="scatter">散布図</option>
            <option value="line">折れ線</option>
            <option value="bar">棒グラフ</option>
            <option value="histogram">ヒストグラム</option>
            <option value="box">箱ひげ図</option>
          </select>

          <span className="shrink-0 text-[11px] text-gray-400">X</span>
          <select value={xColumn} onChange={(e) => onConfigChange({ xColumn: e.target.value })} className={inputCls}>
            {colOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>

          {/* Y列（複数） */}
          <span className="shrink-0 text-[11px] text-gray-400">Y</span>
          {yColumns.map((yCol, si) => {
            const regModel = regressions[yCol];
            const regKey = regModel ? regressionKey(regModel) : "";
            return (
              <span key={yCol} className="shrink-0 inline-flex items-center gap-0.5 text-[11px] bg-white border border-gray-200 rounded pl-1.5 pr-0.5 h-[22px]">
                <span style={{ color: seriesColor(si) }} className="font-medium">
                  {colOptions.find((o) => o.value === yCol)?.label ?? yCol}
                </span>
                {/* 回帰モデル選択 */}
                <select
                  value={regKey}
                  onChange={(e) => {
                    const val = e.target.value;
                    const next = { ...regressions };
                    if (!val) { delete next[yCol]; } else { next[yCol] = parseRegressionKey(val); }
                    onConfigChange({ regressions: next });
                  }}
                  className="text-[10px] border-0 bg-transparent outline-none cursor-pointer px-0 font-semibold h-full"
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
                      const next = yColumns.filter((c) => c !== yCol);
                      const nextRegs = { ...regressions };
                      delete nextRegs[yCol];
                      const nextErr = { ...errorColumns };
                      delete nextErr[yCol];
                      onConfigChange({ yColumns: next, regressions: nextRegs, errorColumns: nextErr });
                    }}
                    className="text-gray-400 hover:text-gray-600 px-0.5"
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

          {/* 凡例トグル */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onConfigChange({ showLegend: !showLegend })}
            className={`shrink-0 text-[11px] px-2 h-[22px] rounded border font-medium transition-colors ${
              showLegend
                ? "border-blue-300 bg-blue-50 text-blue-600"
                : "border-gray-300 bg-white text-gray-400 hover:bg-gray-50"
            }`}
          >
            凡例
          </button>

          {/* エクスポート */}
          <div className="shrink-0 relative group">
            <button
              className="flex items-center justify-center text-[11px] px-1.5 h-[22px] rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
              title="画像エクスポート"
            >
              <Download size={12} />
            </button>
            <div className="hidden group-hover:flex absolute top-full left-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg z-20 flex-col">
              <button onClick={() => handleExport("png")} className="text-xs px-3 py-1.5 hover:bg-gray-100 text-left whitespace-nowrap">PNG</button>
              <button onClick={() => handleExport("svg")} className="text-xs px-3 py-1.5 hover:bg-gray-100 text-left whitespace-nowrap">SVG</button>
            </div>
          </div>

          <div className="w-px h-4 bg-gray-200 shrink-0" />

          {/* 詳細設定トグル */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onConfigChange({ showDataRange: !showDataRange })}
            className="shrink-0 flex items-center gap-0.5 text-[11px] px-2 h-[22px] rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
          >
            <ChevronDown
              size={11}
              className={`transition-transform duration-150 ${showDataRange ? "" : "-rotate-90"}`}
            />
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

          <div className="w-px h-4 bg-gray-200 shrink-0" />

          {/* 軸スケール */}
          <span className="text-xs text-gray-400">X軸</span>
          <select value={xAxisScale} onChange={(e) => onConfigChange({ xAxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
            <option value="linear">線形</option>
            <option value="log">対数</option>
          </select>
          <span className="text-xs text-gray-400">Y軸</span>
          <select value={yAxisScale} onChange={(e) => onConfigChange({ yAxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
            <option value="linear">線形</option>
            <option value="log">対数</option>
          </select>

          <div className="w-px h-4 bg-gray-200 shrink-0" />

          {/* 軸ラベル */}
          <span className="text-xs text-gray-400">X名</span>
          <input value={xAxisLabel} onChange={(e) => onConfigChange({ xAxisLabel: e.target.value })}
            placeholder="自動" className={`${inputCls} w-16`}
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
          <span className="text-xs text-gray-400">Y名</span>
          <input value={yAxisLabel} onChange={(e) => onConfigChange({ yAxisLabel: e.target.value })}
            placeholder="自動" className={`${inputCls} w-16`}
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

          <div className="w-px h-4 bg-gray-200 shrink-0" />

          {/* 軸範囲 */}
          <span className="text-xs text-gray-400">X範囲</span>
          <input value={xAxisMin} onChange={(e) => onConfigChange({ xAxisMin: e.target.value })}
            placeholder="auto" className={`${inputCls} w-14`} type="number"
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
          <span className="text-xs text-gray-400">〜</span>
          <input value={xAxisMax} onChange={(e) => onConfigChange({ xAxisMax: e.target.value })}
            placeholder="auto" className={`${inputCls} w-14`} type="number"
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

          <span className="text-xs text-gray-400">Y範囲</span>
          <input value={yAxisMin} onChange={(e) => onConfigChange({ yAxisMin: e.target.value })}
            placeholder="auto" className={`${inputCls} w-14`} type="number"
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
          <span className="text-xs text-gray-400">〜</span>
          <input value={yAxisMax} onChange={(e) => onConfigChange({ yAxisMax: e.target.value })}
            placeholder="auto" className={`${inputCls} w-14`} type="number"
            onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />

          {/* 折れ線マーカー / 棒グラフモード / ヒストグラムビン */}
          {chartType === "line" && (
            <>
              <div className="w-px h-4 bg-gray-200 shrink-0" />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onConfigChange({ markerVisible: !markerVisible })}
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
              <select value={barMode} onChange={(e) => onConfigChange({ barMode: e.target.value as "group" | "stack" })} className={inputCls}>
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
                onChange={(e) => onConfigChange({ histogramBins: e.target.value ? parseInt(e.target.value) || "auto" : "auto" })}
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
                      onConfigChange({ errorColumns: next });
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
                      onConfigChange({ yAxisSide: next });
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
                  <input value={y2AxisLabel} onChange={(e) => onConfigChange({ y2AxisLabel: e.target.value })}
                    placeholder="自動" className={`${inputCls} w-16`}
                    onKeyDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />
                  <select value={y2AxisScale} onChange={(e) => onConfigChange({ y2AxisScale: e.target.value as "linear" | "log" })} className={inputCls}>
                    <option value="linear">線形</option>
                    <option value="log">対数</option>
                  </select>
                </>
              )}
            </>
          )}
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
