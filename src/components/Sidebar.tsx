"use client";

import { FilePlus } from "lucide-react";
import { PageTree, ROOT_ID } from "@/lib/storage";
import PageTreeItem from "./PageTreeItem";

interface Props {
  tree: PageTree;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export default function Sidebar({
  tree,
  selectedId,
  onSelect,
  onAddChild,
  onRename,
  onDelete,
}: Props) {
  const root = tree[ROOT_ID];

  return (
    <aside className="flex h-full flex-col bg-gray-50 border-r border-gray-200">
      {/* ── ヘッダー（VSCode風: タイトル + ファイル作成アイコン） ── */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          ページ
        </span>
        <button
          onClick={() => onAddChild(ROOT_ID)}
          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
          title="新規ページ"
        >
          <FilePlus size={15} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {root?.children.map((childId) => (
          <PageTreeItem
            key={childId}
            nodeId={childId}
            tree={tree}
            selectedId={selectedId}
            depth={0}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </nav>
    </aside>
  );
}
