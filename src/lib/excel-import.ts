import type { Dataset } from "./storage";

export const MAX_CELLS = 100_000;

export interface SheetSummary {
  name: string;
  rows: number;
  cols: number;
}

export interface ExcelParseResult {
  sheets: SheetSummary[];
  /** 指定シートを Dataset に変換 */
  getDataset(sheetName: string): Dataset;
}

/**
 * Excel ファイル (.xlsx / .xls) をパースし、シート一覧を返す。
 * 値変換ルール:
 *   - 数値 / パーセント: raw 値 (例: 1234.56 / 0.123) を文字列化
 *   - 日付: Excel の表示書式 (cell.w) をそのまま使用
 *   - 数式: 計算済み値のみ取り込み
 *   - 結合セル: 範囲内の全セルにトップ値をコピー
 *   - 末尾の空行/空列はトリム
 */
export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  // cellDates:false → 日付は serial のまま、.w に表示文字列が入る
  // cellFormula:false → 数式文字列は捨てて値のみ残す
  const wb = XLSX.read(buffer, { type: "array", cellDates: false, cellFormula: false });

  const sheets: SheetSummary[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws?.["!ref"];
    if (!ref) return { name, rows: 0, cols: 0 };
    const range = XLSX.utils.decode_range(ref);
    return {
      name,
      rows: range.e.r - range.s.r + 1,
      cols: range.e.c - range.s.c + 1,
    };
  });

  return {
    sheets,
    getDataset: (sheetName: string) => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return { headers: [], rows: [] };
      return worksheetToDataset(ws, XLSX);
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function worksheetToDataset(ws: any, XLSX: typeof import("xlsx")): Dataset {
  const ref = ws["!ref"];
  if (!ref) return { headers: [], rows: [] };
  const range = XLSX.utils.decode_range(ref);

  // 結合セルマップ: "r,c" → トップ左セル (r, c)
  const merges = (ws["!merges"] ?? []) as Array<{
    s: { r: number; c: number };
    e: { r: number; c: number };
  }>;
  const mergeMap = new Map<string, { r: number; c: number }>();
  for (const m of merges) {
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        mergeMap.set(`${r},${c}`, { r: m.s.r, c: m.s.c });
      }
    }
  }

  const rows: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const origin = mergeMap.get(`${r},${c}`) ?? { r, c };
      const addr = XLSX.utils.encode_cell(origin);
      row.push(cellToString(ws[addr]));
    }
    rows.push(row);
  }

  const trimmed = trimEmpty(rows);
  const colCount = trimmed[0]?.length ?? 0;
  const headers = Array.from({ length: colCount }, (_, i) => colLetter(i));
  return { headers, rows: trimmed };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellToString(cell: any): string {
  if (!cell) return "";
  const { t, v, w } = cell;
  switch (t) {
    case "s":
      return String(v ?? "");
    case "n":
      return v == null ? "" : String(v);
    case "b":
      return v ? "TRUE" : "FALSE";
    case "d":
      return w ?? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
    case "e":
      return w ?? "#ERROR";
    default:
      return String(v ?? "");
  }
}

function trimEmpty(rows: string[][]): string[][] {
  let endRow = rows.length;
  while (endRow > 0 && rows[endRow - 1].every((v) => v === "")) endRow--;
  const sliced = rows.slice(0, endRow);
  if (sliced.length === 0) return [];

  const maxCol = Math.max(...sliced.map((r) => r.length));
  let endCol = maxCol;
  while (endCol > 0 && sliced.every((r) => (r[endCol - 1] ?? "") === "")) endCol--;

  return sliced.map((r) => {
    const padded = [...r];
    while (padded.length < endCol) padded.push("");
    return padded.slice(0, endCol);
  });
}

function colLetter(i: number): string {
  let result = "";
  let n = i + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
