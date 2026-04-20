import type { Dataset } from "./storage";

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

/**
 * CSV 文字列を Dataset に変換する。
 * 仕様: 全行をデータ行とし、headers は A/B/C... を自動採番。
 */
export function parseCsvAllRows(text: string): Dataset {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const res: string[] = [];
    let buf = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { buf += '"'; i++; }
        else inQ = !inQ;
      } else if (c === "," && !inQ) {
        res.push(buf);
        buf = "";
      } else {
        buf += c;
      }
    }
    res.push(buf);
    return res;
  };
  const rows = lines.map(parseRow);
  const colCount = Math.max(...rows.map((r) => r.length));
  return { headers: Array.from({ length: colCount }, (_, i) => colLetter(i)), rows };
}
