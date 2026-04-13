"use client";

import { useEffect } from "react";
import { BlockNoteSchema, defaultBlockSpecs, PartialBlock, filterSuggestionItems } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { loadDoc, saveDoc, registerDataset } from "@/lib/storage";
import { csvTableBlockSpec } from "./blocks/CsvTableBlock";
import { chartBlockSpec } from "./blocks/ChartBlock";
import { Table2, BarChart2 } from "lucide-react";

// ── カスタムブロックを含むスキーマ ────────────────────────────────────

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    csvTable: csvTableBlockSpec,
    chart: chartBlockSpec,
  },
});

// ── エディタコンポーネント ────────────────────────────────────────────

interface Props {
  pageId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorReady?: (editor: any) => void;
}

export default function WorklogEditor({ pageId, onEditorReady }: Props) {
  const editor = useCreateBlockNote({
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialContent: (loadDoc(pageId) ?? undefined) as any,
  });

  // エディタ参照を親に公開（React ライフサイクル外で実行し flushSync 衝突を回避）
  useEffect(() => {
    const id = setTimeout(() => onEditorReady?.(editor), 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      saveDoc(pageId, editor.document as PartialBlock[]);
    });
    return () => unsubscribe?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** ブロックをカーソル直後に挿入する */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertBlock = (blockConfig: any) => {
    // エディタ未初期化ガード
    if (!editor?.document?.length) return;
    try {
      const pos = editor.getTextCursorPosition();
      if (pos?.block) {
        editor.insertBlocks([blockConfig], pos.block, "after");
      } else {
        throw new Error("no cursor");
      }
    } catch {
      const last = editor.document[editor.document.length - 1];
      if (last) editor.insertBlocks([blockConfig], last, "after");
    }
    try { editor.focus(); } catch { /* ignore */ }
  };

  return (
    <div>
      {/* 挿入ツールバー */}
      <div className="flex items-center gap-1 px-1 mb-1">
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            insertBlock({
              type: "csvTable",
              props: { datasetId: (() => { const id = crypto.randomUUID(); registerDataset(id); return id; })() },
            });
          }}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100"
          title="CSVテーブルを挿入（または / メニュー）"
        >
          <Table2 size={13} />
          CSVテーブル
        </button>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            insertBlock({
              type: "chart",
              props: { datasetId: "" },
            });
          }}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100"
          title="グラフを挿入（または / メニュー）"
        >
          <BarChart2 size={13} />
          グラフ
        </button>
      </div>

      {/* BlockNote エディタ（/ メニューにカスタムアイテムを追加） */}
      <BlockNoteView
        editor={editor}
        theme="light"
        className="min-h-screen"
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) =>
            filterSuggestionItems(
              [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(getDefaultReactSlashMenuItems(editor as any) as any[]),
                {
                  title: "CSVテーブル",
                  group: "データ",
                  icon: <Table2 size={18} />,
                  aliases: ["csv", "table", "テーブル", "データ"],
                  onItemClick: () =>
                    insertBlock({
                      type: "csvTable",
                      props: { datasetId: (() => { const id = crypto.randomUUID(); registerDataset(id); return id; })() },
                    }),
                },
                {
                  title: "グラフ",
                  group: "データ",
                  icon: <BarChart2 size={18} />,
                  aliases: ["chart", "graph", "グラフ", "plot", "plotly"],
                  onItemClick: () =>
                    insertBlock({
                      type: "chart",
                      props: { datasetId: "" },
                    }),
                },
              ],
              query
            )
          }
        />
      </BlockNoteView>
    </div>
  );
}
