"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { loadDataset, saveDataset, Dataset, registerDataset, getDatasetMeta, renameDataset } from "@/lib/storage";
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
  onInsertChartToDocument: (datasetId: string) => void;
}

export default function SpreadsheetTab({ datasetId, onInsertChartToDocument }: Props) {
  const [datasetName, setDatasetName] = useState(() => getDatasetMeta(datasetId)?.name ?? "スプレッドシート");
  const [charts, setCharts] = useState<SpreadsheetChartEntry[]>(() => loadSheetCharts(datasetId));
  const [splitPercent, setSplitPercent] = useState(() => {
    try {
      const v = localStorage.getItem(`lablate_spreadsheet_split_${datasetId}`);
      return v ? parseInt(v) : 60;
    } catch { return 60; }
  });

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mySourceId = useRef(`sheet-${datasetId}`);
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

  // ── 外部変更のリッスン（インラインテーブルからの変更を反映） ──
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

  // ── jspreadsheet 初期化 ──
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let destroyed = false;

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
        onchange: persistData,
        oninsertrow: persistData,
        ondeleterow: persistData,
        oninsertcolumn: persistData,
        ondeletecolumn: persistData,
        onchangeheader: persistData,
      });
      instanceRef.current = worksheets[0];
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

  // ── 名前変更 ──
  const handleRename = (name: string) => {
    setDatasetName(name);
    renameDataset(datasetId, name);
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
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── ツールバー ── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 shrink-0">
        <input
          value={datasetName}
          onChange={(e) => handleRename(e.target.value)}
          className="text-sm font-medium px-2 py-1 border border-gray-200 rounded outline-none bg-white w-48"
          placeholder="データセット名"
        />
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
                      onClick={() => onInsertChartToDocument(datasetId)}
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
