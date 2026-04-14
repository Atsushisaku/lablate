/**
 * BlockNote ブロック配列 → Markdown 変換
 * LLM や PPT 作成の素材として使える形式で出力する
 */

import { PartialBlock } from "@blocknote/core";
import { PageTree, ROOT_ID, getDatasetMeta } from "../storage";

// ── インライン変換 ──────────────────────────────────────────────────

interface InlineContent {
  type: string;
  text?: string;
  styles?: Record<string, boolean | string>;
  content?: InlineContent[];
  href?: string;
}

function inlineToMd(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as InlineContent[])
    .map((c) => {
      if (c.type === "link") {
        const linkText = inlineToMd(c.content);
        return `[${linkText}](${c.href ?? ""})`;
      }
      let text = c.text ?? "";
      if (!text) return "";
      const s = c.styles ?? {};
      if (s.bold) text = `**${text}**`;
      if (s.italic) text = `*${text}*`;
      if (s.strike) text = `~~${text}~~`;
      if (s.code) text = `\`${text}\``;
      return text;
    })
    .join("");
}

// ── ブロック変換 ────────────────────────────────────────────────────

interface BlockLike {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

function blockToMd(block: BlockLike, tree: PageTree, indent = ""): string {
  const type = block.type ?? "paragraph";
  const props = block.props ?? {};
  const text = inlineToMd(block.content);

  let line = "";

  switch (type) {
    case "heading": {
      const level = (props.level as number) ?? 1;
      line = `${"#".repeat(level)} ${text}`;
      break;
    }
    case "paragraph":
      line = text;
      break;
    case "bulletListItem":
      line = `${indent}- ${text}`;
      break;
    case "numberedListItem":
      line = `${indent}1. ${text}`;
      break;
    case "checkListItem": {
      const checked = props.checked ? "x" : " ";
      line = `${indent}- [${checked}] ${text}`;
      break;
    }
    case "csvTable": {
      const datasetId = props.datasetId as string;
      const meta = datasetId ? getDatasetMeta(datasetId) : null;
      const title = meta?.name ?? "テーブル";
      line = `[${title}](../datasets/${datasetId}.csv)`;
      break;
    }
    case "chart": {
      const blockId = (props as Record<string, string>).datasetId ?? "";
      // chart の blockId は実際にはブロック自体のIDだが、ここでは datasetId を使う
      line = `![グラフ](../charts/${blockId}.png)`;
      break;
    }
    case "image": {
      const imageId = props.imageId as string;
      const alt = (props.alt as string) || "画像";
      const ext = "jpg"; // 圧縮済みは基本 JPEG
      line = `![${alt}](../images/${imageId}.${ext})`;
      break;
    }
    case "pageLink": {
      const pageId = props.pageId as string;
      const page = tree[pageId];
      const title = page?.title ?? "ページ";
      line = `[${title}](../pages/${pageId}/document.md)`;
      break;
    }
    default:
      // 不明ブロックはテキストとして出力
      line = text;
      break;
  }

  // 子ブロック（ネストされたリスト等）
  const children = block.children ?? [];
  const childLines = children
    .map((child) => blockToMd(child, tree, indent + "  "))
    .filter(Boolean)
    .join("\n");

  if (childLines) {
    return `${line}\n${childLines}`;
  }
  return line;
}

// ── メインエクスポート関数 ──────────────────────────────────────────

/**
 * BlockNote ブロック配列を Markdown 文字列に変換
 */
export function blocksToMarkdown(
  blocks: PartialBlock[],
  tree: PageTree,
  pageTitle?: string,
): string {
  const lines: string[] = [];

  // ページタイトルがあれば H1 として出力
  if (pageTitle) {
    lines.push(`# ${pageTitle}`);
    lines.push("");
  }

  for (const block of blocks as BlockLike[]) {
    const md = blockToMd(block, tree);
    lines.push(md);
    lines.push(""); // ブロック間に空行
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── CSV 変換 ────────────────────────────────────────────────────────

/**
 * Dataset を CSV 文字列に変換
 */
export function datasetToCsv(headers: string[], rows: string[][]): string {
  const escape = (cell: string) => {
    if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  };

  const lines: string[] = [];
  lines.push(headers.map(escape).join(","));
  for (const row of rows) {
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * CSV 文字列を Dataset に変換
 */
export function csvToDataset(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.trim().split("\n");
  if (lines.length === 0) return { headers: [], rows: [] };

  const parse = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          cells.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    cells.push(current);
    return cells;
  };

  const headers = parse(lines[0]);
  const rows = lines.slice(1).map(parse);
  return { headers, rows };
}
