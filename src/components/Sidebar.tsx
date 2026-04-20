"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { FilePlus, FolderPlus, FolderOpen, FolderSync, Unplug, Download, Upload, Trash2, RotateCcw, ChevronRight, FileText, Folder, Table2 } from "lucide-react";
import { PageTree, ROOT_ID, findParent, TrashItem, DatasetTrashItem } from "@/lib/storage";
import PageTreeItem from "./PageTreeItem";
import ContextMenu, { ContextMenuItem } from "./ContextMenu";
import SidebarAuth from "./SidebarAuth";
import { useSyncContext } from "@/lib/storage/sync-context";

interface Props {
  tree: PageTree;
  selectedId: string;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddFolder: (parentId: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onMove: (dragId: string, targetId: string, position: "before" | "after" | "inside") => void;
  onDuplicate: (id: string) => void;
  onCopy: (id: string) => void;
  onCut: (id: string) => void;
  onPaste: (targetId: string) => void;
  hasClipboard: boolean;
  cutId: string | null;
  trash: TrashItem[];
  onRestore: (trashItemId: string) => void;
  onPermanentDelete: (trashItemId: string) => void;
  onEmptyTrash: () => void;
  datasetTrash: DatasetTrashItem[];
  onRestoreDataset: (trashEntryId: string) => void;
  onPermanentDeleteDataset: (trashEntryId: string) => void;
  onEmptyDatasetTrash: () => void;
}

/** ツリーを深さ優先で走査し、表示中（展開済み）のノード ID を返す */
function getVisibleIds(tree: PageTree, openFolders: Set<string>): string[] {
  const result: string[] = [];
  function walk(nodeId: string) {
    const node = tree[nodeId];
    if (!node) return;
    if (nodeId !== ROOT_ID) result.push(nodeId);
    const isFolder = node.type === "folder";
    const hasChildren = node.children.length > 0;
    // root は常に展開、フォルダ/子持ちページは openFolders に含まれていれば展開
    const isOpen = nodeId === ROOT_ID || ((isFolder || hasChildren) ? openFolders.has(nodeId) : true);
    if (isOpen && node.children.length > 0) {
      for (const childId of node.children) walk(childId);
    }
  }
  walk(ROOT_ID);
  return result;
}

export default function Sidebar({
  tree,
  selectedId,
  onSelect,
  onAddChild,
  onAddFolder,
  onRename,
  onDelete,
  onMove,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  hasClipboard,
  cutId,
  trash,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  datasetTrash,
  onRestoreDataset,
  onPermanentDeleteDataset,
  onEmptyDatasetTrash,
}: Props) {
  const root = tree[ROOT_ID];
  const { isSupported, isConnected, needsReconnect, folderName, connect, reconnectExisting, disconnect, exportZip, importZip } = useSyncContext();
  const importRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  // フォルダの開閉状態（初期値は全展開）
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [id, node] of Object.entries(tree)) {
      if (node.type === "folder" || node.children.length > 0) s.add(id);
    }
    return s;
  });

  // キーボードフォーカス用の ID（selectedId と独立）
  const [focusedId, setFocusedId] = useState<string>(selectedId);
  // リネームをトリガするための ID
  const [editingId, setEditingId] = useState<string | null>(null);
  // 空白部分の右クリックメニュー位置
  const [rootMenuPos, setRootMenuPos] = useState<{ x: number; y: number } | null>(null);

  // リネーム終了時に nav にフォーカスを戻す
  const endEdit = useCallback(() => {
    setEditingId(null);
    // 次の描画でフォーカスを戻す
    requestAnimationFrame(() => navRef.current?.focus());
  }, []);

  // selectedId が変わったらフォーカスを追従
  useEffect(() => {
    setFocusedId(selectedId);
  }, [selectedId]);

  const toggleFolder = useCallback((id: string) => {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const openFolder = useCallback((id: string) => {
    setOpenFolders((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const closeFolder = useCallback((id: string) => {
    setOpenFolders((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ── キーボードハンドラ ──
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // リネーム中は無視
    if (editingId) return;

    const visible = getVisibleIds(tree, openFolders);
    const idx = visible.indexOf(focusedId);
    const node = tree[focusedId];
    if (!node) return;
    const isFolder = node.type === "folder";
    const isFolderOpen = openFolders.has(focusedId);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (idx < visible.length - 1) setFocusedId(visible[idx + 1]);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (idx > 0) setFocusedId(visible[idx - 1]);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const hasChildren = node.children.length > 0;
        const isOpen = isFolder ? isFolderOpen : openFolders.has(focusedId);
        if (hasChildren && !isOpen) {
          openFolder(focusedId);
        } else if (hasChildren && isOpen) {
          setFocusedId(node.children[0]);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const hasChildren_l = node.children.length > 0;
        const isOpen_l = isFolder ? isFolderOpen : openFolders.has(focusedId);
        if (hasChildren_l && isOpen_l) {
          closeFolder(focusedId);
        } else {
          // 親に移動
          const parentId = findParent(tree, focusedId);
          if (parentId && parentId !== ROOT_ID) setFocusedId(parentId);
        }
        break;
      }
      case "Enter": {
        e.preventDefault();
        if (isFolder) {
          toggleFolder(focusedId);
        } else {
          onSelect(focusedId);
        }
        break;
      }
      case "F2": {
        e.preventDefault();
        setEditingId(focusedId);
        break;
      }
      case "Delete": {
        e.preventDefault();
        // 次のフォーカス先を先に決定
        const nextFocus = visible[idx + 1] ?? visible[idx - 1] ?? "";
        onDelete(focusedId);
        if (nextFocus) setFocusedId(nextFocus);
        break;
      }
      case "n":
      case "N": {
        // Ctrl+N / Ctrl+Shift+N はブラウザに予約されているため使用不可。Alt+N / Alt+Shift+N を採用
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const parentId = isFolder ? focusedId : (findParent(tree, focusedId) ?? ROOT_ID);
          if (e.shiftKey) {
            onAddFolder(parentId);
          } else {
            onAddChild(parentId);
          }
        }
        break;
      }
      case "c":
      case "C": {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onCopy(focusedId);
        }
        break;
      }
      case "x":
      case "X": {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onCut(focusedId);
        }
        break;
      }
      case "v":
      case "V": {
        if ((e.ctrlKey || e.metaKey) && hasClipboard) {
          e.preventDefault();
          onPaste(focusedId);
        }
        break;
      }
      default:
        return; // 他のキーはブラウザに任せる
    }
  }, [tree, openFolders, focusedId, editingId, onSelect, onDelete, onAddChild, onAddFolder, toggleFolder, openFolder, closeFolder, onCopy, onCut, onPaste, hasClipboard]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importZip(file);
    if (result.success) {
      window.location.reload();
    }
    if (importRef.current) importRef.current.value = "";
  };

  return (
    <aside className="flex h-full flex-col bg-gray-50 border-r border-gray-200">
      {/* ── 認証エリア（最上段） ── */}
      <SidebarAuth />

      {/* ── ヘッダー ── */}
      <div className="flex items-center justify-between px-3 pt-2 pb-2 border-t border-gray-200">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          ページ
        </span>
        <span className="flex items-center gap-0.5">
          <button
            onClick={() => onAddFolder(ROOT_ID)}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            title="新規フォルダ (Alt+Shift+N)"
          >
            <FolderPlus size={15} />
          </button>
          <button
            onClick={() => onAddChild(ROOT_ID)}
            className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
            title="新規ページ (Alt+N)"
          >
            <FilePlus size={15} />
          </button>
        </span>
      </div>

      <nav
        ref={navRef}
        className="flex-1 overflow-y-auto px-2 pb-2 outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          // 子アイテム側で preventDefault されていなければ（＝空白上の右クリック）ここで処理
          if (e.defaultPrevented) return;
          e.preventDefault();
          setRootMenuPos({ x: e.clientX, y: e.clientY });
        }}
      >
        {root?.children.map((childId) => (
          <PageTreeItem
            key={childId}
            nodeId={childId}
            tree={tree}
            selectedId={selectedId}
            focusedId={focusedId}
            depth={0}
            openFolders={openFolders}
            editingId={editingId}
            cutId={cutId}
            hasClipboard={hasClipboard}
            onSelect={onSelect}
            onFocus={setFocusedId}
            onToggleFolder={toggleFolder}
            onAddChild={onAddChild}
            onAddFolder={onAddFolder}
            onRename={onRename}
            onDelete={onDelete}
            onMove={onMove}
            onDuplicate={onDuplicate}
            onCopy={onCopy}
            onCut={onCut}
            onPaste={onPaste}
            onStartEdit={setEditingId}
            onEndEdit={endEdit}
          />
        ))}
      </nav>

      {rootMenuPos && (
        <ContextMenu
          x={rootMenuPos.x}
          y={rootMenuPos.y}
          items={[
            {
              label: "ページ追加",
              icon: <FilePlus size={13} />,
              shortcut: "Alt+N",
              onClick: () => onAddChild(ROOT_ID),
            },
            {
              label: "フォルダ追加",
              icon: <FolderPlus size={13} />,
              shortcut: "Alt+⇧+N",
              onClick: () => onAddFolder(ROOT_ID),
            },
          ] satisfies ContextMenuItem[]}
          onClose={() => setRootMenuPos(null)}
        />
      )}

      {/* ── ゴミ箱（ページ + データセット） ── */}
      <div className="border-t border-gray-200 px-2 py-1">
        <button
          onClick={() => setTrashOpen((v) => !v)}
          className="flex items-center gap-1.5 w-full text-xs text-gray-400 hover:text-gray-600 px-1 py-1 rounded hover:bg-gray-100 transition-colors"
        >
          <ChevronRight size={12} className={`transition-transform ${trashOpen ? "rotate-90" : ""}`} />
          <Trash2 size={13} />
          <span>ゴミ箱</span>
          {(trash.length + datasetTrash.length) > 0 && (
            <span className="ml-auto text-[10px] bg-gray-200 text-gray-500 rounded-full px-1.5 leading-4">{trash.length + datasetTrash.length}</span>
          )}
        </button>

        {trashOpen && (
          <div className="mt-1">
            {(trash.length + datasetTrash.length) === 0 ? (
              <div className="text-[11px] text-gray-300 px-2 py-2 text-center">ゴミ箱は空です</div>
            ) : (
              <>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {trash.map((item) => {
                    const isFolder = item.node.type === "folder";
                    const Icon = isFolder ? Folder : FileText;
                    const elapsed = Date.now() - new Date(item.deletedAt).getTime();
                    const daysAgo = Math.floor(elapsed / (1000 * 60 * 60 * 24));
                    const timeLabel = daysAgo === 0 ? "今日" : `${daysAgo}日前`;
                    return (
                      <div
                        key={`page-${item.id}`}
                        className="group flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500 hover:bg-gray-100"
                      >
                        <Icon size={12} className={`shrink-0 ${isFolder ? "text-yellow-600 opacity-50" : "opacity-40"}`} />
                        <span className="flex-1 min-w-0 truncate">{item.node.title}</span>
                        <span className="text-[10px] text-gray-300 shrink-0 group-hover:hidden">{timeLabel}</span>
                        <button
                          onClick={() => onRestore(item.id)}
                          className="hidden group-hover:inline-flex rounded p-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                          title="復元"
                        >
                          <RotateCcw size={11} />
                        </button>
                        <button
                          onClick={() => onPermanentDelete(item.id)}
                          className="hidden group-hover:inline-flex rounded p-0.5 hover:bg-red-100 text-gray-400 hover:text-red-500"
                          title="完全に削除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                  {datasetTrash.map((item) => {
                    const elapsed = Date.now() - new Date(item.deletedAt).getTime();
                    const daysAgo = Math.floor(elapsed / (1000 * 60 * 60 * 24));
                    const timeLabel = daysAgo === 0 ? "今日" : `${daysAgo}日前`;
                    return (
                      <div
                        key={`ds-${item.id}`}
                        className="group flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500 hover:bg-gray-100"
                      >
                        <Table2 size={12} className="shrink-0 text-green-600 opacity-50" />
                        <span className="flex-1 min-w-0 truncate">{item.meta.name || "データセット"}</span>
                        <span className="text-[10px] text-gray-300 shrink-0 group-hover:hidden">{timeLabel}</span>
                        <button
                          onClick={() => onRestoreDataset(item.id)}
                          className="hidden group-hover:inline-flex rounded p-0.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600"
                          title="復元"
                        >
                          <RotateCcw size={11} />
                        </button>
                        <button
                          onClick={() => onPermanentDeleteDataset(item.id)}
                          className="hidden group-hover:inline-flex rounded p-0.5 hover:bg-red-100 text-gray-400 hover:text-red-500"
                          title="完全に削除"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 px-1">
                  {confirmEmpty ? (
                    <div className="flex items-center gap-1 text-[11px]">
                      <span className="text-red-500">全て完全に削除しますか？</span>
                      <button
                        onClick={() => { onEmptyTrash(); onEmptyDatasetTrash(); setConfirmEmpty(false); }}
                        className="text-red-600 hover:text-red-800 font-medium px-1"
                      >
                        削除
                      </button>
                      <button
                        onClick={() => setConfirmEmpty(false)}
                        className="text-gray-400 hover:text-gray-600 px-1"
                      >
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmEmpty(true)}
                      className="text-[11px] text-gray-400 hover:text-red-500 px-1 py-0.5"
                    >
                      ゴミ箱を空にする
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── ストレージ操作 ── */}
      <div className="border-t border-gray-200 px-3 py-2 space-y-1.5">
        {isSupported && (
          isConnected ? (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <FolderSync size={13} className="text-green-500 shrink-0" />
              <span className="truncate flex-1" title={folderName ?? ""}>{folderName}</span>
              <button
                onClick={disconnect}
                className="rounded p-0.5 text-gray-400 hover:text-red-500 hover:bg-gray-200 transition-colors"
                title="切断"
              >
                <Unplug size={12} />
              </button>
            </div>
          ) : needsReconnect ? (
            <button
              onClick={reconnectExisting}
              className="flex items-center gap-1.5 w-full text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 rounded px-1.5 py-1 transition-colors"
              title="クリックでフォルダへの権限を再取得"
            >
              <FolderSync size={13} className="shrink-0 text-amber-500" />
              <span className="truncate flex-1 text-left" title={folderName ?? ""}>再接続: {folderName}</span>
            </button>
          ) : (
            <button
              onClick={connect}
              className="flex items-center gap-1.5 w-full text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded px-1.5 py-1 transition-colors"
            >
              <FolderOpen size={13} />
              保存先フォルダを選択
            </button>
          )
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={exportZip}
            className="flex items-center justify-center gap-1 flex-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded px-1.5 py-1 transition-colors whitespace-nowrap"
            title="ZIPエクスポート"
          >
            <Upload size={13} className="shrink-0" /> エクスポート
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="flex items-center justify-center gap-1 flex-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded px-1.5 py-1 transition-colors whitespace-nowrap"
            title="ZIPインポート"
          >
            <Download size={13} className="shrink-0" /> インポート
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".zip"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </div>
    </aside>
  );
}
