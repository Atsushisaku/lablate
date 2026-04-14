"use client";

import { useState, useEffect } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { FileText } from "lucide-react";

// ── PageLinkView ─────────────────────────────────────────────────────

function PageLinkView({
  block,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any;
}) {
  const { pageId: linkedPageId } = block.props as { pageId: string };
  const [pageTitle, setPageTitle] = useState("");

  // ページタイトルを localStorage から取得
  useEffect(() => {
    if (!linkedPageId) return;
    const loadTitle = () => {
      try {
        const raw = localStorage.getItem("lablate_tree");
        if (!raw) return;
        const tree = JSON.parse(raw);
        const node = tree[linkedPageId];
        if (node) setPageTitle(node.title || "無題のページ");
      } catch { /* ignore */ }
    };
    loadTitle();
    // ページ名変更を検知するために storage イベントをリッスン
    const handler = () => loadTitle();
    window.addEventListener("storage", handler);
    // カスタムイベントでも更新（同一タブ内の変更用）
    window.addEventListener("lablate-tree-change", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("lablate-tree-change", handler);
    };
  }, [linkedPageId]);

  if (!linkedPageId) {
    return (
      <div className="my-1 px-3 py-2 rounded border border-dashed border-gray-300 text-gray-400 text-sm">
        ページリンク: ページが選択されていません
      </div>
    );
  }

  return (
    <div
      className="my-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors border border-gray-200 text-sm"
      onClick={() => {
        // ページ遷移をカスタムイベントで通知
        window.dispatchEvent(new CustomEvent("lablate-navigate-page", {
          detail: { pageId: linkedPageId },
        }));
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <FileText size={15} className="text-gray-400 shrink-0" />
      <span className="text-gray-700 hover:text-blue-600 transition-colors">
        {pageTitle || "読み込み中..."}
      </span>
    </div>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const pageLinkBlockSpec = createReactBlockSpec(
  {
    type: "pageLink" as const,
    propSchema: {
      pageId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block }) => <PageLinkView block={block} />,
  }
);
