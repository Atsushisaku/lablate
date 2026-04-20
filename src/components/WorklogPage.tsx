"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import PaneView from "./PaneView";
import { TabDragPayload } from "./TabBar";
import {
  loadTree,
  saveTree,
  moveNode,
  findParent,
  cloneSubtree,
  uniqueSiblingTitle,
  ROOT_ID,
  PageTree,
  createDefaultTree,
  Tab,
  Pane,
  TabState,
  loadTabState,
  saveTabState,
  migrateDatasetRegistry,
  cleanupOrphanedDatasets,
  getDatasetMeta,
  trashPage,
  restorePage,
  permanentlyDeleteTrashItem,
  emptyTrash,
  loadTrash,
  TrashItem,
  isDescendant,
  DatasetTrashItem,
  loadDatasetTrash,
  restoreDatasetFromTrash,
  permanentlyDeleteTrashedDataset,
  emptyDatasetTrash,
  loadDoc,
  saveDoc,
} from "@/lib/storage";
import { useSyncContext } from "@/lib/storage/sync-context";
import { ChartConfig } from "./blocks/ChartRenderer";

function getFirstPage(tree: PageTree): string {
  return tree[ROOT_ID]?.children[0] ?? ROOT_ID;
}

function makeDocTab(pageId: string, title: string): Tab {
  return { id: `doc-${pageId}`, type: "document", label: title || "新規ページ", pageId };
}

/** 全ペインから指定タブを探す */
function locateTab(panes: Pane[], tabId: string): { pane: Pane; tab: Tab } | null {
  for (const pane of panes) {
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (tab) return { pane, tab };
  }
  return null;
}

function countDocTabs(panes: Pane[]): number {
  return panes.reduce((sum, p) => sum + p.tabs.filter((t) => t.type === "document").length, 0);
}

const PANE_SPLIT_KEY = "lablate_pane_split";

export default function WorklogPage() {
  const [mounted, setMounted] = useState(false);
  const [tree, setTree] = useState<PageTree>(createDefaultTree);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tabState, setTabState] = useState<TabState>({ panes: [], activePaneId: "" });
  const { notifyChange } = useSyncContext();
  const [trash, setTrash] = useState<TrashItem[]>([]);
  const [datasetTrash, setDatasetTrash] = useState<DatasetTrashItem[]>([]);
  const [paneSplit, setPaneSplit] = useState(50); // 左ペインの割合
  const [clipboard, setClipboard] = useState<{ mode: "copy" | "cut"; nodeId: string } | null>(null);

  // pageId -> BlockNote editor
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRefs = useRef<Map<string, any>>(new Map());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleEditorReady = useCallback((pageId: string, ed: any) => {
    editorRefs.current.set(pageId, ed);
  }, []);

  const persistTabs = useCallback((state: TabState) => {
    setTabState(state);
    saveTabState(state);
  }, []);

  // ── 初期化 ──
  useEffect(() => {
    let t = loadTree();
    // ツリーが空なら既定ページを自動生成（全消し状態で開かれた場合の自動復旧）
    if (!t[ROOT_ID]) {
      t = createDefaultTree();
      saveTree(t);
    } else if (t[ROOT_ID].children.length === 0) {
      const newId = crypto.randomUUID();
      t = {
        ...t,
        [ROOT_ID]: { ...t[ROOT_ID], children: [newId] },
        [newId]: { id: newId, title: "新規ページ", children: [] },
      };
      saveTree(t);
    }
    setTree(t);
    const firstPage = getFirstPage(t);
    setSelectedId(firstPage);

    migrateDatasetRegistry();
    cleanupOrphanedDatasets();
    setTrash(loadTrash());
    setDatasetTrash(loadDatasetTrash());

    const savedSplit = parseInt(localStorage.getItem(PANE_SPLIT_KEY) ?? "");
    if (Number.isFinite(savedSplit) && savedSplit >= 20 && savedSplit <= 80) {
      setPaneSplit(savedSplit);
    }

    const saved = loadTabState();
    const firstDocTab = makeDocTab(firstPage, t[firstPage]?.title ?? "新規ページ");
    if (saved && saved.panes.length > 0) {
      // ドキュメントタブのラベルをツリーのタイトルと同期（既存データ「無題のページ」対策）
      saved.panes = saved.panes.map((p) => ({
        ...p,
        tabs: p.tabs.map((tab) => {
          if (tab.type !== "document") return tab;
          const title = t[tab.pageId]?.title;
          return title ? { ...tab, label: title } : tab;
        }),
      }));
      const docTabId = `doc-${firstPage}`;
      const hasDocTab = saved.panes.some((p) => p.tabs.some((tab) => tab.id === docTabId));
      if (!hasDocTab) {
        // 先頭ペインに先頭ページのドキュメントタブを追加
        const head = saved.panes[0];
        saved.panes[0] = { ...head, tabs: [firstDocTab, ...head.tabs], activeTabId: docTabId };
        saved.activePaneId = head.id;
      } else {
        // 既にあるペインをアクティブに
        const owner = saved.panes.find((p) => p.tabs.some((tab) => tab.id === docTabId));
        if (owner) {
          saved.panes = saved.panes.map((p) => p.id === owner.id ? { ...p, activeTabId: docTabId } : p);
          saved.activePaneId = owner.id;
        }
      }
      persistTabs(saved);
    } else {
      const paneId = crypto.randomUUID();
      persistTabs({
        panes: [{ id: paneId, tabs: [firstDocTab], activeTabId: firstDocTab.id }],
        activePaneId: paneId,
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
      // 既に開かれているペインがあればフォーカス
      const owner = prev.panes.find((p) => p.tabs.some((t) => t.id === docTabId));
      if (owner) {
        const next: TabState = {
          panes: prev.panes.map((p) => p.id === owner.id ? { ...p, activeTabId: docTabId } : p),
          activePaneId: owner.id,
        };
        saveTabState(next);
        return next;
      }
      // アクティブペイン（なければ先頭）に追加
      const target = prev.panes.find((p) => p.id === prev.activePaneId) ?? prev.panes[0];
      if (!target) return prev;
      const pageTitle = tree[pageId]?.title ?? "新規ページ";
      const newTab = makeDocTab(pageId, pageTitle);
      const lastDocIdx = target.tabs.reduce((acc, t, i) => (t.type === "document" ? i : acc), -1);
      const newTabs = [...target.tabs];
      newTabs.splice(lastDocIdx + 1, 0, newTab);
      const next: TabState = {
        panes: prev.panes.map((p) => p.id === target.id
          ? { ...p, tabs: newTabs, activeTabId: docTabId }
          : p),
        activePaneId: target.id,
      };
      saveTabState(next);
      return next;
    });
  }, [tree]);

  const handleAddChild = useCallback((parentId: string) => {
    const newId = crypto.randomUUID();
    setTree((prev) => {
      const title = uniqueSiblingTitle(prev, parentId, "新規ページ");
      const next = {
        ...prev,
        [parentId]: { ...prev[parentId], children: [...prev[parentId].children, newId] },
        [newId]: { id: newId, title, children: [] },
      };
      saveTree(next);
      return next;
    });
    handleSelectPage(newId);
  }, [handleSelectPage]);

  const handleAddFolder = useCallback((parentId: string) => {
    const newId = crypto.randomUUID();
    setTree((prev) => {
      const title = uniqueSiblingTitle(prev, parentId, "新しいフォルダ");
      const next = {
        ...prev,
        [parentId]: { ...prev[parentId], children: [...prev[parentId].children, newId] },
        [newId]: { id: newId, title, children: [], type: "folder" as const },
      };
      saveTree(next);
      return next;
    });
  }, []);

  const handleRename = useCallback((id: string, title: string) => {
    let appliedTitle = title;
    setTree((prev) => {
      const parentId = findParent(prev, id) ?? ROOT_ID;
      appliedTitle = uniqueSiblingTitle(prev, parentId, title, id);
      const next = { ...prev, [id]: { ...prev[id], title: appliedTitle } };
      saveTree(next);
      return next;
    });
    // タブラベルを全ペインで同期（衝突解消後のタイトルを使用）
    setTabState((prev) => {
      const panes = prev.panes.map((p) => ({
        ...p,
        tabs: p.tabs.map((t) => t.id === `doc-${id}` ? { ...t, label: appliedTitle || "新規ページ" } : t),
      }));
      const next: TabState = { ...prev, panes };
      saveTabState(next);
      return next;
    });
    window.dispatchEvent(new Event("lablate-tree-change"));
  }, []);

  const handleDelete = useCallback((id: string) => {
    let autoNewId: string | null = null;
    setTree((prev) => {
      let next = trashPage(prev, id);
      // 全ページ削除 → 既定ページを自動生成（空状態での操作を防ぐ）
      if (next[ROOT_ID] && next[ROOT_ID].children.length === 0) {
        autoNewId = crypto.randomUUID();
        next = {
          ...next,
          [ROOT_ID]: { ...next[ROOT_ID], children: [autoNewId] },
          [autoNewId]: { id: autoNewId, title: "新規ページ", children: [] },
        };
      }
      saveTree(next);
      setSelectedId((cur) => {
        if (autoNewId) return autoNewId;
        if (cur === id || !next[cur]) return getFirstPage(next);
        return cur;
      });
      setTrash(loadTrash());
      return next;
    });
    // 全ペインから該当ドキュメントタブを除去（空になったペインは削除）
    setTabState((prev) => {
      const nextPanes: Pane[] = [];
      for (const p of prev.panes) {
        const newTabs = p.tabs.filter((t) => !(t.type === "document" && t.pageId === id));
        if (newTabs.length === 0) continue;
        let newActive = p.activeTabId;
        if (newActive === `doc-${id}`) newActive = newTabs[0].id;
        nextPanes.push({ ...p, tabs: newTabs, activeTabId: newActive });
      }
      // 全ペインが消える場合は空状態を避けるため、最低1ペイン確保（空でも残す）
      if (nextPanes.length === 0 && prev.panes.length > 0) {
        nextPanes.push({ id: prev.panes[0].id, tabs: [], activeTabId: "" });
      }
      // 自動生成ページのドキュメントタブを追加しアクティブ化
      if (autoNewId) {
        const newTab = makeDocTab(autoNewId, "新規ページ");
        if (nextPanes[0]) {
          nextPanes[0] = { ...nextPanes[0], tabs: [newTab, ...nextPanes[0].tabs], activeTabId: newTab.id };
        } else {
          nextPanes.push({ id: crypto.randomUUID(), tabs: [newTab], activeTabId: newTab.id });
        }
      }
      const activePaneId = autoNewId
        ? nextPanes[0].id
        : (nextPanes.find((p) => p.id === prev.activePaneId)?.id ?? nextPanes[0]?.id ?? "");
      const next: TabState = { panes: nextPanes, activePaneId };
      saveTabState(next);
      return next;
    });
  }, []);

  const handleRestore = useCallback((trashItemId: string) => {
    const next = restorePage(trashItemId);
    setTree(next);
    setTrash(loadTrash());
    notifyChange("lablate_tree");
    window.dispatchEvent(new Event("lablate-tree-change"));
  }, [notifyChange]);

  const handlePermanentDelete = useCallback((trashItemId: string) => {
    permanentlyDeleteTrashItem(trashItemId);
    setTrash(loadTrash());
  }, []);

  const handleEmptyTrash = useCallback(() => {
    emptyTrash();
    setTrash([]);
  }, []);

  // ── データセットゴミ箱: 復元 / 完全削除 / 空にする ──
  const handleRestoreDataset = useCallback((trashEntryId: string) => {
    const item = restoreDatasetFromTrash(trashEntryId);
    if (!item) return;
    setDatasetTrash(loadDatasetTrash());

    // 再挿入先ページの決定
    const currentTree = loadTree();
    const targetPageId = (item.meta.pageId && currentTree[item.meta.pageId])
      ? item.meta.pageId
      : selectedId;
    if (!targetPageId || !currentTree[targetPageId]) return;

    // アクティブエディタがあればそこに挿入、なければ localStorage doc を直接書き換え
    const activeEditor = editorRefs.current.get(targetPageId);
    if (activeEditor?.document?.length) {
      try {
        const last = activeEditor.document[activeEditor.document.length - 1];
        if (last) activeEditor.insertBlocks([{ type: "csvTable", props: { datasetId: item.datasetId } }], last, "after");
      } catch { /* ignore */ }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (loadDoc(targetPageId) ?? []) as any[];
      doc.push({ type: "csvTable", props: { datasetId: item.datasetId } });
      saveDoc(targetPageId, doc);
      notifyChange(`lablate_doc_${targetPageId}`);
    }

    // 復元先ページをアクティブ化
    handleSelectPage(targetPageId);
  }, [selectedId, notifyChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePermanentDeleteDataset = useCallback((trashEntryId: string) => {
    permanentlyDeleteTrashedDataset(trashEntryId);
    setDatasetTrash(loadDatasetTrash());
  }, []);

  const handleEmptyDatasetTrash = useCallback(() => {
    emptyDatasetTrash();
    setDatasetTrash([]);
  }, []);

  const handleMove = useCallback((dragId: string, targetId: string, position: "before" | "after" | "inside") => {
    setTree((prev) => {
      const dragNode = prev[dragId];
      if (!dragNode) return prev;
      const newParentId = position === "inside"
        ? targetId
        : (findParent(prev, targetId) ?? ROOT_ID);
      const uniqueTitle = uniqueSiblingTitle(prev, newParentId, dragNode.title, dragId);
      let renamed: PageTree = prev;
      if (uniqueTitle !== dragNode.title) {
        renamed = { ...prev, [dragId]: { ...dragNode, title: uniqueTitle } };
      }
      const next = moveNode(renamed, dragId, targetId, position);
      if (next === prev) return prev;
      saveTree(next);
      notifyChange("lablate_tree");
      return next;
    });
  }, [notifyChange]);

  // ── 複製: 対象ノードの兄弟（直後）として複製を挿入 ──
  const duplicateIntoSibling = useCallback((tree: PageTree, sourceId: string): { tree: PageTree; newId: string } | null => {
    const node = tree[sourceId];
    if (!node || sourceId === ROOT_ID) return null;
    const parentId = findParent(tree, sourceId) ?? ROOT_ID;
    const parent = tree[parentId];
    if (!parent) return null;
    const { nodes, newRootId } = cloneSubtree(tree, sourceId);
    // 兄弟と衝突しないように新タイトルを調整
    const uniqueTitle = uniqueSiblingTitle(tree, parentId, nodes[newRootId].title);
    nodes[newRootId] = { ...nodes[newRootId], title: uniqueTitle };
    const idx = parent.children.indexOf(sourceId);
    const newChildren = [...parent.children];
    newChildren.splice(idx + 1, 0, newRootId);
    const nextTree: PageTree = {
      ...tree,
      ...nodes,
      [parentId]: { ...parent, children: newChildren },
    };
    return { tree: nextTree, newId: newRootId };
  }, []);

  const handleDuplicate = useCallback((sourceId: string) => {
    setTree((prev) => {
      const result = duplicateIntoSibling(prev, sourceId);
      if (!result) return prev;
      saveTree(result.tree);
      notifyChange("lablate_tree");
      window.dispatchEvent(new Event("lablate-tree-change"));
      return result.tree;
    });
  }, [duplicateIntoSibling, notifyChange]);

  const handleCopy = useCallback((nodeId: string) => {
    if (!nodeId || nodeId === ROOT_ID) return;
    setClipboard({ mode: "copy", nodeId });
  }, []);

  const handleCut = useCallback((nodeId: string) => {
    if (!nodeId || nodeId === ROOT_ID) return;
    setClipboard({ mode: "cut", nodeId });
  }, []);

  const handlePaste = useCallback((targetId: string) => {
    if (!clipboard) return;
    setTree((prev) => {
      const source = prev[clipboard.nodeId];
      if (!source) {
        setClipboard(null);
        return prev;
      }
      const target = prev[targetId];
      if (!target) return prev;

      const targetIsFolder = target.type === "folder";

      if (clipboard.mode === "copy") {
        // コピーは自分自身が対象でも OK（直後の兄弟として複製）
        const { nodes, newRootId } = cloneSubtree(prev, clipboard.nodeId);
        const parentForUniq = targetIsFolder ? targetId : (findParent(prev, targetId) ?? ROOT_ID);
        const uniqueTitle = uniqueSiblingTitle(prev, parentForUniq, nodes[newRootId].title);
        nodes[newRootId] = { ...nodes[newRootId], title: uniqueTitle };

        let nextTree: PageTree = { ...prev, ...nodes };
        if (targetIsFolder) {
          nextTree[targetId] = { ...target, children: [...target.children, newRootId] };
        } else {
          const parent = nextTree[parentForUniq];
          if (!parent) return prev;
          const idx = parent.children.indexOf(targetId);
          const newChildren = [...parent.children];
          newChildren.splice(idx + 1, 0, newRootId);
          nextTree = { ...nextTree, [parentForUniq]: { ...parent, children: newChildren } };
        }
        saveTree(nextTree);
        notifyChange("lablate_tree");
        window.dispatchEvent(new Event("lablate-tree-change"));
        return nextTree;
      }

      // cut (移動) — 自分自身・子孫への移動は禁止
      if (clipboard.nodeId === targetId) return prev;
      if (isDescendant(prev, clipboard.nodeId, targetId)) return prev;

      const position: "inside" | "after" = targetIsFolder ? "inside" : "after";
      const newParentId = targetIsFolder ? targetId : (findParent(prev, targetId) ?? ROOT_ID);
      const uniqueTitle = uniqueSiblingTitle(prev, newParentId, source.title, clipboard.nodeId);
      let renamed: PageTree = prev;
      if (uniqueTitle !== source.title) {
        renamed = { ...prev, [clipboard.nodeId]: { ...source, title: uniqueTitle } };
      }
      const nextTree = moveNode(renamed, clipboard.nodeId, targetId, position);
      if (nextTree === prev) return prev;
      saveTree(nextTree);
      notifyChange("lablate_tree");
      setClipboard(null);
      return nextTree;
    });
  }, [clipboard, notifyChange]);

  // ── タブ操作 ──
  const handleSelectTab = useCallback((paneId: string, tabId: string) => {
    setTabState((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId);
      if (!pane) return prev;
      const tab = pane.tabs.find((t) => t.id === tabId);
      if (!tab) return prev;
      if (tab.type === "document") setSelectedId(tab.pageId);
      const next: TabState = {
        panes: prev.panes.map((p) => p.id === paneId ? { ...p, activeTabId: tabId } : p),
        activePaneId: paneId,
      };
      saveTabState(next);
      return next;
    });
  }, []);

  const handleCloseTab = useCallback((paneId: string, tabId: string) => {
    setTabState((prev) => {
      const pane = prev.panes.find((p) => p.id === paneId);
      if (!pane) return prev;
      const idx = pane.tabs.findIndex((t) => t.id === tabId);
      const newTabs = pane.tabs.filter((t) => t.id !== tabId);
      let newActive = pane.activeTabId;
      if (pane.activeTabId === tabId) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? "";
      }
      let panes: Pane[];
      let activePaneId = prev.activePaneId;
      if (newTabs.length === 0 && prev.panes.length > 1) {
        // 空ペインを削除
        panes = prev.panes.filter((p) => p.id !== paneId);
        if (activePaneId === paneId) activePaneId = panes[0].id;
      } else {
        panes = prev.panes.map((p) => p.id === paneId ? { ...p, tabs: newTabs, activeTabId: newActive } : p);
      }
      const next: TabState = { panes, activePaneId };
      saveTabState(next);
      // selectedId を新アクティブに追従
      const curPane = panes.find((p) => p.id === activePaneId);
      const curTab = curPane?.tabs.find((t) => t.id === curPane.activeTabId);
      if (curTab?.type === "document") setSelectedId(curTab.pageId);
      return next;
    });
  }, []);

  // ── 分割（アクティブタブを新規右側ペインへ移動） ──
  const handleSplit = useCallback(() => {
    setTabState((prev) => {
      if (prev.panes.length >= 2) return prev;
      const pane = prev.panes.find((p) => p.id === prev.activePaneId) ?? prev.panes[0];
      if (!pane || pane.tabs.length < 2) return prev;
      const moveId = pane.activeTabId;
      const moveTab = pane.tabs.find((t) => t.id === moveId);
      if (!moveTab) return prev;
      const newSourceTabs = pane.tabs.filter((t) => t.id !== moveId);
      const newSourceActive = newSourceTabs[0]?.id ?? "";
      const newPane: Pane = { id: crypto.randomUUID(), tabs: [moveTab], activeTabId: moveTab.id };
      const next: TabState = {
        panes: [
          ...prev.panes.map((p) => p.id === pane.id ? { ...p, tabs: newSourceTabs, activeTabId: newSourceActive } : p),
          newPane,
        ],
        activePaneId: newPane.id,
      };
      saveTabState(next);
      if (moveTab.type === "document") setSelectedId(moveTab.pageId);
      return next;
    });
  }, []);

  // ── タブ移動（D&D） ──
  const handleMoveTab = useCallback((from: TabDragPayload, toPaneId: string, beforeTabId: string | null) => {
    setTabState((prev) => {
      const fromPane = prev.panes.find((p) => p.id === from.paneId);
      const toPane = prev.panes.find((p) => p.id === toPaneId);
      if (!fromPane || !toPane) return prev;
      const tab = fromPane.tabs.find((t) => t.id === from.tabId);
      if (!tab) return prev;
      if (from.paneId === toPaneId && from.tabId === beforeTabId) return prev;

      // 同一ペイン内での並び替えと、ペイン間移動で処理を分岐
      if (from.paneId === toPaneId) {
        // 並び替え: 一度除去して挿入位置を決める
        const without = fromPane.tabs.filter((t) => t.id !== from.tabId);
        const insertIdx = beforeTabId === null
          ? without.length
          : Math.max(0, without.findIndex((t) => t.id === beforeTabId));
        const newTabs = [...without.slice(0, insertIdx), tab, ...without.slice(insertIdx)];
        const next: TabState = {
          panes: prev.panes.map((p) => p.id === toPaneId ? { ...p, tabs: newTabs, activeTabId: tab.id } : p),
          activePaneId: toPaneId,
        };
        saveTabState(next);
        if (tab.type === "document") setSelectedId(tab.pageId);
        return next;
      }

      // 他ペインへ移動
      const newSourceTabs = fromPane.tabs.filter((t) => t.id !== from.tabId);
      const newSourceActive = fromPane.activeTabId === from.tabId
        ? (newSourceTabs[0]?.id ?? "")
        : fromPane.activeTabId;
      const insertIdx = beforeTabId === null
        ? toPane.tabs.length
        : Math.max(0, toPane.tabs.findIndex((t) => t.id === beforeTabId));
      const newTargetTabs = [...toPane.tabs.slice(0, insertIdx), tab, ...toPane.tabs.slice(insertIdx)];

      const sourceBecomesEmpty = newSourceTabs.length === 0;
      const panes: Pane[] = prev.panes
        .map((p) => {
          if (p.id === from.paneId) return { ...p, tabs: newSourceTabs, activeTabId: newSourceActive };
          if (p.id === toPaneId) return { ...p, tabs: newTargetTabs, activeTabId: tab.id };
          return p;
        })
        .filter((p) => !(sourceBecomesEmpty && p.id === from.paneId && prev.panes.length > 1));

      const next: TabState = { panes, activePaneId: toPaneId };
      saveTabState(next);
      if (tab.type === "document") setSelectedId(tab.pageId);
      return next;
    });
  }, []);

  // ── スプレッドシートタブを開く（CsvTableBlock からの CustomEvent） ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const datasetId: string = detail?.datasetId;
      if (!datasetId) return;

      setTabState((prev) => {
        const existing = locateTab(prev.panes, `sheet-${datasetId}`);
        if (existing) {
          const next: TabState = {
            panes: prev.panes.map((p) => p.id === existing.pane.id ? { ...p, activeTabId: existing.tab.id } : p),
            activePaneId: existing.pane.id,
          };
          saveTabState(next);
          return next;
        }
        const meta = getDatasetMeta(datasetId);
        const newTab: Tab = {
          id: `sheet-${datasetId}`,
          type: "spreadsheet",
          label: meta?.name ?? "スプレッドシート",
          pageId: selectedId,
          datasetId,
        };
        const target = prev.panes.find((p) => p.id === prev.activePaneId) ?? prev.panes[0];
        if (!target) return prev;
        const next: TabState = {
          panes: prev.panes.map((p) => p.id === target.id
            ? { ...p, tabs: [...p.tabs, newTab], activeTabId: newTab.id }
            : p),
          activePaneId: target.id,
        };
        saveTabState(next);
        return next;
      });
    };
    window.addEventListener("lablate-open-spreadsheet-tab", handler);
    return () => window.removeEventListener("lablate-open-spreadsheet-tab", handler);
  }, [selectedId]);

  // ── データセット名変更をタブ名へ伝搬 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const { datasetId, name } = (e as CustomEvent).detail ?? {};
      if (!datasetId || !name) return;
      setTabState((prev) => {
        const panes = prev.panes.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) =>
            t.type === "spreadsheet" && t.datasetId === datasetId ? { ...t, label: name } : t
          ),
        }));
        const next: TabState = { ...prev, panes };
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

  // ── データセットがゴミ箱へ送られた → 該当タブを閉じる & ゴミ箱state 更新 ──
  useEffect(() => {
    const handler = (e: Event) => {
      const datasetId = (e as CustomEvent).detail?.datasetId;
      if (!datasetId) return;
      setTabState((prev) => {
        const panes = prev.panes
          .map((p) => {
            const remaining = p.tabs.filter((t) => !(t.type === "spreadsheet" && t.datasetId === datasetId));
            let activeTabId = p.activeTabId;
            if (!remaining.some((t) => t.id === activeTabId)) {
              activeTabId = remaining[0]?.id ?? "";
            }
            return { ...p, tabs: remaining, activeTabId };
          })
          .filter((p, i, arr) => p.tabs.length > 0 || arr.length === 1);
        const activePaneId = panes.find((p) => p.id === prev.activePaneId)?.id ?? panes[0]?.id ?? "";
        const next: TabState = { panes, activePaneId };
        saveTabState(next);
        return next;
      });
      setDatasetTrash(loadDatasetTrash());
    };
    window.addEventListener("lablate-dataset-trashed", handler);
    return () => window.removeEventListener("lablate-dataset-trashed", handler);
  }, []);

  // ── 「挿入」ハンドラ: selectedId のドキュメントタブへグラフ挿入 ──
  const handleInsertChartToDocument = useCallback((datasetId: string, chartConfig?: ChartConfig) => {
    const docTabId = `doc-${selectedId}`;
    // 該当ドキュメントタブのあるペインに切り替え
    setTabState((prev) => {
      const owner = prev.panes.find((p) => p.tabs.some((t) => t.id === docTabId));
      if (!owner) return prev;
      const next: TabState = {
        panes: prev.panes.map((p) => p.id === owner.id ? { ...p, activeTabId: docTabId } : p),
        activePaneId: owner.id,
      };
      saveTabState(next);
      return next;
    });

    setTimeout(() => {
      const ed = editorRefs.current.get(selectedId);
      if (!ed?.document?.length) return;
      try {
        const last = ed.document[ed.document.length - 1];
        if (last) ed.insertBlocks([{ type: "chart", props: { datasetId } }], last, "after");
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

  // ── ペイン間分割バー ──
  const splitDragRef = useRef<{ startX: number; startPercent: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = splitDragRef.current;
      if (!d) return;
      // メインエリア幅を取得
      const container = document.getElementById("lablate-pane-area");
      const w = container?.getBoundingClientRect().width ?? window.innerWidth;
      if (w <= 0) return;
      const pct = Math.max(20, Math.min(80, d.startPercent + ((e.clientX - d.startX) / w) * 100));
      setPaneSplit(Math.round(pct));
    };
    const onUp = () => {
      if (!splitDragRef.current) return;
      splitDragRef.current = null;
      localStorage.setItem(PANE_SPLIT_KEY, String(paneSplit));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [paneSplit]);

  const startPaneSplitDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    splitDragRef.current = { startX: e.clientX, startPercent: paneSplit };
  };

  // ── 1ペイン目のドキュメントタブが2枚以上あれば分割可能 ──
  const canSplit = tabState.panes.length === 1 && (tabState.panes[0]?.tabs.length ?? 0) >= 2;
  const totalDocTabs = countDocTabs(tabState.panes);
  const canCloseTab = useCallback((tabId: string) => {
    const located = locateTab(tabState.panes, tabId);
    if (!located) return true;
    if (located.tab.type !== "document") return true;
    return totalDocTabs > 1;
  }, [tabState.panes, totalDocTabs]);

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {sidebarOpen && (
        <div className="w-60 shrink-0 h-full">
          <Sidebar
            tree={tree}
            selectedId={selectedId}
            onSelect={handleSelectPage}
            onAddChild={handleAddChild}
            onAddFolder={handleAddFolder}
            onRename={handleRename}
            onDelete={handleDelete}
            onMove={handleMove}
            onDuplicate={handleDuplicate}
            onCopy={handleCopy}
            onCut={handleCut}
            onPaste={handlePaste}
            hasClipboard={!!clipboard}
            cutId={clipboard?.mode === "cut" ? clipboard.nodeId : null}
            trash={trash}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
            onEmptyTrash={handleEmptyTrash}
            datasetTrash={datasetTrash}
            onRestoreDataset={handleRestoreDataset}
            onPermanentDeleteDataset={handlePermanentDeleteDataset}
            onEmptyDatasetTrash={handleEmptyDatasetTrash}
          />
        </div>
      )}

      <div id="lablate-pane-area" className="flex flex-1 flex-row overflow-hidden">
        {tabState.panes.map((pane, i) => {
          const isLast = i === tabState.panes.length - 1;
          const isSplit = tabState.panes.length === 2;
          const style: React.CSSProperties = isSplit
            ? (i === 0
                ? { flexBasis: `${paneSplit}%`, flexGrow: 0, flexShrink: 0 }
                : { flex: 1, minWidth: 0 })
            : { flex: 1, minWidth: 0 };
          return (
            <div key={pane.id} className="flex h-full" style={{ ...style, overflow: "hidden" }}>
              <PaneView
                pane={pane}
                isActive={pane.id === tabState.activePaneId}
                onActivate={() => setTabState((prev) => ({ ...prev, activePaneId: pane.id }))}
                showSidebarToggle={i === 0}
                onToggleSidebar={() => setSidebarOpen((v) => !v)}
                showSplitButton={i === 0 && canSplit}
                onSplit={handleSplit}
                canCloseTab={canCloseTab}
                onSelectTab={(tid) => handleSelectTab(pane.id, tid)}
                onCloseTab={(tid) => handleCloseTab(pane.id, tid)}
                onMoveTab={handleMoveTab}
                tree={tree}
                onRename={handleRename}
                onEditorReady={handleEditorReady}
                onInsertChartToDocument={handleInsertChartToDocument}
                style={{ flex: 1, minWidth: 0 }}
              />
              {!isLast && (
                <div
                  onMouseDown={startPaneSplitDrag}
                  className="w-1 shrink-0 bg-gray-200 hover:bg-blue-400 cursor-col-resize transition-colors"
                  title="ドラッグで幅を調整"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
