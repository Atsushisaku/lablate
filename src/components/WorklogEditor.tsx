"use client";

import { useEffect, useCallback, useRef } from "react";
import { BlockNoteSchema, defaultBlockSpecs, PartialBlock, filterSuggestionItems } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { loadDoc, saveDoc, registerDataset, loadTree, ROOT_ID } from "@/lib/storage";
import { useSyncContext } from "@/lib/storage/sync-context";
import { csvTableBlockSpec } from "./blocks/CsvTableBlock";
import { chartBlockSpec } from "./blocks/ChartBlock";
import { imageBlockSpec } from "./blocks/ImageBlock";
import { pageLinkBlockSpec } from "./blocks/PageLinkBlock";
import { Table2, BarChart2, ImagePlus, FileText } from "lucide-react";

// ── カスタムブロックを含むスキーマ ────────────────────────────────────

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    csvTable: csvTableBlockSpec,
    chart: chartBlockSpec,
    image: imageBlockSpec,
    pageLink: pageLinkBlockSpec,
  },
});

// ── エディタコンポーネント ────────────────────────────────────────────

interface Props {
  pageId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorReady?: (editor: any) => void;
}

export default function WorklogEditor({ pageId, onEditorReady }: Props) {
  const { notifyChange } = useSyncContext();
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
      notifyChange(`lablate_doc_${pageId}`);
    });
    return () => unsubscribe?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── カスタムブロック直後の Backspace でブロックが消える問題を防止 ──
  // ProseMirror は段落先頭で Backspace すると前のノードと結合しようとするが、
  // content:"none" のカスタムブロックは結合できないため削除されてしまう。
  // これをキャプチャフェーズで検知し、代わりに空段落を削除するだけにする。
  const CUSTOM_BLOCK_TYPES = new Set(["csvTable", "chart", "image", "pageLink"]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;

      try {
        const pos = editor.getTextCursorPosition();
        if (!pos?.block) return;
        const currentBlock = pos.block;

        if (e.key === "Backspace") {
          // カーソルがブロック先頭かつ前のブロックがカスタムブロックの場合
          const prev = pos.prevBlock;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (prev && CUSTOM_BLOCK_TYPES.has((prev as any).type)) {
            // 現在ブロックが空テキストなら現在ブロックを削除（カスタムブロックは残す）
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cur = currentBlock as any;
            if (cur.type === "paragraph" && (!cur.content || cur.content.length === 0 ||
                (cur.content.length === 1 && cur.content[0].type === "text" && cur.content[0].text === ""))) {
              e.preventDefault();
              e.stopPropagation();
              editor.removeBlocks([currentBlock]);
              return;
            }
            // テキストがある場合はカーソル位置を確認
            const pmView = editor.prosemirrorView;
            if (pmView) {
              const { from } = pmView.state.selection;
              const resolved = pmView.state.doc.resolve(from);
              // 親ノードの開始位置 + 1 = テキストの先頭
              if (from === resolved.start()) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }
          }
        }

        if (e.key === "Delete") {
          // カーソルがブロック末尾かつ次のブロックがカスタムブロックの場合
          const next = pos.nextBlock;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (next && CUSTOM_BLOCK_TYPES.has((next as any).type)) {
            const pmView = editor.prosemirrorView;
            if (pmView) {
              const { from } = pmView.state.selection;
              const resolved = pmView.state.doc.resolve(from);
              if (from === resolved.end()) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
            }
          }
        }
      } catch { /* エディタ未初期化時等は無視 */ }
    };

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

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

  // ── エディタ領域へのD&D / ペーストで画像ブロックを挿入 ──
  const editorWrapRef = useRef<HTMLDivElement>(null);

  const handleImageFile = useCallback((file: File | Blob) => {
    insertBlock({ type: "image", props: { imageId: "" } });
    // 挿入直後のブロックに画像を渡すため、カスタムイベントで通知
    // → ImageBlock 側は props.imageId が空なので D&D ゾーンが表示される
    // ここでは空の imageBlock を挿入し、ユーザーがそこにファイルを渡す形にする
    // 代わりに、直接 IndexedDB に保存してブロックを更新する
    (async () => {
      const { compressImage } = await import("@/lib/storage/image-store");
      const { imageStore } = await import("@/lib/storage/image-store");
      const id = crypto.randomUUID();
      const { blob, width, height } = await compressImage(file);
      const meta = {
        id,
        name: file instanceof File ? file.name : "image",
        mimeType: blob.type,
        width, height,
        size: blob.size,
        createdAt: new Date().toISOString(),
      };
      await imageStore.save(id, blob, meta);
      // 最後に挿入されたブロックを見つけて更新
      const doc = editor.document;
      for (let i = doc.length - 1; i >= 0; i--) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b = doc[i] as any;
        if (b.type === "image" && !b.props?.imageId) {
          editor.updateBlock(b, { props: { imageId: id } });
          break;
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const onEditorDrop = useCallback((e: React.DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) {
      e.preventDefault();
      e.stopPropagation();
      handleImageFile(file);
    }
  }, [handleImageFile]);

  useEffect(() => {
    const el = editorWrapRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) handleImageFile(file);
          return;
        }
      }
    };
    el.addEventListener("paste", handler, true);
    return () => el.removeEventListener("paste", handler, true);
  }, [handleImageFile]);

  return (
    <div ref={editorWrapRef} onDrop={onEditorDrop} onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}>
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
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            insertBlock({
              type: "image",
              props: { imageId: "" },
            });
          }}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100"
          title="画像を挿入（または / メニュー）"
        >
          <ImagePlus size={13} />
          画像
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
                {
                  title: "画像",
                  group: "メディア",
                  icon: <ImagePlus size={18} />,
                  aliases: ["image", "photo", "picture", "画像", "写真"],
                  onItemClick: () =>
                    insertBlock({
                      type: "image",
                      props: { imageId: "" },
                    }),
                },
                // ── ページリンク（ツリー内の全ページを候補に） ──
                ...(() => {
                  const tree = loadTree();
                  const pages: { id: string; title: string }[] = [];
                  const collect = (nodeId: string) => {
                    const node = tree[nodeId];
                    if (!node) return;
                    if (nodeId !== ROOT_ID && nodeId !== pageId) {
                      pages.push({ id: nodeId, title: node.title || "無題のページ" });
                    }
                    node.children.forEach(collect);
                  };
                  collect(ROOT_ID);
                  return pages.map((p) => ({
                    title: p.title,
                    group: "ページリンク",
                    icon: <FileText size={18} />,
                    aliases: ["page", "link", "ページ", "リンク", p.title],
                    onItemClick: () =>
                      insertBlock({
                        type: "pageLink",
                        props: { pageId: p.id },
                      }),
                  }));
                })(),
              ],
              query
            )
          }
        />
      </BlockNoteView>
    </div>
  );
}
