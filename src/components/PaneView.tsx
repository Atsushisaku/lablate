"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Pane, PageTree } from "@/lib/storage";
import TabBar, { TabDragPayload } from "./TabBar";
import { ChartConfig } from "./blocks/ChartRenderer";

const WorklogEditor = dynamic(() => import("./WorklogEditor"), { ssr: false });
const SpreadsheetTab = dynamic(() => import("./SpreadsheetTab"), { ssr: false });

interface Props {
  pane: Pane;
  isActive: boolean;
  onActivate: () => void;
  showSidebarToggle?: boolean;
  onToggleSidebar?: () => void;
  showSplitButton?: boolean;
  onSplit?: () => void;
  canCloseTab?: (tabId: string) => boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (from: TabDragPayload, toPaneId: string, beforeTabId: string | null) => void;
  tree: PageTree;
  onRename: (pageId: string, title: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorReady: (pageId: string, editor: any) => void;
  onInsertChartToDocument: (datasetId: string, chartConfig?: ChartConfig) => void;
  style?: React.CSSProperties;
}

export default function PaneView({
  pane,
  isActive,
  onActivate,
  showSidebarToggle,
  onToggleSidebar,
  showSplitButton,
  onSplit,
  canCloseTab,
  onSelectTab,
  onCloseTab,
  onMoveTab,
  tree,
  onRename,
  onEditorReady,
  onInsertChartToDocument,
  style,
}: Props) {
  const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
  const activeDocPageId = activeTab?.type === "document" ? activeTab.pageId : null;

  // エディタの再マウント遅延（flushSync 競合回避）
  const [editorPageId, setEditorPageId] = useState<string | null>(null);
  const editorDefer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(editorDefer.current);
    if (activeDocPageId) {
      setEditorPageId(null);
      editorDefer.current = setTimeout(() => {
        setEditorPageId(activeDocPageId);
      }, 0);
    } else {
      setEditorPageId(null);
    }
    return () => clearTimeout(editorDefer.current);
  }, [activeDocPageId]);

  const selectedPage = activeDocPageId ? tree[activeDocPageId] : null;

  return (
    <div
      className={`flex flex-col overflow-hidden ${isActive ? "" : ""}`}
      style={style}
      onMouseDown={() => { if (!isActive) onActivate(); }}
    >
      <TabBar
        paneId={pane.id}
        tabs={pane.tabs}
        activeTabId={pane.activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        canCloseTab={canCloseTab}
        showSidebarToggle={showSidebarToggle}
        onToggleSidebar={onToggleSidebar}
        showSplitButton={showSplitButton}
        onSplit={onSplit}
        onMoveTab={onMoveTab}
      />

      {editorPageId && selectedPage && (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8">
            <input
              key={editorPageId}
              defaultValue={(selectedPage.title === "新規ページ" || selectedPage.title === "無題のページ") ? "" : selectedPage.title}
              placeholder="新規ページ"
              onChange={(e) => onRename(editorPageId, e.target.value || "新規ページ")}
              className="w-full font-bold placeholder-gray-300 outline-none mb-4 bg-transparent pl-[48px]"
              style={{ fontSize: "3.6rem", color: "#1a1a1a", fontWeight: 600 }}
            />
            <WorklogEditor
              key={`editor-${editorPageId}`}
              pageId={editorPageId}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onEditorReady={(ed: any) => onEditorReady(editorPageId, ed)}
            />
          </div>
        </main>
      )}

      {activeTab?.type === "spreadsheet" && activeTab.datasetId && (
        <SpreadsheetTab
          datasetId={activeTab.datasetId}
          onInsertChartToDocument={onInsertChartToDocument}
        />
      )}
    </div>
  );
}
