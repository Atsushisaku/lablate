"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronRight, FileText, Plus, Trash2 } from "lucide-react";
import { PageNode, PageTree } from "@/lib/storage";

interface Props {
  nodeId: string;
  tree: PageTree;
  selectedId: string;
  depth: number;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export default function PageTreeItem({
  nodeId,
  tree,
  selectedId,
  depth,
  onSelect,
  onAddChild,
  onRename,
  onDelete,
}: Props) {
  const node: PageNode | undefined = tree[nodeId];
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (!node) return null;

  const hasChildren = node.children.length > 0;
  const isSelected = nodeId === selectedId;

  function startEdit() {
    setEditValue(node!.title);
    setEditing(true);
  }

  function commitEdit() {
    if (editValue.trim()) {
      onRename(nodeId, editValue.trim());
    }
    setEditing(false);
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer select-none ${
          isSelected
            ? "bg-gray-200 text-gray-900"
            : "text-gray-700 hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(nodeId)}
        onDoubleClick={startEdit}
      >
        {/* 展開トグル */}
        <span
          className={`shrink-0 transition-transform ${open && hasChildren ? "rotate-90" : ""} ${hasChildren ? "opacity-60" : "opacity-0 pointer-events-none"}`}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        >
          <ChevronRight size={14} />
        </span>

        <FileText size={14} className="shrink-0 opacity-50" />

        {/* タイトル */}
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-white border border-blue-400 rounded px-1 outline-none text-sm"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{node.title}</span>
        )}

        {/* アクションボタン（ホバー時） */}
        {hovered && !editing && (
          <span className="flex items-center gap-0.5 shrink-0">
            <button
              title="子ページを追加"
              onClick={(e) => { e.stopPropagation(); onAddChild(nodeId); }}
              className="rounded p-0.5 hover:bg-gray-300 text-gray-500"
            >
              <Plus size={13} />
            </button>
            <button
              title="削除"
              onClick={(e) => { e.stopPropagation(); onDelete(nodeId); }}
              className="rounded p-0.5 hover:bg-red-100 text-gray-400 hover:text-red-500"
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>

      {/* 子ページ */}
      {open && hasChildren && node.children.map((childId) => (
        <PageTreeItem
          key={childId}
          nodeId={childId}
          tree={tree}
          selectedId={selectedId}
          depth={depth + 1}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
