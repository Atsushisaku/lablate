"use client";

import { Plus } from "lucide-react";
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
      <div className="px-3 pt-4 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          ページ
        </span>
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

      <div className="border-t border-gray-200 p-2">
        <button
          onClick={() => onAddChild(ROOT_ID)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <Plus size={15} />
          新規ページ
        </button>
      </div>
    </aside>
  );
}
