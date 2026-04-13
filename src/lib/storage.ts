import { PartialBlock } from "@blocknote/core";

export interface PageNode {
  id: string;
  title: string;
  children: string[];
}

export type PageTree = Record<string, PageNode>;

export const ROOT_ID = "root";
const TREE_KEY = "lablate_tree";
const DOC_PREFIX = "lablate_doc_";

export function createDefaultTree(): PageTree {
  const firstPageId = crypto.randomUUID();
  return {
    [ROOT_ID]: { id: ROOT_ID, title: "Home", children: [firstPageId] },
    [firstPageId]: { id: firstPageId, title: "無題のページ", children: [] },
  };
}

export function loadTree(): PageTree {
  if (typeof window === "undefined") return createDefaultTree();
  const saved = localStorage.getItem(TREE_KEY);
  if (!saved) return createDefaultTree();
  try {
    return JSON.parse(saved) as PageTree;
  } catch {
    return createDefaultTree();
  }
}

export function saveTree(tree: PageTree): void {
  localStorage.setItem(TREE_KEY, JSON.stringify(tree));
}

export function loadDoc(pageId: string): PartialBlock[] | undefined {
  if (typeof window === "undefined") return undefined;
  const saved = localStorage.getItem(DOC_PREFIX + pageId);
  if (!saved) return undefined;
  try {
    return JSON.parse(saved) as PartialBlock[];
  } catch {
    return undefined;
  }
}

export function saveDoc(pageId: string, content: PartialBlock[]): void {
  localStorage.setItem(DOC_PREFIX + pageId, JSON.stringify(content));
}

export function deleteDoc(pageId: string): void {
  localStorage.removeItem(DOC_PREFIX + pageId);
}

// ── Dataset (CSVテーブル/グラフ用データ) ──────────────────────────────

export interface Dataset {
  headers: string[];
  rows: string[][];
}

const DATASET_PREFIX = "lablate_dataset_";

export function loadDataset(id: string): Dataset | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(DATASET_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Dataset;
  } catch {
    return null;
  }
}

export function saveDataset(id: string, data: Dataset): void {
  localStorage.setItem(DATASET_PREFIX + id, JSON.stringify(data));
}

export function deleteDataset(id: string): void {
  localStorage.removeItem(DATASET_PREFIX + id);
}

// ── データセットレジストリ（グローバル） ─────────────────────────────

export interface DatasetMeta {
  id: string;
  name: string;
  createdAt: string;   // ISO 8601
}

const DATASET_REGISTRY_KEY = "lablate_datasets";

export function loadDatasetRegistry(): DatasetMeta[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(DATASET_REGISTRY_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as DatasetMeta[]; } catch { return []; }
}

export function saveDatasetRegistry(registry: DatasetMeta[]): void {
  localStorage.setItem(DATASET_REGISTRY_KEY, JSON.stringify(registry));
}

/** 冪等: 既存なら何もせず返す。なければ新規作成して返す */
export function registerDataset(id: string, name?: string): DatasetMeta {
  const registry = loadDatasetRegistry();
  const existing = registry.find((d) => d.id === id);
  if (existing) return existing;
  const meta: DatasetMeta = { id, name: name ?? `データセット ${registry.length + 1}`, createdAt: new Date().toISOString() };
  registry.push(meta);
  saveDatasetRegistry(registry);
  return meta;
}

export function unregisterDataset(id: string): void {
  const registry = loadDatasetRegistry().filter((d) => d.id !== id);
  saveDatasetRegistry(registry);
  deleteDataset(id);
}

export function renameDataset(id: string, name: string): void {
  const registry = loadDatasetRegistry();
  const entry = registry.find((d) => d.id === id);
  if (entry) { entry.name = name; saveDatasetRegistry(registry); }
}

export function getDatasetMeta(id: string): DatasetMeta | null {
  return loadDatasetRegistry().find((d) => d.id === id) ?? null;
}

/** 起動時マイグレーション: 既存 dataset キーでレジストリ未登録のものを登録 */
export function migrateDatasetRegistry(): void {
  if (typeof window === "undefined") return;
  const registry = loadDatasetRegistry();
  const knownIds = new Set(registry.map((d) => d.id));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(DATASET_PREFIX)) {
      const id = key.slice(DATASET_PREFIX.length);
      if (!knownIds.has(id)) registerDataset(id);
    }
  }
}

// ── タブ状態 ──────────────────────────────────────────────────────────

export type TabType = "document" | "spreadsheet";

export interface Tab {
  id: string;
  type: TabType;
  label: string;
  pageId: string;         // ドキュメントタブ: そのページのID、スプレッドシートタブ: 開いた元ページ
  datasetId?: string;     // スプレッドシートタブのみ
}

export interface TabState {
  tabs: Tab[];
  activeTabId: string;
}

const TABS_KEY = "lablate_tabs";

export function loadTabState(): TabState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(TABS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as TabState; } catch { return null; }
}

export function saveTabState(state: TabState): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(state));
}

// ─────────────────────────────────────────────────────────────────────

/** ページとその子孫を再帰的に削除する */
export function deletePageRecursive(tree: PageTree, pageId: string): PageTree {
  const next = { ...tree };
  const page = next[pageId];
  if (!page) return next;
  for (const childId of page.children) {
    deletePageRecursive(next, childId);
  }
  deleteDoc(pageId);
  delete next[pageId];
  // 親から参照を外す
  for (const node of Object.values(next)) {
    node.children = node.children.filter((id) => id !== pageId);
  }
  return next;
}
