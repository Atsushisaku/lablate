"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { loadDataset, saveDataset, Dataset, registerDataset } from "@/lib/storage";
import { Upload, Plus, FileDown } from "lucide-react";
import { ChartRenderer, ChartConfig, defaultChartConfig } from "./blocks/ChartRenderer";
import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";

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

interface SpreadsheetChartEntry { id: string; config: ChartConfig }

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
  const [splitPercent, setSplitPercent] = useState(() => {
    try {
      const v = localStorage.getItem(`lablate_spreadsheet_split_${datasetId}`);
      return v ? parseInt(v) : 60;
    } catch { return 60; }
  });

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
  const splitDragRef = useRef<{ startX: number; startPercent: number } | null>(null);

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
    const next = charts.map((c) =>
      c.id === chartId ? { ...c, config: { ...c.config, ...updates } } : c
    );
    setCharts(next);
    saveSheetCharts(datasetId, next);
  };

  const removeChart = (chartId: string) => {
    const next = charts.filter((c) => c.id !== chartId);
    setCharts(next);
    saveSheetCharts(datasetId, next);
  };

  // ── リサイズ分割バー ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = splitDragRef.current;
      if (!d) return;
      const totalWidth = (containerRef.current?.parentElement?.parentElement as HTMLElement)?.offsetWidth ?? 800;
      const dx = e.clientX - d.startX;
      const pct = Math.max(30, Math.min(80, d.startPercent + (dx / totalWidth) * 100));
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
  }, [datasetId, splitPercent]);

  const startSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { startX: e.clientX, startPercent: splitPercent };
  };

  return (
    <div ref={wrapperRef} className="flex-1 flex flex-col overflow-hidden">
      <style>{SHEET_STYLES}</style>

      {/* ── ツールバー ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
        >
          <Upload size={12} /> CSV読み込む
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
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
      </div>

      {/* ── メイン: 左右分割 ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左: スプレッドシート */}
        <div style={{ flexBasis: `${splitPercent}%` }} className="shrink-0 overflow-auto">
          <div ref={containerRef} className="h-full" />
        </div>

        {/* 分割バー */}
        <div
          onMouseDown={startSplitDrag}
          className="w-1 shrink-0 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors"
        />

        {/* 右: グラフパネル */}
        <div className="flex-1 overflow-y-auto bg-white border-l border-gray-100">
          <div className="p-3 border-b border-gray-200 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">グラフ</span>
            <button
              onClick={addChart}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
            >
              <Plus size={12} /> グラフ追加
            </button>
          </div>

          {charts.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-xs">
              「グラフ追加」でデータを可視化
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {charts.map((entry) => (
                <div key={entry.id} className="p-2">
                  <ChartRenderer
                    datasetId={datasetId}
                    config={entry.config}
                    onConfigChange={(u) => updateChartConfig(entry.id, u)}
                    height={260}
                  />
                  <div className="flex gap-1 mt-1 px-1">
                    <button
                      onClick={() => onInsertChartToDocument(datasetId, entry.config)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-blue-50 text-gray-500 hover:text-blue-600"
                    >
                      <FileDown size={11} /> md に挿入
                    </button>
                    <button
                      onClick={() => removeChart(entry.id)}
                      className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-red-50 text-gray-400 hover:text-red-500"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
