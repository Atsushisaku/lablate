"use client";

import { useRef } from "react";
import { FilePlus, FolderOpen, FolderSync, Unplug, Download, Upload } from "lucide-react";
import { PageTree, ROOT_ID } from "@/lib/storage";
import PageTreeItem from "./PageTreeItem";
import { useSyncContext } from "@/lib/storage/sync-context";

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
  const { isSupported, isConnected, folderName, connect, disconnect, exportZip, importZip } = useSyncContext();
  const importRef = useRef<HTMLInputElement>(null);

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

      {/* ── ストレージ操作 ── */}
      <div className="border-t border-gray-200 px-3 py-2 space-y-1.5">
        {/* フォルダ接続 */}
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

        {/* エクスポート / インポート */}
        <div className="flex items-center gap-1">
          <button
            onClick={exportZip}
            className="flex items-center gap-1 flex-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded px-1.5 py-1 transition-colors"
            title="ZIPエクスポート"
          >
            <Download size={13} /> エクスポート
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="flex items-center gap-1 flex-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded px-1.5 py-1 transition-colors"
            title="ZIPインポート"
          >
            <Upload size={13} /> インポート
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
