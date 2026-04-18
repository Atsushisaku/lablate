"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { loadDataset, saveDataset, Dataset, registerDataset, getDatasetMeta, renameDataset } from "@/lib/storage";
import { Import, BarChart2, ChevronDown, Plus, ExternalLink } from "lucide-react";

import jspreadsheet from "jspreadsheet-ce";
import "jspreadsheet-ce/dist/jspreadsheet.css";
import "jsuites/dist/jsuites.css";

// ── ユーティリティ ────────────────────────────────────────────────────

const colLetter = (i: number): string => {
  let result = "";
  let n = i + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

function parseCsvAllRows(text: string): Dataset {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const res: string[] = [];
    let buf = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i+1] === '"') { buf += '"'; i++; } else inQ = !inQ; }
      else if (c === "," && !inQ) { res.push(buf); buf = ""; }
      else buf += c;
    }
    res.push(buf);
    return res;
  };
  const rows = lines.map(parseRow);
  const colCount = Math.max(...rows.map((r) => r.length));
  return { headers: Array.from({ length: colCount }, (_, i) => colLetter(i)), rows };
}

// ── テーブル設定（タイトル等） ─────────────────────────────────────────

type TableConfig = { title: string; showTitle: boolean };
const DEFAULT_TABLE_CONFIG: TableConfig = { title: "", showTitle: false };

function loadTableConfig(blockId: string): TableConfig {
  if (typeof window === "undefined") return DEFAULT_TABLE_CONFIG;
  try {
    const raw = localStorage.getItem(`lablate_table_cfg_${blockId}`);
    if (raw) return { ...DEFAULT_TABLE_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_TABLE_CONFIG;
}
function saveTableConfig(blockId: string, cfg: TableConfig) {
  localStorage.setItem(`lablate_table_cfg_${blockId}`, JSON.stringify(cfg));
}

// ── 削除ボタン用 SVG ─────────────────────────────────────────────────

const TRASH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;

// ── スプレッドシート注入スタイル ──────────────────────────────────────

const SHEET_STYLES = `
  /* 行インデックス列を最小幅に */
  .jss_worksheet > colgroup > col:first-child { width: 32px !important; }
  .jss_worksheet > thead > tr > td:first-child,
  .jss_worksheet > tbody > tr > td:first-child {
    width: 32px !important; min-width: 32px !important; max-width: 32px !important;
    position: relative !important;
  }
  .jss_worksheet > thead > tr > td { position: relative !important; }

  /* 削除ボタン */
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

  /* セル選択: highlight（現在セル）青色4辺枠線 */
  html body table.jss_worksheet td.highlight-left   { border-left:   2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-right  { border-right:  2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-top    { border-top:    2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight-bottom { border-bottom: 2px solid #1a73e8 !important; box-shadow: none !important; }
  html body table.jss_worksheet td.highlight        { background: transparent !important; }
  html body table.jss_worksheet td.highlight-selected { background: transparent !important; }
  html body table.jss_worksheet td.highlight-top.highlight-left { box-shadow: none !important; }

  /* セル選択: selection（範囲選択）青色枠線 + 薄い塗り */
  html body table.jss_worksheet td.selection-left   { border-left:   2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-right  { border-right:  2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-top    { border-top:    2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection-bottom { border-bottom: 2px solid #1a73e8 !important; }
  html body table.jss_worksheet td.selection        { background: rgba(26,115,232,0.07) !important; }

  /* 数式参照ハイライト（Google Sheets 風） */
  html body table.jss_worksheet td.lablate-fref {
    outline: 2px dashed #9c27b0 !important;
    outline-offset: -2px;
    background: rgba(156, 39, 176, 0.06) !important;
  }
`;

// ── TableView ─────────────────────────────────────────────────────────

function TableView({
  block,
  editor,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
}) {
  const datasetId: string = block.props.datasetId;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const s = localStorage.getItem(`lablate_collapsed_${block.id}`);
      if (s !== null) return s === "true";
    }
    return false;
  });

  const [tableConfig, setTableConfig] = useState<TableConfig>(() => {
    const cfg = loadTableConfig(block.id);
    // 既存の tableConfig.title を DatasetMeta に移行
    if (cfg.title && datasetId) {
      const meta = getDatasetMeta(datasetId);
      if (meta && (meta.name.startsWith("データセット") || !meta.name)) {
        renameDataset(datasetId, cfg.title);
      }
    }
    return cfg;
  });

  // ── データセット名（DatasetMeta.name を正とする） ──
  const [datasetTitle, setDatasetTitle] = useState(() => getDatasetMeta(datasetId)?.name ?? "");

  const handleTitleChange = useCallback((newTitle: string) => {
    setDatasetTitle(newTitle);
    renameDataset(datasetId, newTitle);
    // タブ名にも反映するためカスタムイベントを発火
    window.dispatchEvent(new CustomEvent("lablate-dataset-rename", {
      detail: { datasetId, name: newTitle },
    }));
  }, [datasetId]);

  const [initData, setInitData] = useState<Dataset>(() => {
    const d = loadDataset(datasetId);
    return d ?? { headers: ["A","B","C"], rows: [["","",""],["","",""],["","",""]] };
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef   = useRef<HTMLDivElement>(null);
  const titleRef     = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef  = useRef<any>(null);
  const fileRef      = useRef<HTMLInputElement>(null);
  const saveTimer    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isActiveRef  = useRef(false);
  const mySourceId   = useRef(`block-${block.id}`);
  /** 数式編集中の矢印キーで挿入するセル参照の状態 */
  const formulaRefRef = useRef<{ x: number; y: number; start: number; end: number } | null>(null);
  /** persistData の安定参照（useEffect の deps を汚さないため） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persistRef = useRef<() => void>(null as any);

  // ── タイトル設定の更新 ──

  const updateTableConfig = useCallback((updates: Partial<TableConfig>) => {
    setTableConfig((prev) => {
      const next = { ...prev, ...updates };
      saveTableConfig(block.id, next);
      return next;
    });
  }, [block.id]);

  // ── 折りたたみ ──

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(`lablate_collapsed_${block.id}`, String(next));
      return next;
    });
  };

  // ── データ永続化（列ヘッダーは常に A/B/C…） ──

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
      // グラフブロック・スプレッドシートタブにデータ変更を通知
      window.dispatchEvent(new CustomEvent("lablate-dataset-change", {
        detail: { datasetId, sourceId: mySourceId.current },
      }));
    }, 300);
  }, [datasetId]);
  persistRef.current = persistData;

  // ── 外部変更のリッスン（スプレッドシートタブからの変更を反映） ──

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
    const onIn  = () => { isActiveRef.current = true; };
    const onOut = (e: MouseEvent) => {
      if (!wrapper.contains(e.target as Node)) isActiveRef.current = false;
    };
    wrapper.addEventListener("mousedown", onIn);
    document.addEventListener("mousedown", onOut);
    return () => { wrapper.removeEventListener("mousedown", onIn); document.removeEventListener("mousedown", onOut); };
  }, []);

  // ── キーボード操作（document capture） ──
  // ProseMirror がキーを横取りするため capture フェーズで先にハンドルする。
  // Google Sheets ライクな操作: 直接入力で編集開始、Delete で消去、
  // 数式の "=" 入力後に矢印でセル参照挿入、Ctrl 系ショートカットなど。

  useEffect(() => {
    // ── 数式参照ハイライト管理 ──
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

      // ────────────── 編集モード ──────────────
      if (ws.edition) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const edArr = ws.edition as any[];
        const td = edArr?.[0] as HTMLElement | undefined;
        const input = td?.querySelector("input, textarea") as HTMLInputElement | null;
        if (!input) return;

        const text = input.value;
        const isFormula = text.startsWith("=");

        // ── 数式モード: 矢印キーでセル参照を挿入 / 更新 ──
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
          // 参照先セルをハイライト
          setFRefHL(rx, ry);
          return;
        }

        // 矢印以外のキーで参照追跡をリセット + ハイライト消去
        if (formulaRefRef.current) {
          formulaRefRef.current = null;
          clearFRefHL();
        }

        // Enter → 確定して下に移動
        if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL();
          input.blur();
          requestAnimationFrame(() => ws.down?.());
          return;
        }

        // Escape → 編集キャンセル
        if (e.key === "Escape") {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL();
          try { ws.closeEditor(td, false); } catch { input.blur(); }
          return;
        }

        // Tab → 確定して横に移動
        if (e.key === "Tab") {
          e.stopImmediatePropagation(); e.preventDefault();
          clearFRefHL();
          input.blur();
          requestAnimationFrame(() => (e.shiftKey ? ws.left() : ws.right()));
          return;
        }

        return; // その他のキーは jspreadsheet / ブラウザに委譲
      }

      // ────────────── セル選択モード ──────────────
      if (!ws.selectedCell) return;
      const sel = ws.selectedCell as [number, number, number, number];

      switch (e.key) {
        // ── ナビゲーション ──
        case "ArrowRight": e.stopImmediatePropagation(); e.preventDefault(); ws.right(e.shiftKey, ctrl); break;
        case "ArrowLeft":  e.stopImmediatePropagation(); e.preventDefault(); ws.left(e.shiftKey,  ctrl); break;
        case "ArrowDown":  e.stopImmediatePropagation(); e.preventDefault(); ws.down(e.shiftKey,  ctrl); break;
        case "ArrowUp":    e.stopImmediatePropagation(); e.preventDefault(); ws.up(e.shiftKey,    ctrl); break;

        // ── Enter / F2 → 編集モードに入る ──
        case "Enter":
        case "F2": {
          e.stopImmediatePropagation(); e.preventDefault();
          const table = containerRef.current?.querySelector("table.jss_worksheet") as HTMLTableElement | null;
          table?.tBodies?.[0]?.rows[sel[1]]?.cells[sel[0] + 1]
            ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
          break;
        }

        // ── Tab → 横移動 ──
        case "Tab":
          e.stopImmediatePropagation(); e.preventDefault();
          e.shiftKey ? ws.left() : ws.right();
          break;

        // ── Delete / Backspace → 選択セルをクリア ──
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

        // ── Escape → 選択解除 ──
        case "Escape":
          e.stopImmediatePropagation(); e.preventDefault();
          break;

        default: {
          // ── Ctrl / Cmd ショートカット ──
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

          // ── 印字可能文字 → 直接編集開始（セル内容を置き換え） ──
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

  // ── jspreadsheet 初期化・破棄 & 削除ボタン注入 ──

  useEffect(() => {
    if (collapsed || !containerRef.current) return;
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
        btn.addEventListener("click",     (e) => { e.stopPropagation(); instanceRef.current?.deleteRow(i, 1); });
        td.appendChild(btn);
      });
      table.querySelectorAll("thead > tr > td").forEach((td, i) => {
        if (i === 0) return;
        const btn = document.createElement("button");
        btn.className = "lablate-del"; btn.title = `列 ${colLetter(i-1)} を削除`; btn.innerHTML = TRASH_SVG;
        btn.addEventListener("mousedown", (e) => { e.stopPropagation(); e.preventDefault(); });
        btn.addEventListener("click",     (e) => { e.stopPropagation(); instanceRef.current?.deleteColumn(i-1, 1); });
        td.appendChild(btn);
      });
    };

    const withRefresh = (fn: () => void) => () => { fn(); setTimeout(refreshDeleteButtons, 0); };

    const tid = setTimeout(() => {
      if (destroyed || !container) return;
      const rows = initData.rows.length > 0 ? initData.rows : [new Array(initData.headers.length).fill("")];
      const worksheets = jspreadsheet(container, {
        worksheets: [{
          data: rows,
          columns: initData.headers.map((h) => ({ title: h, width: 120 })),
          minDimensions: [2, 3],
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
  }, [collapsed, initData, persistData]);

  // ── CSV インポート ──

  const handleCsvImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsvAllRows(ev.target?.result as string);
      if (!parsed.rows.length) return;
      saveDataset(datasetId, parsed);
      setInitData(parsed);
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }, [datasetId]);

  const addRow = useCallback(() => { instanceRef.current?.insertRow(); }, []);
  const addCol = useCallback(() => { instanceRef.current?.insertColumn(); }, []);

  const insertChart = useCallback(() => {
    setTimeout(() => {
      editor.insertBlocks([{ type: "chart", props: { datasetId } }], block, "after");
    }, 0);
  }, [datasetId, block, editor]);

  // ── JSX ──

  return (
    <div ref={wrapperRef} className="my-2 rounded-md border border-gray-200 overflow-hidden text-sm">
      <style>{SHEET_STYLES}</style>

        {/* ── カスタムツールバー ── */}
        <div className="flex items-center gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
          {/* 最小化 / 展開 */}
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleCollapsed}
            title={collapsed ? "展開" : "最小化"}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
            />
          </button>

          {collapsed ? (
            /* 折りたたみ時: タイトル + 行列数 */
            <span className="text-xs text-gray-500 truncate">
              {datasetTitle && <><span className="font-medium">{datasetTitle}</span><span className="mx-1 text-gray-300">·</span></>}
              {initData.headers.length} 列 × {initData.rows.length} 行
            </span>
          ) : (
            <>
              {/* タイトル入力（常時表示） */}
              <input
                ref={titleRef}
                value={datasetTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="タイトル"
                className="text-xs px-2 py-1 border border-gray-200 rounded outline-none bg-white min-w-0 w-40 text-gray-800 font-medium placeholder:font-normal placeholder:text-gray-400"
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") titleRef.current?.blur(); }}
                onMouseDown={(e) => e.stopPropagation()}
              />
              {/* 行追加 */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={addRow}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
                title="行を追加"
              >
                <Plus size={12} /> 行
              </button>
              {/* 列追加 */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={addCol}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
                title="列を追加"
              >
                <Plus size={12} /> 列
              </button>
              {/* グラフ追加 */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={insertChart}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
              >
                <BarChart2 size={12} /> グラフ
              </button>
              {/* CSV 読み込み */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600"
              >
                <Import size={12} /> インポート
              </button>
              {/* タブで開く（アイコンのみ） */}
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  registerDataset(datasetId);
                  window.dispatchEvent(new CustomEvent("lablate-open-spreadsheet-tab", { detail: { datasetId } }));
                }}
                className="flex items-center justify-center text-xs px-1.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-500"
                title="タブで開く"
              >
                <ExternalLink size={12} />
              </button>
            </>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleCsvImport} className="hidden" />
        </div>

      {/* ── スプレッドシート本体 ── */}
      {!collapsed && (
        <div ref={containerRef} className="overflow-auto" />
      )}
    </div>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const csvTableBlockSpec = createReactBlockSpec(
  {
    type: "csvTable" as const,
    propSchema: {
      datasetId: { default: "" },
      collapsed: { default: "false" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => <TableView block={block} editor={editor} />,
  }
);
