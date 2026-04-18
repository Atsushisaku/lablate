"use client";

import { useState } from "react";
import { FileText, Table2, X, PanelLeft, SplitSquareHorizontal } from "lucide-react";
import { Tab } from "@/lib/storage";

/** タブドラッグ用の DataTransfer MIME */
export const TAB_DRAG_MIME = "application/x-lablate-tab";

export interface TabDragPayload {
  paneId: string;
  tabId: string;
}

interface TabBarProps {
  paneId: string;
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  canCloseTab?: (tabId: string) => boolean;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  showSplitButton?: boolean;
  onSplit?: () => void;
  /** 他ペインからのタブ移動 or 同ペイン内の並び替え */
  onMoveTab?: (from: TabDragPayload, toPaneId: string, beforeTabId: string | null) => void;
}

function readDragPayload(e: React.DragEvent): TabDragPayload | null {
  try {
    const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TabDragPayload;
    if (parsed.paneId && parsed.tabId) return parsed;
    return null;
  } catch {
    return null;
  }
}

export default function TabBar({
  paneId,
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  canCloseTab,
  showSidebarToggle,
  onToggleSidebar,
  showSplitButton,
  onSplit,
  onMoveTab,
}: TabBarProps) {
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dragOverEnd, setDragOverEnd] = useState(false);

  const handleTabDragStart = (e: React.DragEvent, tabId: string) => {
    const payload: TabDragPayload = { paneId, tabId };
    e.dataTransfer.setData(TAB_DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleTabDragOver = (e: React.DragEvent, tabId: string) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
    setDragOverEnd(false);
  };

  const handleTabDrop = (e: React.DragEvent, targetTabId: string) => {
    const payload = readDragPayload(e);
    setDragOverTabId(null);
    setDragOverEnd(false);
    if (!payload || !onMoveTab) return;
    e.preventDefault();
    e.stopPropagation();
    onMoveTab(payload, paneId, targetTabId);
  };

  const handleBarDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // タブの上ではない領域（バーの末尾など）にいる場合
    if (!dragOverTabId) setDragOverEnd(true);
  };

  const handleBarDrop = (e: React.DragEvent) => {
    const payload = readDragPayload(e);
    setDragOverTabId(null);
    setDragOverEnd(false);
    if (!payload || !onMoveTab) return;
    e.preventDefault();
    onMoveTab(payload, paneId, null); // 末尾へ追加
  };

  const handleBarDragLeave = (e: React.DragEvent) => {
    // 子要素間の遷移を無視
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setDragOverTabId(null);
    setDragOverEnd(false);
  };

  return (
    <div
      className="flex items-center border-b border-gray-200 bg-white shrink-0 overflow-x-auto"
      onDragOver={handleBarDragOver}
      onDrop={handleBarDrop}
      onDragLeave={handleBarDragLeave}
    >
      {showSidebarToggle && (
        <button
          onClick={onToggleSidebar}
          title="サイドバーを開閉"
          className="shrink-0 p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded ml-1"
        >
          <PanelLeft size={15} />
        </button>
      )}

      <div className="flex items-center flex-1 min-w-0 overflow-x-auto px-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isDoc = tab.type === "document";
          const isDragOver = dragOverTabId === tab.id;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleTabDragStart(e, tab.id)}
              onDragOver={(e) => handleTabDragOver(e, tab.id)}
              onDragLeave={() => setDragOverTabId((id) => (id === tab.id ? null : id))}
              onDrop={(e) => handleTabDrop(e, tab.id)}
              onClick={() => onSelectTab(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-b-2 shrink-0 transition-colors select-none ${
                isActive
                  ? "border-blue-500 text-gray-900 bg-blue-50/40"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {isDragOver && (
                <span className="absolute inset-y-0 left-0 w-0.5 bg-blue-500" aria-hidden />
              )}
              {isDoc ? <FileText size={12} /> : <Table2 size={12} />}
              <span className="max-w-[160px] truncate">{tab.label}</span>
              {(!canCloseTab || canCloseTab(tab.id)) && (
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  className="ml-1 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                >
                  <X size={10} />
                </span>
              )}
            </div>
          );
        })}
        {dragOverEnd && (
          <span className="w-0.5 h-4 bg-blue-500 shrink-0" aria-hidden />
        )}
      </div>

      {showSplitButton && (
        <button
          onClick={onSplit}
          title="右側に分割"
          className="shrink-0 p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded mr-1"
        >
          <SplitSquareHorizontal size={14} />
        </button>
      )}
    </div>
  );
}
