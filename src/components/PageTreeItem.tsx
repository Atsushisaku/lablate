"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronRight, Copy, FileText, FilePlus, Folder, FolderPlus, FolderOpen, Pencil, Plus, Scissors, ClipboardPaste, Trash2 } from "lucide-react";
import { PageNode, PageTree, isDescendant } from "@/lib/storage";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";

type DropPosition = "before" | "after" | "inside" | null;

interface Props {
  nodeId: string;
  tree: PageTree;
  selectedId: string;
  focusedId: string;
  depth: number;
  openFolders: Set<string>;
  editingId: string | null;
  cutId?: string | null;
  hasClipboard?: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddFolder?: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMove: (dragId: string, targetId: string, position: "before" | "after" | "inside") => void;
  onDuplicate?: (id: string) => void;
  onCopy?: (id: string) => void;
  onCut?: (id: string) => void;
  onPaste?: (targetId: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
}

/** ドラッグ中のノード ID を共有するための変数 */
let currentDragId: string | null = null;

export default function PageTreeItem({
  nodeId,
  tree,
  selectedId,
  focusedId,
  depth,
  openFolders,
  editingId,
  cutId,
  hasClipboard,
  onSelect,
  onFocus,
  onToggleFolder,
  onAddChild,
  onAddFolder,
  onRename,
  onDelete,
  onMove,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onStartEdit,
  onEndEdit,
}: Props) {
  const node: PageNode | undefined = tree[nodeId];
  const [hovered, setHovered] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [dropPos, setDropPos] = useState<DropPosition>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const editing = editingId === nodeId;

  // リネーム開始時にタイトルをセットしてフォーカス＋全選択
  useEffect(() => {
    if (editing && node) {
      setEditValue(node.title);
      // 次フレームで input にフォーカス＋全選択（値がセットされた後）
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // フォーカスが当たったら要素をビューに入れる
  useEffect(() => {
    if (focusedId === nodeId && rowRef.current) {
      rowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [focusedId, nodeId]);

  const resetDrop = useCallback(() => setDropPos(null), []);

  if (!node) return null;

  const isFolder = node.type === "folder";
  const hasChildren = node.children.length > 0;
  const open = (isFolder || hasChildren) ? openFolders.has(nodeId) : true;
  const isSelected = nodeId === selectedId;
  const isFocused = nodeId === focusedId;

  function startEdit() {
    setEditValue(node!.title);
    onStartEdit(nodeId);
  }

  function commitEdit() {
    if (editValue.trim()) {
      onRename(nodeId, editValue.trim());
    }
    onEndEdit();
  }

  function handleClick() {
    onFocus(nodeId);
    if (isFolder) {
      onToggleFolder(nodeId);
    } else {
      onSelect(nodeId);
    }
  }

  // ── ドラッグ開始 ──
  function handleDragStart(e: React.DragEvent) {
    currentDragId = nodeId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", nodeId);
    if (rowRef.current) {
      e.dataTransfer.setDragImage(rowRef.current, 0, 0);
    }
  }

  function handleDragEnd() {
    currentDragId = null;
    setDropPos(null);
  }

  // ── ドロップ先判定 ──
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const dragId = currentDragId;
    if (!dragId || dragId === nodeId) { setDropPos(null); return; }
    if (isDescendant(tree, dragId, nodeId)) { setDropPos(null); return; }

    e.dataTransfer.dropEffect = "move";

    const rect = rowRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = e.clientY - rect.top;
    const h = rect.height;

    if (y < h * 0.25) setDropPos("before");
    else if (y > h * 0.75) setDropPos("after");
    else setDropPos("inside");
  }

  function handleDragLeave(e: React.DragEvent) {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    setDropPos(null);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onFocus(nodeId);
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  const addFolderFn = onAddFolder;
  const duplicateFn = onDuplicate;
  const copyFn = onCopy;
  const cutFn = onCut;
  const pasteFn = onPaste;
  const menuItems: ContextMenuItem[] = [
    {
      label: "ページ追加",
      icon: <FilePlus size={13} />,
      shortcut: "Alt+N",
      onClick: () => {
        onAddChild(nodeId);
        if (isFolder && !openFolders.has(nodeId)) onToggleFolder(nodeId);
      },
    },
    ...(addFolderFn
      ? [{
          label: "フォルダ追加",
          icon: <FolderPlus size={13} />,
          shortcut: "Alt+⇧+N",
          onClick: () => {
            addFolderFn(nodeId);
            if (isFolder && !openFolders.has(nodeId)) onToggleFolder(nodeId);
          },
        }]
      : []),
    ...(duplicateFn
      ? [{
          label: "複製",
          icon: <Copy size={13} />,
          separatorBefore: true,
          onClick: () => duplicateFn(nodeId),
        }]
      : []),
    ...(copyFn
      ? [{
          label: "コピー",
          icon: <Copy size={13} />,
          shortcut: "Ctrl+C",
          onClick: () => copyFn(nodeId),
        }]
      : []),
    ...(cutFn
      ? [{
          label: "切り取り",
          icon: <Scissors size={13} />,
          shortcut: "Ctrl+X",
          onClick: () => cutFn(nodeId),
        }]
      : []),
    ...(pasteFn && hasClipboard
      ? [{
          label: "貼り付け",
          icon: <ClipboardPaste size={13} />,
          shortcut: "Ctrl+V",
          onClick: () => pasteFn(nodeId),
        }]
      : []),
    {
      label: "名前の変更",
      icon: <Pencil size={13} />,
      shortcut: "F2",
      separatorBefore: true,
      onClick: () => startEdit(),
    },
    {
      label: "削除",
      icon: <Trash2 size={13} />,
      shortcut: "Del",
      danger: true,
      onClick: () => onDelete(nodeId),
    },
  ];

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const dragId = currentDragId;
    if (!dragId || !dropPos || dragId === nodeId) { resetDrop(); return; }
    if (isDescendant(tree, dragId, nodeId)) { resetDrop(); return; }

    onMove(dragId, nodeId, dropPos);
    if (dropPos === "inside" && isFolder) onToggleFolder(nodeId);

    setDropPos(null);
    currentDragId = null;
  }

  const NodeIcon = isFolder
    ? (open && hasChildren ? FolderOpen : Folder)
    : FileText;

  const dropIndicatorClass =
    dropPos === "before" ? "ring-t-indicator" :
    dropPos === "after" ? "ring-b-indicator" :
    dropPos === "inside" ? "ring-inside-indicator" : "";

  // フォーカスリング（キーボード操作用）
  const focusRingClass = isFocused ? "outline outline-2 outline-blue-400 -outline-offset-2" : "";
  // カット中（Ctrl+X 後 Ctrl+V 待ち）は半透明表示
  const cutClass = cutId === nodeId ? "opacity-50" : "";

  return (
    <div>
      <div
        ref={rowRef}
        className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm cursor-pointer select-none relative ${
          isSelected && !isFolder
            ? "bg-gray-200 text-gray-900"
            : "text-gray-700 hover:bg-gray-100"
        } ${dropIndicatorClass} ${focusRingClass} ${cutClass}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        draggable={!editing}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
        onDoubleClick={startEdit}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}
      >
        {/* 展開トグル */}
        <span
          className={`shrink-0 transition-transform ${open && hasChildren ? "rotate-90" : ""} ${hasChildren || isFolder ? "opacity-60" : "opacity-0 pointer-events-none"}`}
          onClick={(e) => { e.stopPropagation(); if (isFolder || hasChildren) onToggleFolder(nodeId); }}
        >
          <ChevronRight size={14} />
        </span>

        <NodeIcon size={14} className={`shrink-0 ${isFolder ? "opacity-70 text-yellow-600" : "opacity-50"}`} />

        {/* タイトル */}
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") onEndEdit();
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
            {onAddFolder && (
              <button
                title="フォルダを追加"
                onClick={(e) => { e.stopPropagation(); onAddFolder(nodeId); }}
                className="rounded p-0.5 hover:bg-gray-300 text-gray-500"
              >
                <Folder size={13} />
              </button>
            )}
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

      {menuPos && (
        <ContextMenu
          x={menuPos.x}
          y={menuPos.y}
          items={menuItems}
          onClose={() => setMenuPos(null)}
        />
      )}

      {/* 子ページ */}
      {open && hasChildren && node.children.map((childId) => (
        <PageTreeItem
          key={childId}
          nodeId={childId}
          tree={tree}
          selectedId={selectedId}
          focusedId={focusedId}
          depth={depth + 1}
          openFolders={openFolders}
          editingId={editingId}
          cutId={cutId}
          hasClipboard={hasClipboard}
          onSelect={onSelect}
          onFocus={onFocus}
          onToggleFolder={onToggleFolder}
          onAddChild={onAddChild}
          onAddFolder={onAddFolder}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
          onDuplicate={onDuplicate}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
        />
      ))}
    </div>
  );
}
