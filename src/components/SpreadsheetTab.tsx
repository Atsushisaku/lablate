"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { loadDataset, saveDataset, Dataset, registerDataset, getDatasetMeta, renameDataset, loadTree, findDatasetOwnerPage, loadDoc, ROOT_ID } from "@/lib/storage";
import { Import, Plus, FileDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, PanelRight, PanelBottom } from "lucide-react";
import { ChartRenderer, ChartConfig, defaultChartConfig } from "./blocks/ChartRenderer";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";

type ChartPanelPosition = "right" | "bottom";

// ── ユーティリティ ──────────────────────────────────────────────────

const colLetter = (i: number): string => {
  let result = "", n = i + 1;
  while (n > 0) { const rem = (n - 1) % 26; result = String.fromCharCode(65 + rem) + result; n = Math.floor((n - 1) / 26); }
  return result;
};

function parseCsvAllRows(text: string): Dataset {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const res: string[] = []; let buf = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i+1] === '"') { buf += '"'; i++; } else inQ = !inQ; }
      else if (c === "," && !inQ) { res.push(buf); buf = ""; }
      else buf += c;
    }
    res.push(buf); return res;
  };
  const rows = lines.map(parseRow);
  const colCount = Math.max(...rows.map((r) => r.length));
  return { headers: Array.from({ length: colCount }, (_, i) => colLetter(i)), rows };
}

// ── 削除ボタン用 SVG ─────────────────────────────────────────────────

const TRASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

// ── スプレッドシート注入スタイル ──────────────────────────────────────

const SHEET_STYLES = `
  /* ── 外枠のデフォルト余白を除去（サイドバー/ツールバーと密着） ── */
  .jss_container {
    padding-right: 0 !important;
    display: block !important;
    width: 100% !important;
  }
  .jss_content {
    padding-right: 0 !important;
    padding-bottom: 0 !important;
    display: block !important;
    width: 100% !important;
  }

  /* ── Google Sheets 風の配色 / タイポ ── */
  .jss_worksheet {
    font-family: Arial, "Helvetica Neue", Helvetica, -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif !important;
    font-size: 12.5px !important;
  }
  .jss_worksheet { border-right-color: #e0e0e0 !important; border-bottom-color: #e0e0e0 !important; }
  .jss_worksheet > thead > tr > td {
    border-top-color: #e0e0e0 !important;
    border-left-color: #e0e0e0 !important;
    background: #f8f9fa !important;
    color: #5f6368 !important;
    font-size: 11px !important;
    font-weight: 500 !important;
    padding: 3px 4px !important;
  }
  .jss_worksheet > thead > tr > td.selected { background: #e8eaed !important; }
  .jss_worksheet > tbody > tr > td {
    border-top-color: #e0e0e0 !important;
    border-left-color: #e0e0e0 !important;
    color: #202124 !important;
    padding: 3px 6px !important;
    line-height: 1.5 !important;
  }
  .jss_worksheet > tbody > tr > td:first-child {
    background: #f8f9fa !important;
    color: #5f6368 !important;
    font-size: 11px !important;
  }

  /* ── 既存: 行/列ヘッダの固定幅 & 削除ボタン位置 ── */
  .jss_worksheet > colgroup > col:first-child { width: 32px !important; }
  .jss_worksheet > thead > tr > td:first-child,
  .jss_worksheet > tbody > tr > td:first-child {
    width: 32px !important; min-width: 32px !important; max-width: 32px !important;
    position: relative !important;
  }
  .jss_worksheet > thead > tr > td { position: relative !important; }
  .lablate-del {
    display: none; position: absolute;
    align-items: center; justify-content: center;
    padding: 0; background: rgba(255,255,255,0.92);
    border: none; border-radius: 3px; cursor: pointer;
    color: #9ca3af; z-index: 20; width: 16px; height: 16px;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.10); line-height: 1;
  }
  .lablate-del:hover { color: #dc2626; background: #fee2e2; }
  .jss_worksheet > tbody > tr > td:first-child:hover .lablate-del {
    display: flex; top: 50%; right: 1px; transform: translateY(-50%);
  }
  .jss_worksheet > thead > tr > td:not(:first-child):hover .lablate-del {
    display: flex; top: 2px; right: 2px;
  }

  /* ── 選択/ハイライトの配色 (Google Sheets 風のブルー) ── */
  html body table.jss_worksheet td.highlight-left   { border-left:   2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-right  { border-right:  2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-top    { border-top:    2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-bottom { border-bottom: 2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight        { background: transparent !important; }
  html body table.jss_worksheet td.highlight-selected { background: transparent !important; }
  html body table.jss_worksheet td.highlight-top.highlight-left { box-shadow: none !important; }
  html body table.jss_worksheet td.selection-left   { border-left:   2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-right  { border-right:  2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-top    { border-top:    2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-bottom { border-bottom: 2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection        { background: rgba(26,115,232,0.07) !important; }
  html body table.jss_worksheet td.lablate-fref {
    outline: 2px dashed #9c27b0 !important;
    outline-offset: -2px;
    background: rgba(156, 39, 176, 0.06) !important;
  }
`;

// ── グラフ設定の永続化 ──────────────────────────────────────────────

interface SpreadsheetChartEntry {
  id: string;
  config: ChartConfig;
  height?: number;
  width?: number;
  /** ページ内 ChartBlock 由来の場合のソース情報（タブ独自のチャートでは undefined） */
  source?: { kind: "page"; pageId: string; blockId: string };
}

const DEFAULT_CHART_HEIGHT = 260;
const MIN_CHART_HEIGHT = 160;
const MAX_CHART_HEIGHT = 900;
const MIN_CHART_WIDTH = 200;

/** ツリー内の全ページを走査し、この datasetId を参照する chart ブロックを集める */
function loadPageChartsForDataset(datasetId: string): SpreadsheetChartEntry[] {
  const result: SpreadsheetChartEntry[] = [];
  const tree = loadTree();
  const walk = (nodeId: string) => {
    const node = tree[nodeId];
    if (!node) return;
    if (nodeId !== ROOT_ID) {
      const doc = loadDoc(nodeId);
      if (doc) {
        for (const block of doc) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = block as any;
          if (b?.type === "chart" && b?.props?.datasetId === datasetId) {
            const cfgRaw = localStorage.getItem(`lablate_chart_config_${b.id}`);
            let config: ChartConfig;
            try {
              config = cfgRaw ? { ...defaultChartConfig, ...JSON.parse(cfgRaw) } : { ...defaultChartConfig };
            } catch {
              config = { ...defaultChartConfig };
            }
            result.push({
              id: `page-${b.id}`,
              config,
              source: { kind: "page", pageId: nodeId, blockId: b.id },
            });
          }
        }
      }
    }
    node.children.forEach(walk);
  };
  walk(ROOT_ID);
  return result;
}

function loadSheetCharts(datasetId: string): SpreadsheetChartEntry[] {
  try {
    const raw = localStorage.getItem(`lablate_spreadsheet_charts_${datasetId}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveSheetCharts(datasetId: string, charts: SpreadsheetChartEntry[]): void {
  localStorage.setItem(`lablate_spreadsheet_charts_${datasetId}`, JSON.stringify(charts));
}

// ── SpreadsheetTab ──────────────────────────────────────────────────

interface Props {
  datasetId: string;
  onInsertChartToDocument: (datasetId: string, chartConfig?: ChartConfig) => void;
}

export default function SpreadsheetTab({ datasetId, onInsertChartToDocument }: Props) {
  const [charts, setCharts] = useState<SpreadsheetChartEntry[]>(() => loadSheetCharts(datasetId));
  // ページ内 ChartBlock 由来のチャート（読み込み専用データソースはページ側）
  const [pageCharts, setPageCharts] = useState<SpreadsheetChartEntry[]>(() => loadPageChartsForDataset(datasetId));
  // ページ更新やデータ変更でページチャートを再取得
  useEffect(() => {
    const refresh = () => setPageCharts(loadPageChartsForDataset(datasetId));
    window.addEventListener("lablate-tree-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("lablate-tree-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [datasetId]);
  const [splitPercent, setSplitPercent] = useState(() => {
    try {
      const v = localStorage.getItem(`lablate_spreadsheet_split_${datasetId}`);
      return v ? parseInt(v) : 60;
    } catch { return 60; }
  });
  const [chartsCollapsed, setChartsCollapsed] = useState(() => {
    try { return localStorage.getItem(`lablate_spreadsheet_charts_collapsed_${datasetId}`) === "1"; }
    catch { return false; }
  });
  const [chartPosition, setChartPosition] = useState<ChartPanelPosition>(() => {
    try {
      const v = localStorage.getItem(`lablate_spreadsheet_chart_position_${datasetId}`);
      return v === "bottom" ? "bottom" : "right";
    } catch { return "right"; }
  });
  const [datasetName, setDatasetName] = useState<string>(() => {
    registerDataset(datasetId);
    return getDatasetMeta(datasetId)?.name ?? "";
  });
  // 所属ページ（meta.pageId が無ければドキュメントから逆引き）
  const [parentPageId, setParentPageId] = useState<string>(() => findDatasetOwnerPage(datasetId) ?? "");
  const [parentPageName, setParentPageName] = useState<string>(() => {
    const pid = findDatasetOwnerPage(datasetId);
    return pid ? (loadTree()[pid]?.title ?? "") : "";
  });
  useEffect(() => {
    const refresh = () => {
      const pid = findDatasetOwnerPage(datasetId) ?? "";
      setParentPageId(pid);
      setParentPageName(pid ? (loadTree()[pid]?.title ?? "") : "");
    };
    // ツリー変更・ドキュメント変更どちらでも再評価
    window.addEventListener("lablate-tree-change", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("lablate-tree-change", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [datasetId]);

  const contentRef = useRef<HTMLDivElement>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isActiveRef = useRef(false);
  const mySourceId = useRef(`sheet-${datasetId}`);
  const formulaRefRef = useRef<{ x: number; y: number; start: number; end: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persistRef = useRef<() => void>(null as any);
  const splitDragRef = useRef<{ startX: number; startY: number; startPercent: number } | null>(null);
  const [splitterHover, setSplitterHover] = useState(false);

  const [initData] = useState<Dataset>(() => {
    registerDataset(datasetId);
    return loadDataset(datasetId) ?? { headers: ["A","B","C"], rows: [["","",""],["","",""],["","",""]] };
  });

  // ── データ永続化 ──
  const persistData = useCallback(() => {
    const ws = instanceRef.current;
    if (!ws) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const rows = ws.getData() as string[][];
      const colCount = rows.length > 0 ? rows[0].length : 0;
      saveDataset(datasetId, {
        headers: Array.from({ length: colCount }, (_, i) => colLetter(i)),
        rows,
      });
      window.dispatchEvent(new CustomEvent("lablate-dataset-change", {
        detail: { datasetId, sourceId: mySourceId.current },
      }));
    }, 300);
  }, [datasetId]);
  persistRef.current = persistData;

  // ── 外部変更のリッスン ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.datasetId !== datasetId) return;
      if (detail?.sourceId === mySourceId.current) return;
      const ws = instanceRef.current;
      if (!ws) return;
      const ds = loadDataset(datasetId);
      if (ds) {
        const data = ds.rows.length > 0 ? ds.rows : [new Array(ds.headers.length).fill("")];
        ws.setData(data);
      }
    };
    window.addEventListener("lablate-dataset-change", handler);
    return () => window.removeEventListener("lablate-dataset-change", handler);
  }, [datasetId]);

  // ── データセット名の外部変更をリッスン ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.datasetId !== datasetId) return;
      if (typeof detail?.name === "string") setDatasetName(detail.name);
    };
    window.addEventListener("lablate-dataset-rename", handler);
    return () => window.removeEventListener("lablate-dataset-rename", handler);
  }, [datasetId]);

  const commitDatasetName = useCallback((name: string) => {
    const trimmed = name.trim();
    const fallback = getDatasetMeta(datasetId)?.name ?? "";
    const final = trimmed || fallback || "スプレッドシート";
    setDatasetName(final);
    renameDataset(datasetId, final);
    window.dispatchEvent(new CustomEvent("lablate-dataset-rename", {
      detail: { datasetId, name: final },
    }));
  }, [datasetId]);

  // ── アクティブ状態の追跡 ──
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const onIn = () => { isActiveRef.current = true; };
    const onOut = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) isActiveRef.current = false;
    };
    wrapper.addEventListener("mousedown", onIn);
    document.addEventListener("mousedown", onOut);
    return () => { wrapper.removeEventListener("mousedown", onIn); document.removeEventListener("mousedown", onOut); };
  }, []);

  // ── キーボード操作（Google Sheets ライク） ──
  useEffect(() => {
    const clearFRefHL = () => {
      containerRef.current
        ?.querySelectorAll(".lablate-fref")
        .forEach((el) => el.classList.remove("lablate-fref"));
    };
    const setFRefHL = (x: number, y: number) => {
      clearFRefHL();
      const table = containerRef.current?.querySelector("table.jss_worksheet") as HTMLTableElement | null;
      const td = table?.tBodies?.[0]?.rows[y]?.cells[x + 1];
      if (td) td.classList.add("lablate-fref");
    };

    const intercept = (e: KeyboardEvent) => {
      const ws = instanceRef.current;
      if (!isActiveRef.current || !ws) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ws.edition) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const edArr = ws.edition as any[];
        const td = edArr?.[0] as HTMLElement | undefined;
        const input = td?.querySelector("input, textarea") as HTMLInputElement | null;
        if (!input) return;

        const text = input.value;
        const isFormula = text.startsWith("=");

        if (isFormula && /^Arrow/.test(e.key)) {
          e.stopImmediatePropagation(); e.preventDefault();
          const data = ws.getData() as string[][];
          const maxRow = Math.max(0, data.length - 1);
          const maxCol = Math.max(0, (data[0]?.length ?? 1) - 1);
          const [cx, cy] = ws.selectedCell as [number, number, number, number];
          const prev = formulaRefRef.current;
          let rx = prev ? prev.x : cx;
          let ry = prev ? prev.y : cy;
          switch (e.key) {
            case "ArrowRight": rx = Math.min(rx + 1, maxCol); break;
            case "ArrowLeft":  rx = Math.max(rx - 1, 0); break;
            case "ArrowDown":  ry = Math.min(ry + 1, maxRow); break;
            case "ArrowUp":    ry = Math.max(ry - 1, 0); break;
          }
          const cellRef = colLetter(rx) + (ry + 1);
          if (prev) {
            const before = text.substring(0, prev.start);
            const after  = text.substring(prev.end);
            input.value  = before + cellRef + after;
            const newEnd = prev.start + cellRef.length;
            input.setSelectionRange(newEnd, newEnd);
            formulaRefRef.current = { x: rx, y: ry, start: prev.start, end: newEnd };
          } else {
            const pos    = input.selectionStart ?? text.length;
            const before = text.substring(0, pos);
            const after  = text.substring(pos);
            input.value  = before + cellRef + after;
            const newEnd = pos + cellRef.length;
            input.setSelectionRange(newEnd, newEnd);
            formulaRefRef.current = { x: rx, y: ry, start: pos, end: newEnd };
          }
          input.dispatchEvent(new Event("input", { bubbles: true }));
          setFRefHL(rx, ry);
          return;
        }

        if (formulaRefRef.current) { formulaRefRef.current = null; clearFRefHL(); }

        if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL(); input.blur();
          requestAnimationFrame(() => ws.down?.());
          return;
        }
        if (e.key === "Escape") {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL();
          try { ws.closeEditor(td, false); } catch { input.blur(); }
          return;
        }
        if (e.key === "Tab") {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL(); input.blur();
          requestAnimationFrame(() => (e.shiftKey ? ws.left() : ws.right()));
          return;
        }
        return;
      }

      if (!ws.selectedCell) return;
      const sel = ws.selectedCell as [number, number, number, number];

      switch (e.key) {
        case "ArrowRight": e.stopImmediatePropagation(); e.preventDefault(); ws.right(e.shiftKey, ctrl); break;
        case "ArrowLeft":  e.stopImmediatePropagation(); e.preventDefault(); ws.left(e.shiftKey,  ctrl); break;
        case "ArrowDown":  e.stopImmediatePropagation(); e.preventDefault(); ws.down(e.shiftKey,  ctrl); break;
        case "ArrowUp":    e.stopImmediatePropagation(); e.preventDefault(); ws.up(e.shiftKey,    ctrl); break;
        case "Enter":
        case "F2": {
          e.stopImmediatePropagation(); e.preventDefault();
          const table = containerRef.current?.querySelector("table.jss_worksheet") as HTMLTableElement | null;
          table?.tBodies?.[0]?.rows[sel[1]]?.cells[sel[0] + 1]
            ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
          break;
        }
        case "Tab":
          e.stopImmediatePropagation(); e.preventDefault();
          e.shiftKey ? ws.left() : ws.right();
          break;
        case "Delete":
        case "Backspace": {
          e.stopImmediatePropagation(); e.preventDefault();
          const [x1, y1, x2, y2] = sel;
          for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
            for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
              ws.setValueFromCoords(x, y, "");
          persistRef.current();
          break;
        }
        case "Escape":
          e.stopImmediatePropagation(); e.preventDefault();
          break;
        default: {
          if (ctrl) {
            const k = e.key.toLowerCase();
            if (k === "z") { e.stopImmediatePropagation(); e.preventDefault(); ws.undo(); break; }
            if (k === "y") { e.stopImmediatePropagation(); e.preventDefault(); ws.redo(); break; }
            if (k === "c") {
              e.stopImmediatePropagation(); e.preventDefault();
              try { const t = ws.copy(); if (t) navigator.clipboard?.writeText(t).catch(() => {}); } catch { /* */ }
              break;
            }
            if (k === "x") {
              e.stopImmediatePropagation(); e.preventDefault();
              try { const t = ws.copy(true); if (t) navigator.clipboard?.writeText(t).catch(() => {}); } catch { /* */ }
              persistRef.current();
              break;
            }
            if (k === "v") {
              e.stopImmediatePropagation(); e.preventDefault();
              navigator.clipboard?.readText().then((txt) => {
                if (!txt || !ws.selectedCell) return;
                const [sx, sy] = ws.selectedCell as [number, number, number, number];
                const rows = txt.split("\n").filter(Boolean).map((r) => r.split("\t"));
                rows.forEach((row, ri) => row.forEach((val, ci) => ws.setValueFromCoords(sx + ci, sy + ri, val)));
                persistRef.current();
              }).catch(() => {});
              break;
            }
            if (k === "a") { e.stopImmediatePropagation(); e.preventDefault(); ws.selectAll(); break; }
            break;
          }
          if (e.key.length === 1 && !e.altKey) {
            e.stopImmediatePropagation(); e.preventDefault();
            const table = containerRef.current?.querySelector("table.jss_worksheet") as HTMLTableElement | null;
            const td = table?.tBodies?.[0]?.rows[sel[1]]?.cells[sel[0] + 1];
            if (td) {
              ws.openEditor(td, true, e);
              requestAnimationFrame(() => {
                if (!ws.edition) return;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const inp = (ws.edition as any[])?.[0]
                  ?.querySelector("input, textarea") as HTMLInputElement | null;
                if (inp) {
                  inp.value = e.key;
                  inp.setSelectionRange(1, 1);
                  inp.dispatchEvent(new Event("input", { bubbles: true }));
                }
              });
            }
          }
          break;
        }
      }
    };
    document.addEventListener("keydown", intercept, true);
    return () => document.removeEventListener("keydown", intercept, true);
  }, []);

  // ── jspreadsheet 初期化 & 削除ボタン注入 ──
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let destroyed = false;

    const refreshDeleteButtons = () => {
      if (destroyed) return;
      container.querySelectorAll(".lablate-del").forEach((el) => el.remove());
      const table = container.querySelector("table.jss_worksheet");
      if (!table) return;
      table.querySelectorAll("tbody > tr > td:first-child").forEach((td, i) => {
        const btn = document.createElement("button");
        btn.className = "lablate-del"; btn.title = `行 ${i+1} を削除`; btn.innerHTML = TRASH_SVG;
        btn.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); });
        btn.addEventListener("click", (e) => { e.stopPropagation(); instanceRef.current?.deleteRow(i, 1); });
        td.appendChild(btn);
      });
      table.querySelectorAll("thead > tr > td").forEach((td, i) => {
        if (i === 0) return;
        const btn = document.createElement("button");
        btn.className = "lablate-del"; btn.title = `列 ${colLetter(i-1)} を削除`; btn.innerHTML = TRASH_SVG;
        btn.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); });
        btn.addEventListener("click", (e) => { e.stopPropagation(); instanceRef.current?.deleteColumn(i-1, 1); });
        td.appendChild(btn);
      });
    };

    const withRefresh = (fn: () => void) => () => { fn(); setTimeout(refreshDeleteButtons, 0); };

    const tid = setTimeout(() => {
      if (destroyed) return;
      const rows = initData.rows.length > 0 ? initData.rows : [new Array(initData.headers.length).fill("")];
      const worksheets = jspreadsheet(container, {
        worksheets: [{
          data: rows,
          columns: initData.headers.map((h) => ({ title: h, width: 120 })),
          minDimensions: [3, 5],
          allowInsertRow: true, allowDeleteRow: true,
          allowInsertColumn: true, allowDeleteColumn: true,
        }],
        tabs: false, toolbar: false,
        onchange:       persistData,
        oninsertrow:    withRefresh(persistData),
        ondeleterow:    withRefresh(persistData),
        oninsertcolumn: withRefresh(persistData),
        ondeletecolumn: withRefresh(persistData),
        onchangeheader: persistData,
      });
      instanceRef.current = worksheets[0];
      setTimeout(refreshDeleteButtons, 0);
    }, 0);

    return () => {
      destroyed = true; clearTimeout(tid); instanceRef.current = null;
      try { jspreadsheet.destroy(container as any, true); } catch { /* already destroyed */ } // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  }, [initData, persistData]);

  // ── CSV インポート ──
  const handleCsvImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsvAllRows(ev.target?.result as string);
      if (!parsed.rows.length) return;
      saveDataset(datasetId, parsed);
      const ws = instanceRef.current;
      if (ws) ws.setData(parsed.rows);
      window.dispatchEvent(new CustomEvent("lablate-dataset-change", {
        detail: { datasetId, sourceId: mySourceId.current },
      }));
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [datasetId]);

  // ── グラフ管理 ──
  const addChart = () => {
    const entry: SpreadsheetChartEntry = { id: crypto.randomUUID(), config: { ...defaultChartConfig } };
    const next = [...charts, entry];
    setCharts(next);
    saveSheetCharts(datasetId, next);
  };

  const updateChartConfig = (chartId: string, updates: Partial<ChartConfig>) => {
    // ページ由来のチャートなら block config を直接更新（ページ側もイベントで同期）
    const pageEntry = pageCharts.find((c) => c.id === chartId);
    if (pageEntry?.source) {
      const newConfig = { ...pageEntry.config, ...updates };
      localStorage.setItem(`lablate_chart_config_${pageEntry.source.blockId}`, JSON.stringify(newConfig));
      window.dispatchEvent(new CustomEvent("lablate-chart-config-change", {
        detail: { blockId: pageEntry.source.blockId, config: newConfig },
      }));
      setPageCharts((prev) => prev.map((c) => c.id === chartId ? { ...c, config: newConfig } : c));
      return;
    }
    // タブ独自チャート
    const next = charts.map((c) =>
      c.id === chartId ? { ...c, config: { ...c.config, ...updates } } : c
    );
    setCharts(next);
    saveSheetCharts(datasetId, next);
  };

  const removeChart = (chartId: string) => {
    // ページ由来のチャートは削除不可（ページ側で削除してもらう）
    if (pageCharts.some((c) => c.id === chartId)) return;
    const next = charts.filter((c) => c.id !== chartId);
    setCharts(next);
    saveSheetCharts(datasetId, next);
  };

  // ── 折りたたみ / 配置の永続化 ──
  const toggleCollapsed = useCallback(() => {
    setChartsCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(`lablate_spreadsheet_charts_collapsed_${datasetId}`, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, [datasetId]);

  const togglePosition = useCallback(() => {
    setChartPosition((prev) => {
      const next: ChartPanelPosition = prev === "right" ? "bottom" : "right";
      try { localStorage.setItem(`lablate_spreadsheet_chart_position_${datasetId}`, next); } catch { /* ignore */ }
      return next;
    });
  }, [datasetId]);

  // ── リサイズ分割バー ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = splitDragRef.current;
      if (!d) return;
      const content = contentRef.current;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const total = chartPosition === "right" ? rect.width : rect.height;
      if (total <= 0) return;
      const delta = chartPosition === "right" ? (e.clientX - d.startX) : (e.clientY - d.startY);
      const pct = Math.max(30, Math.min(80, d.startPercent + (delta / total) * 100));
      setSplitPercent(Math.round(pct));
    };
    const onUp = () => {
      if (!splitDragRef.current) return;
      splitDragRef.current = null;
      localStorage.setItem(`lablate_spreadsheet_split_${datasetId}`, String(splitPercent));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [datasetId, splitPercent, chartPosition]);

  const startSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { startX: e.clientX, startY: e.clientY, startPercent: splitPercent };
  };

  // ── 個別グラフの高さ / 幅リサイズ ──
  const [chartResize, setChartResize] = useState<{
    entryId: string;
    axis: "height" | "width";
    startX: number;
    startY: number;
    startSize: number;
    currentSize: number;
    maxSize: number;
  } | null>(null);

  useEffect(() => {
    if (!chartResize) return;
    const onMove = (e: MouseEvent) => {
      const delta = chartResize.axis === "height"
        ? (e.clientY - chartResize.startY)
        : (e.clientX - chartResize.startX);
      const minSize = chartResize.axis === "height" ? MIN_CHART_HEIGHT : MIN_CHART_WIDTH;
      const maxSize = chartResize.axis === "height" ? MAX_CHART_HEIGHT : chartResize.maxSize;
      const next = Math.max(minSize, Math.min(maxSize, chartResize.startSize + delta));
      setChartResize((prev) => prev ? { ...prev, currentSize: next } : null);
    };
    const onUp = () => {
      setChartResize((prev) => {
        if (!prev) return null;
        const finalSize = Math.round(prev.currentSize);
        const next = charts.map((c) => c.id === prev.entryId
          ? (prev.axis === "height" ? { ...c, height: finalSize } : { ...c, width: finalSize })
          : c);
        setCharts(next);
        saveSheetCharts(datasetId, next);
        return null;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [chartResize, charts, datasetId]);

  const startChartResize = (e: React.MouseEvent, entry: SpreadsheetChartEntry, axis: "height" | "width") => {
    e.preventDefault();
    e.stopPropagation();
    // 親要素幅を上限として取得
    const wrapper = (e.currentTarget as HTMLElement).closest(".lablate-chart-entry") as HTMLElement | null;
    const parentWidth = wrapper?.parentElement?.getBoundingClientRect().width ?? 800;
    const startSize = axis === "height"
      ? (entry.height ?? DEFAULT_CHART_HEIGHT)
      : (entry.width ?? parentWidth);
    setChartResize({
      entryId: entry.id,
      axis,
      startX: e.clientX,
      startY: e.clientY,
      startSize,
      currentSize: startSize,
      maxSize: parentWidth,
    });
  };

  const isRight = chartPosition === "right";
  const showChartContent = !chartsCollapsed;
  const showPanel = !isRight || showChartContent;
  const showSplitter = showPanel && showChartContent;

  const chartCollapseBtn = (
    <button
      onClick={toggleCollapsed}
      className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200"
      title={chartsCollapsed ? "展開" : "折りたたむ"}
    >
      <span className="shrink-0 text-gray-400">
        {isRight
          ? (chartsCollapsed ? <ChevronLeft size={13} /> : <ChevronRight size={13} />)
          : (chartsCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
      </span>
      <span className="font-medium">グラフ</span>
    </button>
  );
  const chartPositionBtn = (
    <button
      onClick={togglePosition}
      className="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200"
      title={isRight ? "下部に移動" : "右側に移動"}
    >
      {isRight ? <PanelBottom size={13} /> : <PanelRight size={13} />}
    </button>
  );
  const chartAddBtn = showChartContent && (
    <button
      onClick={addChart}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
    >
      <Plus size={12} /> 追加
    </button>
  );

  // 全チャート（ページ由来を先、タブ独自を後ろ）
  const allCharts = [...pageCharts, ...charts];

  const chartBody = (
    allCharts.length === 0 ? (
      <div className="p-8 text-center text-gray-400 text-xs">
        「グラフ追加」でデータを可視化
      </div>
    ) : (
      <div className="divide-y divide-gray-100">
        {allCharts.map((entry) => {
          const isPageEntry = !!entry.source;
          const isResizingH = chartResize?.entryId === entry.id && chartResize.axis === "height";
          const isResizingW = chartResize?.entryId === entry.id && chartResize.axis === "width";
          const h = isResizingH ? chartResize.currentSize : (entry.height ?? DEFAULT_CHART_HEIGHT);
          const customW = !isRight && (isResizingW ? chartResize.currentSize : entry.width);
          return (
            <div key={entry.id} className="lablate-chart-entry p-2">
              <div className="flex items-start gap-1" style={customW ? { width: customW } : undefined}>
                <div className="flex-1 min-w-0 flex flex-col">
                  <ChartRenderer
                    datasetId={datasetId}
                    config={entry.config}
                    onConfigChange={(u) => updateChartConfig(entry.id, u)}
                    height={h}
                  />
                  {/* ページ由来は高さ・幅リサイズ非対応 */}
                  {!isPageEntry && (
                    <div
                      onMouseDown={(e) => startChartResize(e, entry, "height")}
                      className="group h-2 flex items-center justify-center cursor-row-resize select-none"
                      title="ドラッグで高さ変更"
                    >
                      <div className="h-[3px] w-20 bg-gray-400 group-hover:bg-blue-500 rounded transition-colors" />
                    </div>
                  )}
                </div>
                {!isPageEntry && !isRight && (
                  <div
                    onMouseDown={(e) => startChartResize(e, entry, "width")}
                    className="group shrink-0 w-2 flex items-center justify-center cursor-col-resize select-none"
                    title="ドラッグで幅変更"
                    style={{ height: h }}
                  >
                    <div className="w-[3px] h-20 bg-gray-400 group-hover:bg-blue-500 rounded transition-colors" />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 mt-1 px-1">
                {isPageEntry ? (
                  <>
                    <button
                      onClick={() => {
                        if (entry.source) {
                          window.dispatchEvent(new CustomEvent("lablate-navigate-page", { detail: { pageId: entry.source.pageId } }));
                        }
                      }}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
                      title="このグラフがあるページへ移動"
                    >
                      ページで開く
                    </button>
                    <span className="text-[10px] text-gray-400 ml-1">ページ由来 · 削除はページから</span>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => onInsertChartToDocument(datasetId, entry.config)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-600"
                    >
                      <FileDown size={11} /> 挿入
                    </button>
                    <button
                      onClick={() => removeChart(entry.id)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-red-50 text-gray-400 hover:text-red-500"
                    >
                      削除
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    )
  );

  return (
    <div ref={wrapperRef} className="flex-1 flex flex-col overflow-hidden">
      <style>{SHEET_STYLES}</style>

      {/* ── ツールバー（タイトル統合） ── */}
      <div className="relative flex items-stretch bg-gray-50 border-b border-gray-200 shrink-0">
        {/* シート側（title + Import/行/列）— 右展開時は flex-basis でスプリッタに合わせる */}
        <div
          className="flex items-center gap-1.5 px-3 py-1 min-w-0"
          style={isRight && showChartContent
            ? { flexBasis: `${splitPercent}%`, flexGrow: 0, flexShrink: 0 }
            : { flex: "1 1 auto", minWidth: 0 }}
        >
          {/* 親ページ名（読み取り専用、クリックでそのページへ遷移） */}
          {parentPageName && (
            <>
              <button
                onClick={() => {
                  if (parentPageId) {
                    window.dispatchEvent(new CustomEvent("lablate-navigate-page", { detail: { pageId: parentPageId } }));
                  }
                }}
                className="shrink-0 text-sm font-medium text-gray-500 hover:text-gray-700 hover:underline truncate max-w-[180px] px-1.5 py-0.5"
                title={`親ページ: ${parentPageName}`}
              >
                {parentPageName}
              </button>
              <span className="shrink-0 text-sm text-gray-300 select-none">/</span>
            </>
          )}
          <input
            value={datasetName}
            onChange={(e) => setDatasetName(e.target.value)}
            onBlur={(e) => commitDatasetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDatasetName(getDatasetMeta(datasetId)?.name ?? "");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="データセット"
            className="min-w-0 flex-1 text-sm font-medium text-gray-600 placeholder-gray-300 outline-none bg-transparent border border-transparent focus:border-gray-300 rounded px-1.5 py-0.5 truncate"
            title={datasetName}
          />
          {/* Import / 行 / 列（右詰め） */}
          <div className="shrink-0 flex items-center gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
            >
              <Import size={12} /> インポート
            </button>
            <button
              onClick={() => instanceRef.current?.insertRow()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
            >
              <Plus size={12} /> 行
            </button>
            <button
              onClick={() => instanceRef.current?.insertColumn()}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
            >
              <Plus size={12} /> 列
            </button>
          </div>
        </div>

        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />

        {/* チャート側（右配置モード時のみ） — ボタンは右詰め */}
        {isRight && (
          <div className={`flex items-center gap-1 px-3 py-1 justify-end ${showChartContent ? "flex-1" : "shrink-0 ml-auto"}`}>
            {!showChartContent && chartCollapseBtn}
            {chartAddBtn}
            {chartPositionBtn}
          </div>
        )}
        {/* 右配置+展開時: スプリッタをツールバー上部まで延伸 + たたむボタン */}
        {isRight && showChartContent && (
          <>
            <div
              onMouseDown={startSplitDrag}
              onMouseEnter={() => setSplitterHover(true)}
              onMouseLeave={() => setSplitterHover(false)}
              className="absolute cursor-col-resize"
              style={{ left: `calc(${splitPercent}% - 3px)`, width: 10, top: 0, bottom: "-1px" }}
            >
              <div
                className="h-full transition-colors"
                style={{ width: 4, marginLeft: 3, backgroundColor: splitterHover ? "#60a5fa" : "#e5e7eb" }}
              />
            </div>
            <div
              className="absolute inset-y-0 flex items-center pointer-events-none"
              style={{ left: `${splitPercent}%` }}
            >
              <div className="pointer-events-auto pl-1.5">
                {chartCollapseBtn}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── メイン: 右/下 分割 ── */}
      <div ref={contentRef} className={`flex flex-1 overflow-hidden ${isRight ? "flex-row" : "flex-col"}`}>
        {/* スプレッドシート */}
        <div
          style={showPanel && showChartContent ? { flexBasis: `${splitPercent}%` } : undefined}
          className={`overflow-auto ${showPanel && showChartContent ? "shrink-0" : "flex-1"}`}
        >
          <div ref={containerRef} className="h-full" />
        </div>

        {/* 分割バー（折りたたみ時は非表示） */}
        {showSplitter && (
          <div
            onMouseDown={startSplitDrag}
            onMouseEnter={() => setSplitterHover(true)}
            onMouseLeave={() => setSplitterHover(false)}
            className={`shrink-0 transition-colors ${
              isRight ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"
            }`}
            style={{ backgroundColor: splitterHover ? "#60a5fa" : "#e5e7eb" }}
          />
        )}

        {/* グラフパネル（right+collapsed のときは描画しない） */}
        {showPanel && (
          <div
            className={`flex flex-col bg-white overflow-hidden ${
              isRight ? "border-l border-gray-100" : "border-t border-gray-100"
            } ${showChartContent ? "flex-1" : "shrink-0"}`}
          >
            {/* 下配置時のみヘッダを描画（右配置時の全操作はツールバー側） */}
            {!isRight && (
              <div className="px-2 py-0.5 border-b border-gray-200 flex items-center gap-1 shrink-0 bg-gray-50/60">
                {chartCollapseBtn}
                <div className="flex-1" />
                {chartAddBtn}
                {chartPositionBtn}
              </div>
            )}
            {showChartContent && (
              <div className="flex-1 overflow-y-auto">
                {chartBody}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
