"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useRef } from "react";
import { PanelLeft, Loader2 } from "lucide-react";
import { useSyncContext } from "@/lib/storage/sync-context";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import {
  loadTree,
  saveTree,
  deletePageRecursive,
  ROOT_ID,
  PageTree,
  createDefaultTree,
  Tab,
  TabState,
  loadTabState,
  saveTabState,
  migrateDatasetRegistry,
  getDatasetMeta,
} from "@/lib/storage";

const WorklogEditor = dynamic(() => import("./WorklogEditor"), { ssr: false });
const SpreadsheetTab = dynamic(() => import("./SpreadsheetTab"), { ssr: false });

function getFirstPage(tree: PageTree): string {
  return tree[ROOT_ID]?.children[0] ?? ROOT_ID;
}

/** ページ用ドキュメントタブを生成 */
function makeDocTab(pageId: string, title: string): Tab {
  return { id: `doc-${pageId}`, type: "document", label: title || "無題のページ", pageId };
}

export default function WorklogPage() {
  const [mounted, setMounted] = useState(false);
  const [tree, setTree] = useState<PageTree>(createDefaultTree);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabState, setTabState] = useState<TabState>({ tabs: [], activeTabId: "" });
  const { isConnected, status: syncStatus, notifyChange } = useSyncContext();

  // BlockNote エディタへの参照（「md に挿入」用）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  // ── タブ状態の永続化 ──
  const persistTabs = useCallback((state: TabState) => {
    setTabState(state);
    saveTabState(state);
  }, []);

  // ── 初期化 ──
  useEffect(() => {
    const t = loadTree();
    setTree(t);
    const firstPage = getFirstPage(t);
    setSelectedId(firstPage);

    // データセットレジストリのマイグレーション
    migrateDatasetRegistry();

    // タブ状態の復元 or 初期作成
    const saved = loadTabState();
    if (saved && saved.tabs.length > 0) {
      // 保存済みタブがあればそれを使い、選択ページのドキュメントタブをアクティブに
      const docTabId = `doc-${firstPage}`;
      const hasDocTab = saved.tabs.some((t) => t.id === docTabId);
      if (!hasDocTab) {
        const pageTitle = t[firstPage]?.title ?? "無題のページ";
        saved.tabs.unshift(makeDocTab(firstPage, pageTitle));
      }
      saved.activeTabId = docTabId;
      persistTabs(saved);
    } else {
      const pageTitle = t[firstPage]?.title ?? "無題のページ";
      persistTabs({
        tabs: [makeDocTab(firstPage, pageTitle)],
        activeTabId: `doc-${firstPage}`,
      });
    }

    setMounted(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ツリー更新 ──
  const updateTree = useCallback((next: PageTree) => {
    setTree(next);
    saveTree(next);
    notifyChange("lablate_tree");
  }, [notifyChange]);

  // ── ページ選択（サイドバーから） ──
  const handleSelectPage = useCallback((pageId: string) => {
    setSelectedId(pageId);
    setTabState((prev) => {
      const docTabId = `doc-${pageId}`;
      let tabs = [...prev.tabs];
      if (!tabs.some((t) => t.id === docTabId)) {
        // まだ無ければドキュメントタブを追加
        // 挿入位置: 最後のドキュメントタブの直後
        const lastDocIdx = tabs.reduce((acc, t, i) => (t.type === "document" ? i : acc), -1);
        const pageTitle = tree[pageId]?.title ?? "無題のページ";
        tabs.splice(lastDocIdx + 1, 0, makeDocTab(pageId, pageTitle));
      }
      const next = { tabs, activeTabId: docTabId };
      saveTabState(next);
      return next;
    });
  }, [tree]);

  // ── ページ追加 ──
  const handleAddChild = useCallback((parentId: string) => {
    const newId = crypto.randomUUID();
    setTree((prev) => {
      const next = {
        ...prev,
        [parentId]: { ...prev[parentId], children: [...prev[parentId].children, newId] },
        [newId]: { id: newId, title: "無題のページ", children: [] },
      };
      saveTree(next);
      return next;
    });
    handleSelectPage(newId);
  }, [handleSelectPage]);

  // ── ページ名変更 ──
  const handleRename = useCallback((id: string, title: string) => {
    setTree((prev) => {
      const next = { ...prev, [id]: { ...prev[id], title } };
      saveTree(next);
      return next;
    });
    // タブのラベルも同期
    setTabState((prev) => {
      const tabs = prev.tabs.map((t) =>
        t.id === `doc-${id}` ? { ...t, label: title || "無題のページ" } : t
      );
      const next = { ...prev, tabs };
      saveTabState(next);
      return next;
    });
    // PageLinkBlock のタイトル更新通知
    window.dispatchEvent(new Event("lablate-tree-change"));
  }, []);

  // ── ページ削除 ──
  const handleDelete = useCallback((id: string) => {
    setTree((prev) => {
      const next = deletePageRecursive({ ...prev }, id);
      saveTree(next);
      setSelectedId((cur) => {
        if (cur === id || !next[cur]) return getFirstPage(next);
        return cur;
      });
      return next;
    });
    // 削除ページのドキュメントタブを閉じる
    setTabState((prev) => {
      const tabs = prev.tabs.filter((t) => !(t.type === "document" && t.pageId === id));
      const activeTabId = prev.activeTabId === `doc-${id}`
        ? (tabs[0]?.id ?? "")
        : prev.activeTabId;
      const next = { tabs, activeTabId };
      saveTabState(next);
      return next;
    });
  }, []);

  // ── タブ操作 ──
  const handleSelectTab = useCallback((tabId: string) => {
    const tab = tabState.tabs.find((t) => t.id === tabId);
    if (tab?.type === "document") setSelectedId(tab.pageId);
    const next = { ...tabState, activeTabId: tabId };
    saveTabState(next);
    setTabState(next);
  }, [tabState]);

  const handleCloseTab = useCallback((tabId: string) => {
    const idx = tabState.tabs.findIndex((t) => t.id === tabId);
    const tabs = tabState.tabs.filter((t) => t.id !== tabId);
    let activeTabId = tabState.activeTabId;
    if (activeTabId === tabId) {
      // 閉じたタブがアクティブなら隣のタブへ
      activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? "";
    }
    const next = { tabs, activeTabId };
    saveTabState(next);
    setTabState(next);
    // 新しいアクティブがドキュメントタブならページ選択も更新
    const newActive = tabs.find((t) => t.id === activeTabId);
    if (newActive?.type === "document") setSelectedId(newActive.pageId);
  }, [tabState]);

  // ── スプレッドシートタブを開く（CsvTableBlock からの CustomEvent） ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const datasetId: string = detail?.datasetId;
      if (!datasetId) return;

      setTabState((prev) => {
        // 既存タブがあればフォーカス
        const existing = prev.tabs.find((t) => t.type === "spreadsheet" && t.datasetId === datasetId);
        if (existing) {
          const next = { ...prev, activeTabId: existing.id };
          saveTabState(next);
          return next;
        }
        // なければ新規作成
        const meta = getDatasetMeta(datasetId);
        const newTab: Tab = {
          id: `sheet-${datasetId}`,
          type: "spreadsheet",
          label: meta?.name ?? "スプレッドシート",
          pageId: selectedId,
          datasetId,
        };
        const tabs = [...prev.tabs, newTab];
        const next = { tabs, activeTabId: newTab.id };
        saveTabState(next);
        return next;
      });
    };
    window.addEventListener("lablate-open-spreadsheet-tab", handler);
    return () => window.removeEventListener("lablate-open-spreadsheet-tab", handler);
  }, [selectedId]);

  // ── データセット名変更のタブ名同期 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { datasetId, name } = (e as CustomEvent).detail ?? {};
      if (!datasetId || !name) return;
      setTabState((prev) => {
        const tabs = prev.tabs.map((t) =>
          t.type === "spreadsheet" && t.datasetId === datasetId
            ? { ...t, label: name }
            : t
        );
        const next = { ...prev, tabs };
        saveTabState(next);
        return next;
      });
    };
    window.addEventListener("lablate-dataset-rename", handler);
    return () => window.removeEventListener("lablate-dataset-rename", handler);
  }, []);

  // ── ページリンクからのナビゲーション ──
  useEffect(() => {
    const handler = (e: Event) => {
      const targetPageId = (e as CustomEvent).detail?.pageId;
      if (targetPageId && tree[targetPageId]) {
        handleSelectPage(targetPageId);
      }
    };
    window.addEventListener("lablate-navigate-page", handler);
    return () => window.removeEventListener("lablate-navigate-page", handler);
  }, [tree, handleSelectPage]);

  // ── 「md に挿入」ハンドラ ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInsertChartToDocument = useCallback((datasetId: string, chartConfig?: any) => {
    // ドキュメントタブに切り替え
    const docTabId = `doc-${selectedId}`;
    setTabState((prev) => {
      const next = { ...prev, activeTabId: docTabId };
      saveTabState(next);
      return next;
    });

    // エディタにグラフブロックを挿入（タブ切替後にエディタが準備完了するまで待つ）
    setTimeout(() => {
      const ed = editorRef.current;
      if (!ed?.document?.length) return;
      try {
        const last = ed.document[ed.document.length - 1];
        if (last) ed.insertBlocks([{ type: "chart", props: { datasetId } }], last, "after");
        // 挿入されたブロックの設定を保存
        if (chartConfig) {
          setTimeout(() => {
            const doc = ed.document;
            for (let i = doc.length - 1; i >= 0; i--) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const b = doc[i] as any;
              if (b.type === "chart" && b.props?.datasetId === datasetId) {
                const configToSave = { ...chartConfig, collapsed: false, chartWidth: 0, chartHeight: 340 };
                localStorage.setItem(`lablate_chart_config_${b.id}`, JSON.stringify(configToSave));
                break;
              }
            }
          }, 100);
        }
      } catch { /* editor may not be ready */ }
    }, 200);
  }, [selectedId]);

  // ── アクティブタブ ──
  const activeTab = tabState.tabs.find((t) => t.id === tabState.activeTabId);
  const selectedPage = tree[selectedId];

  // ── エディタの安全な再マウント ──
  // BlockNote (TipTap ReactNodeView) は初期化時に flushSync を使うため、
  // 旧エディタの破棄と新エディタのマウントを同一レンダーで行うと
  // "Position undefined out of range" エラーが発生する。
  // unmount → 次ティックで mount とすることで回避する。
  const activeDocPageId = activeTab?.type === "document" ? activeTab.pageId : null;
  const [editorPageId, setEditorPageId] = useState<string | null>(null);
  const editorDefer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(editorDefer.current);
    if (activeDocPageId) {
      setEditorPageId(null);                        // 旧エディタを即 unmount
      editorDefer.current = setTimeout(() => {
        setEditorPageId(activeDocPageId);            // 新エディタを次ティックで mount
      }, 0);
    } else {
      setEditorPageId(null);
    }
    return () => clearTimeout(editorDefer.current);
  }, [activeDocPageId]);

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* サイドバー */}
      {sidebarOpen && (
        <div className="w-56 shrink-0 h-full">
          <Sidebar
            tree={tree}
            selectedId={selectedId}
            onSelect={handleSelectPage}
            onAddChild={handleAddChild}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* メインエリア */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ヘッダー */}
        <header className="flex items-center gap-2 border-b border-gray-200 bg-white/90 backdrop-blur-sm px-3 py-2 shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
            title="サイドバーを開閉"
          >
            <PanelLeft size={18} />
          </button>
          <div className="flex-1" />
          {/* 同期ステータス */}
          <div className="flex items-center gap-1.5 text-xs text-gray-400" title={
            isConnected
              ? syncStatus === "saving" ? "保存中..." : syncStatus === "loading" ? "読み込み中..." : "フォルダ同期中"
              : "ローカルのみ"
          }>
            {isConnected ? (
              syncStatus === "saving" || syncStatus === "loading" ? (
                <Loader2 size={13} className="animate-spin text-blue-500" />
              ) : (
                <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
              )
            ) : (
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
            )}
            <span>{isConnected ? "同期中" : "ローカル"}</span>
          </div>
        </header>

        {/* タブバー */}
        <TabBar
          tabs={tabState.tabs}
          activeTabId={tabState.activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          canCloseTab={(tabId) => {
            const tab = tabState.tabs.find((t) => t.id === tabId);
            if (tab?.type !== "document") return true;
            // ドキュメントタブが1つだけの場合は閉じない
            return tabState.tabs.filter((t) => t.type === "document").length > 1;
          }}
        />

        {/* タブコンテンツ */}
        {editorPageId && selectedPage && (
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-8">
              <input
                key={editorPageId}
                defaultValue={selectedPage.title === "無題のページ" ? "" : selectedPage.title}
                placeholder="無題のページ"
                onChange={(e) => handleRename(editorPageId, e.target.value || "無題のページ")}
                className="w-full font-bold placeholder-gray-300 outline-none mb-4 bg-transparent"
                style={{ fontSize: "2.5rem", color: "#1a1a1a", fontWeight: 700 }}
              />
              <WorklogEditor
                key={`editor-${editorPageId}`}
                pageId={editorPageId}
                onEditorReady={(ed: any) => { editorRef.current = ed; }} // eslint-disable-line @typescript-eslint/no-explicit-any
              />
            </div>
          </main>
        )}

        {activeTab?.type === "spreadsheet" && activeTab.datasetId && (
          <SpreadsheetTab
            datasetId={activeTab.datasetId}
            onInsertChartToDocument={handleInsertChartToDocument}
          />
        )}
      </div>
    </div>
  );
}
