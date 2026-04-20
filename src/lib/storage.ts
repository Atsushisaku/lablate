import { PartialBlock } from "@blocknote/core";

export type NodeType = "page" | "folder";

export interface PageNode {
  id: string;
  title: string;
  children: string[];
  type?: NodeType; // 未指定は "page" 扱い（後方互換）
}

export type PageTree = Record<string, PageNode>;

export const ROOT_ID = "root";
const TREE_KEY = "lablate_tree";
const DOC_PREFIX = "lablate_doc_";

export function createDefaultTree(): PageTree {
  const firstPageId = crypto.randomUUID();
  return {
    [ROOT_ID]: { id: ROOT_ID, title: "Home", children: [firstPageId] },
    [firstPageId]: { id: firstPageId, title: "新規ページ", children: [] },
  };
}

export function loadTree(): PageTree {
  if (typeof window === "undefined") return createDefaultTree();
  const saved = localStorage.getItem(TREE_KEY);
  if (!saved) return createDefaultTree();
  try {
    const parsed = JSON.parse(saved) as PageTree;
    // 旧デフォルトタイトル「無題のページ」→「新規ページ」
    let migrated = false;
    for (const id of Object.keys(parsed)) {
      if (parsed[id]?.title === "無題のページ") {
        parsed[id] = { ...parsed[id], title: "新規ページ" };
        migrated = true;
      }
    }
    if (migrated) saveTree(parsed);
    return parsed;
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
  pageId?: string;     // データセットが属するページ ID
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
export function registerDataset(id: string, name?: string, pageId?: string): DatasetMeta {
  const registry = loadDatasetRegistry();
  const existing = registry.find((d) => d.id === id);
  if (existing) {
    // pageId が未設定で渡された場合は補完
    if (pageId && !existing.pageId) {
      existing.pageId = pageId;
      saveDatasetRegistry(registry);
    }
    return existing;
  }
  const meta: DatasetMeta = { id, name: name ?? `データセット ${registry.length + 1}`, createdAt: new Date().toISOString(), pageId };
  registry.push(meta);
  saveDatasetRegistry(registry);
  return meta;
}

/** ブロック配列を走査し datasetId を収集（children も再帰的に） */
function collectDatasetIdsFromBlocks(blocks: unknown[] | null | undefined, out: Set<string>): void {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = block as any;
    const dsId = b?.props?.datasetId;
    if (dsId && typeof dsId === "string") out.add(dsId);
    if (Array.isArray(b?.children)) collectDatasetIdsFromBlocks(b.children, out);
  }
}

/** 全ドキュメントで実際に使用されている datasetId の Set を返す（ゴミ箱内のページ含む） */
export function collectUsedDatasetIds(): Set<string> {
  const tree = loadTree();
  const used = new Set<string>();
  // アクティブツリー
  const walk = (nodeId: string) => {
    const node = tree[nodeId];
    if (!node) return;
    if (nodeId !== ROOT_ID) collectDatasetIdsFromBlocks(loadDoc(nodeId), used);
    node.children.forEach(walk);
  };
  walk(ROOT_ID);
  // ゴミ箱内のページの doc も参照中として扱う（トラッシュされたページを復元したとき dataset が失われないように）
  for (const item of loadTrash()) {
    const subtreeRaw = localStorage.getItem(`lablate_trash_subtree_${item.id}`);
    if (!subtreeRaw) continue;
    try {
      const subtree = JSON.parse(subtreeRaw) as Record<string, PageNode>;
      for (const nid of Object.keys(subtree)) {
        collectDatasetIdsFromBlocks(loadDoc(nid), used);
      }
    } catch { /* ignore */ }
  }
  return used;
}

/** 孤立したデータセットをゴミ箱へ送る（完全削除ではなくソフト削除） */
export function cleanupOrphanedDatasets(): number {
  const usedIds = collectUsedDatasetIds();
  const registry = loadDatasetRegistry();
  const orphaned = registry.filter((d) => !usedIds.has(d.id));
  for (const d of orphaned) {
    trashDataset(d.id);
  }
  return orphaned.length;
}

/** データセット一覧を取得（ページ名付き、データが存在するもののみ） */
export function listDatasetsWithPageNames(): (DatasetMeta & { pageName: string })[] {
  const registry = loadDatasetRegistry();
  const tree = loadTree();
  return registry
    .filter((meta) => {
      // 実データが存在しないものは除外
      const ds = loadDataset(meta.id);
      if (!ds) return false;
      // 全セルが空のデータセットも除外
      const hasData = ds.rows.some((row) => row.some((cell) => cell !== ""));
      return hasData;
    })
    .map((meta) => {
      const pageName = meta.pageId && tree[meta.pageId] ? tree[meta.pageId].title : "";
      return { ...meta, pageName };
    });
}

export function unregisterDataset(id: string): void {
  const registry = loadDatasetRegistry().filter((d) => d.id !== id);
  saveDatasetRegistry(registry);
  deleteDataset(id);
}

// ── データセットゴミ箱 ─────────────────────────────────────────────

const DATASET_TRASH_KEY = "lablate_dataset_trash";
const SPREADSHEET_CHARTS_PREFIX = "lablate_spreadsheet_charts_";

export interface SpreadsheetChartEntry {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
}

export interface DatasetTrashItem {
  id: string;                    // ゴミ箱エントリ ID
  datasetId: string;             // 元のデータセット ID（復元時に再利用）
  meta: DatasetMeta;             // レジストリエントリ
  data: Dataset;                 // ヘッダー + 行
  spreadsheetCharts?: SpreadsheetChartEntry[]; // スプレッドシートタブ側のグラフ設定
  deletedAt: string;             // ISO 日時
}

export function loadDatasetTrash(): DatasetTrashItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(DATASET_TRASH_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as DatasetTrashItem[]; } catch { return []; }
}

function saveDatasetTrash(items: DatasetTrashItem[]): void {
  localStorage.setItem(DATASET_TRASH_KEY, JSON.stringify(items));
}

/** データセットをゴミ箱へ移動（data / registry / spreadsheet charts をまとめて退避） */
export function trashDataset(datasetId: string): DatasetTrashItem | null {
  const data = loadDataset(datasetId);
  const meta = getDatasetMeta(datasetId);
  if (!data && !meta) return null;

  let spreadsheetCharts: SpreadsheetChartEntry[] | undefined;
  try {
    const raw = localStorage.getItem(SPREADSHEET_CHARTS_PREFIX + datasetId);
    if (raw) spreadsheetCharts = JSON.parse(raw);
  } catch { /* ignore */ }

  const item: DatasetTrashItem = {
    id: crypto.randomUUID(),
    datasetId,
    meta: meta ?? { id: datasetId, name: "データセット", createdAt: new Date().toISOString() },
    data: data ?? { headers: [], rows: [] },
    spreadsheetCharts,
    deletedAt: new Date().toISOString(),
  };

  const trash = loadDatasetTrash();
  trash.push(item);
  saveDatasetTrash(trash);

  // アクティブ状態から除去
  deleteDataset(datasetId);
  localStorage.removeItem(SPREADSHEET_CHARTS_PREFIX + datasetId);
  const registry = loadDatasetRegistry().filter((d) => d.id !== datasetId);
  saveDatasetRegistry(registry);

  return item;
}

/** ゴミ箱から復元（data / registry / spreadsheet charts を戻す）。呼び出し側はページへのブロック再挿入を別途行う */
export function restoreDatasetFromTrash(trashEntryId: string): DatasetTrashItem | null {
  const trash = loadDatasetTrash();
  const item = trash.find((e) => e.id === trashEntryId);
  if (!item) return null;

  saveDataset(item.datasetId, item.data);
  const registry = loadDatasetRegistry();
  if (!registry.some((d) => d.id === item.datasetId)) {
    registry.push(item.meta);
    saveDatasetRegistry(registry);
  }
  if (item.spreadsheetCharts) {
    localStorage.setItem(SPREADSHEET_CHARTS_PREFIX + item.datasetId, JSON.stringify(item.spreadsheetCharts));
  }
  saveDatasetTrash(trash.filter((e) => e.id !== trashEntryId));
  return item;
}

export function permanentlyDeleteTrashedDataset(trashEntryId: string): void {
  saveDatasetTrash(loadDatasetTrash().filter((e) => e.id !== trashEntryId));
}

export function emptyDatasetTrash(): void {
  saveDatasetTrash([]);
}

// ── 同階層内で一意なタイトルを作る ──────────────────────────────────

/**
 * parentId 配下の兄弟ノードと衝突しないタイトルを返す。
 * 既に同名が存在する場合は末尾に " 2", " 3" ... を付与。
 * excludeId を指定するとその ID のノードは衝突チェックから除外する（自分自身を除く用途）。
 */
export function uniqueSiblingTitle(
  tree: PageTree,
  parentId: string,
  desired: string,
  excludeId?: string
): string {
  const parent = tree[parentId];
  if (!parent) return desired;
  const taken = new Set<string>();
  for (const cid of parent.children) {
    if (cid === excludeId) continue;
    const t = tree[cid]?.title;
    if (t) taken.add(t);
  }
  if (!taken.has(desired)) return desired;
  let n = 2;
  while (taken.has(`${desired} ${n}`)) n++;
  return `${desired} ${n}`;
}

// ── ページ複製（コピー） ────────────────────────────────────────────

interface BlockNode {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  children?: BlockNode[];
  content?: unknown;
}

function cloneDatasetData(oldDsId: string, newPageId: string): string {
  const newId = crypto.randomUUID();
  const raw = localStorage.getItem(DATASET_PREFIX + oldDsId);
  if (raw) localStorage.setItem(DATASET_PREFIX + newId, raw);
  const meta = getDatasetMeta(oldDsId);
  const newName = meta?.name ? `${meta.name}-コピー` : undefined;
  registerDataset(newId, newName, newPageId);
  const sheetCharts = localStorage.getItem(`lablate_spreadsheet_charts_${oldDsId}`);
  if (sheetCharts) localStorage.setItem(`lablate_spreadsheet_charts_${newId}`, sheetCharts);
  return newId;
}

function cloneBlock(
  block: BlockNode,
  datasetIdMap: Map<string, string>,
  pageIdMap: Map<string, string>,
  newOwnerPageId: string
): BlockNode {
  const newBlockId = crypto.randomUUID();
  const newProps: Record<string, unknown> = { ...(block.props ?? {}) };

  if (block.type === "csvTable" || block.type === "chart") {
    const oldDsId = typeof newProps.datasetId === "string" ? newProps.datasetId : "";
    if (oldDsId) {
      let newDsId = datasetIdMap.get(oldDsId);
      if (!newDsId) {
        newDsId = cloneDatasetData(oldDsId, newOwnerPageId);
        datasetIdMap.set(oldDsId, newDsId);
      }
      newProps.datasetId = newDsId;
    }
  } else if (block.type === "pageLink") {
    const linkedId = typeof newProps.pageId === "string" ? newProps.pageId : "";
    if (linkedId && pageIdMap.has(linkedId)) {
      newProps.pageId = pageIdMap.get(linkedId);
    }
  }
  // chartRef は参照保持のため書き換えない

  // chart ブロックの設定（blockId キー）を新しい blockId へコピー
  try {
    if (block.id) {
      const cfgRaw = localStorage.getItem(`lablate_chart_config_${block.id}`);
      if (cfgRaw) localStorage.setItem(`lablate_chart_config_${newBlockId}`, cfgRaw);
    }
  } catch { /* ignore */ }

  const newChildren = Array.isArray(block.children)
    ? block.children.map((c) => cloneBlock(c, datasetIdMap, pageIdMap, newOwnerPageId))
    : block.children;

  return { ...block, id: newBlockId, props: newProps, children: newChildren };
}

function cloneDocAndReferences(
  oldPageId: string,
  newPageId: string,
  datasetIdMap: Map<string, string>,
  pageIdMap: Map<string, string>
): void {
  const raw = localStorage.getItem(DOC_PREFIX + oldPageId);
  if (!raw) return;
  try {
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc)) return;
    const newDoc = doc.map((b) => cloneBlock(b as BlockNode, datasetIdMap, pageIdMap, newPageId));
    localStorage.setItem(DOC_PREFIX + newPageId, JSON.stringify(newDoc));
  } catch { /* ignore */ }
}

/**
 * サブツリーを複製する。新しい pageId / datasetId / blockId を振り、
 * 関連するドキュメント・データセット・グラフ設定も複製する。
 * 呼び出し側で返り値の nodes をツリーへマージし、親の children へ newRootId を挿入すること。
 */
export function cloneSubtree(
  tree: PageTree,
  sourceId: string
): { nodes: Record<string, PageNode>; newRootId: string } {
  const pageIdMap = new Map<string, string>();
  const datasetIdMap = new Map<string, string>();

  const collectIds = (oldId: string) => {
    if (!tree[oldId]) return;
    pageIdMap.set(oldId, crypto.randomUUID());
    for (const cid of tree[oldId].children) collectIds(cid);
  };
  collectIds(sourceId);

  const newNodes: Record<string, PageNode> = {};
  const cloneOne = (oldId: string) => {
    const node = tree[oldId];
    if (!node) return;
    const newId = pageIdMap.get(oldId)!;
    const newChildren = node.children.map((c) => pageIdMap.get(c)!).filter(Boolean);
    for (const cid of node.children) cloneOne(cid);
    if (node.type !== "folder") {
      cloneDocAndReferences(oldId, newId, datasetIdMap, pageIdMap);
    }
    newNodes[newId] = {
      id: newId,
      title: sourceId === oldId ? `${node.title}-コピー` : node.title,
      children: newChildren,
      ...(node.type ? { type: node.type } : {}),
    };
  };
  cloneOne(sourceId);

  return { nodes: newNodes, newRootId: pageIdMap.get(sourceId)! };
}

// ─────────────────────────────────────────────────────────────────────

export function renameDataset(id: string, name: string): void {
  const registry = loadDatasetRegistry();
  const entry = registry.find((d) => d.id === id);
  if (entry) { entry.name = name; saveDatasetRegistry(registry); }
}

export function getDatasetMeta(id: string): DatasetMeta | null {
  return loadDatasetRegistry().find((d) => d.id === id) ?? null;
}

/**
 * datasetId を持つブロックが存在するページを検索する。
 * まず登録時に保存された meta.pageId を使用、無ければ全ページを走査して逆引き。
 * 見つかればその pageId を返し、レジストリにも保存（次回以降の高速化）。
 */
export function findDatasetOwnerPage(datasetId: string): string | null {
  const meta = getDatasetMeta(datasetId);
  const tree = loadTree();
  if (meta?.pageId && tree[meta.pageId]) return meta.pageId;

  // 逆引き: 全ページの doc を走査して該当 datasetId を含むページを探す
  const walk = (nodeId: string): string | null => {
    const node = tree[nodeId];
    if (!node) return null;
    if (nodeId !== ROOT_ID) {
      const doc = loadDoc(nodeId);
      if (doc) {
        for (const block of doc) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b = block as any;
          if (b?.props?.datasetId === datasetId) return nodeId;
          if (Array.isArray(b?.children)) {
            for (const child of b.children) {
              if (child?.props?.datasetId === datasetId) return nodeId;
            }
          }
        }
      }
    }
    for (const cid of node.children) {
      const found = walk(cid);
      if (found) return found;
    }
    return null;
  };
  const found = walk(ROOT_ID);
  if (found && meta) {
    // 次回以降のためにキャッシュ
    const registry = loadDatasetRegistry();
    const entry = registry.find((d) => d.id === datasetId);
    if (entry) {
      entry.pageId = found;
      saveDatasetRegistry(registry);
    }
  }
  return found;
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

/** 2ペイン分割用の各ペイン */
export interface Pane {
  id: string;
  tabs: Tab[];
  activeTabId: string;
}

export interface TabState {
  panes: Pane[];          // 最大2（1〜2ペイン）
  activePaneId: string;
}

const TABS_KEY = "lablate_tabs";

/** レガシー形式: `{ tabs, activeTabId }` — 古い localStorage 値の互換用 */
interface LegacyTabState { tabs: Tab[]; activeTabId: string }

export function loadTabState(): TabState | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(TABS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TabState | LegacyTabState;
    // 旧形式を単一ペインへ移行
    if (!("panes" in parsed) || !Array.isArray((parsed as TabState).panes)) {
      const legacy = parsed as LegacyTabState;
      const paneId = crypto.randomUUID();
      return {
        panes: [{ id: paneId, tabs: legacy.tabs ?? [], activeTabId: legacy.activeTabId ?? "" }],
        activePaneId: paneId,
      };
    }
    return parsed as TabState;
  } catch {
    return null;
  }
}

export function saveTabState(state: TabState): void {
  localStorage.setItem(TABS_KEY, JSON.stringify(state));
}

// ─────────────────────────────────────────────────────────────────────

/** nodeId の子孫かどうかを判定 */
export function isDescendant(tree: PageTree, ancestorId: string, targetId: string): boolean {
  const node = tree[ancestorId];
  if (!node) return false;
  for (const childId of node.children) {
    if (childId === targetId || isDescendant(tree, childId, targetId)) return true;
  }
  return false;
}

/** nodeId の現在の親を探す */
export function findParent(tree: PageTree, nodeId: string): string | null {
  for (const [id, node] of Object.entries(tree)) {
    if (node.children.includes(nodeId)) return id;
  }
  return null;
}

/**
 * ノードを移動する
 * @param position "inside" = targetId の子の末尾, "before"/"after" = targetId の前後に兄弟として挿入
 */
export function moveNode(
  tree: PageTree,
  dragId: string,
  targetId: string,
  position: "before" | "after" | "inside",
): PageTree {
  if (dragId === targetId) return tree;
  if (dragId === ROOT_ID) return tree;
  if (isDescendant(tree, dragId, targetId)) return tree;

  const next = { ...tree };
  // 各ノードの children を浅コピー
  for (const key of Object.keys(next)) {
    next[key] = { ...next[key], children: [...next[key].children] };
  }

  // 元の親から除去
  const oldParentId = findParent(next, dragId);
  if (oldParentId) {
    next[oldParentId].children = next[oldParentId].children.filter((id) => id !== dragId);
  }

  if (position === "inside") {
    // targetId の子の末尾に追加
    next[targetId].children.push(dragId);
  } else {
    // targetId の親を見つけて、targetId の前 or 後に挿入
    const targetParentId = findParent(next, targetId);
    if (!targetParentId) return tree;
    const siblings = next[targetParentId].children;
    const idx = siblings.indexOf(targetId);
    const insertIdx = position === "before" ? idx : idx + 1;
    siblings.splice(insertIdx, 0, dragId);
  }

  return next;
}

/** ページとその子孫を再帰的に完全削除する（ゴミ箱の完全削除で使用） */
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

// ── ゴミ箱 ──────────────────────────────────────────────────────────

export interface TrashItem {
  id: string;           // ゴミ箱エントリの ID（= ページ/フォルダの ID）
  node: PageNode;       // 削除時点のノード情報（子含む）
  parentId: string;     // 元の親ノード ID
  deletedAt: string;    // ISO 8601
}

const TRASH_KEY = "lablate_trash";

export function loadTrash(): TrashItem[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(TRASH_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as TrashItem[]; } catch { return []; }
}

export function saveTrash(items: TrashItem[]): void {
  localStorage.setItem(TRASH_KEY, JSON.stringify(items));
}

/**
 * ページ/フォルダをゴミ箱に移動（ソフト削除）
 * - ツリーからノードと子孫を除去するが、ドキュメントデータは保持
 * - 子孫のノード情報も TrashItem.node.children 経由で保持される
 */
export function trashPage(tree: PageTree, pageId: string): PageTree {
  const node = tree[pageId];
  if (!node) return tree;

  const parentId = findParent(tree, pageId) ?? ROOT_ID;

  // ゴミ箱に追加（子孫のノード情報も丸ごと保存）
  // StrictMode の二重呼び出し対策: 既に同じ ID がゴミ箱にあればスキップ
  const trash = loadTrash();
  if (trash.some((t) => t.id === pageId)) {
    // 既にゴミ箱にある → ツリーからの除去だけ行う
    const next = { ...tree };
    const removeFromTree = (nid: string) => {
      const n = next[nid];
      if (!n) return;
      for (const childId of n.children) removeFromTree(childId);
      delete next[nid];
    };
    removeFromTree(pageId);
    for (const n of Object.values(next)) {
      n.children = n.children.filter((id) => id !== pageId);
    }
    return next;
  }

  const collectNodes = (nid: string): Record<string, PageNode> => {
    const n = tree[nid];
    if (!n) return {};
    let result: Record<string, PageNode> = { [nid]: { ...n, children: [...n.children] } };
    for (const childId of n.children) {
      result = { ...result, ...collectNodes(childId) };
    }
    return result;
  };
  const subtreeNodes = collectNodes(pageId);

  const trashItem: TrashItem = {
    id: pageId,
    node: { ...node, children: [...node.children] },
    parentId,
    deletedAt: new Date().toISOString(),
  };
  // 子孫ノードも個別に保存（復元時に必要）
  // _subtree として localStorage に退避
  localStorage.setItem(`lablate_trash_subtree_${pageId}`, JSON.stringify(subtreeNodes));

  trash.push(trashItem);
  saveTrash(trash);

  // ツリーから除去（ドキュメントデータは削除しない）
  const next = { ...tree };
  const removeFromTree = (nid: string) => {
    const n = next[nid];
    if (!n) return;
    for (const childId of n.children) {
      removeFromTree(childId);
    }
    delete next[nid];
  };
  removeFromTree(pageId);
  // 親から参照を外す
  for (const n of Object.values(next)) {
    n.children = n.children.filter((id) => id !== pageId);
  }
  return next;
}

/** ゴミ箱からページを復元（ルート直下に復元） */
export function restorePage(trashItemId: string): PageTree {
  const trash = loadTrash();
  const idx = trash.findIndex((t) => t.id === trashItemId);
  if (idx < 0) return loadTree();

  const item = trash[idx];
  const tree = loadTree();

  // 子孫ノードを復元
  const subtreeRaw = localStorage.getItem(`lablate_trash_subtree_${trashItemId}`);
  const subtreeNodes: Record<string, PageNode> = subtreeRaw ? JSON.parse(subtreeRaw) : {};

  const next = { ...tree };
  // サブツリーの全ノードをツリーに追加
  for (const [nid, node] of Object.entries(subtreeNodes)) {
    next[nid] = { ...node };
  }
  // ルートに復元（元の親がまだ存在すればそこに、なければ ROOT）
  const restoreParent = next[item.parentId] ? item.parentId : ROOT_ID;
  next[restoreParent] = {
    ...next[restoreParent],
    children: [...next[restoreParent].children, trashItemId],
  };

  // ゴミ箱から除去
  trash.splice(idx, 1);
  saveTrash(trash);
  localStorage.removeItem(`lablate_trash_subtree_${trashItemId}`);

  saveTree(next);
  return next;
}

/** ゴミ箱から1件を完全削除 */
export function permanentlyDeleteTrashItem(trashItemId: string): void {
  const trash = loadTrash();
  const idx = trash.findIndex((t) => t.id === trashItemId);
  if (idx < 0) return;

  // 子孫ノードのドキュメントも含め完全削除
  const subtreeRaw = localStorage.getItem(`lablate_trash_subtree_${trashItemId}`);
  const subtreeNodes: Record<string, PageNode> = subtreeRaw ? JSON.parse(subtreeRaw) : {};
  for (const nid of Object.keys(subtreeNodes)) {
    deleteDoc(nid);
  }
  // 退避データを削除
  localStorage.removeItem(`lablate_trash_subtree_${trashItemId}`);

  trash.splice(idx, 1);
  saveTrash(trash);
}

/** ゴミ箱を空にする */
export function emptyTrash(): void {
  const trash = loadTrash();
  for (const item of trash) {
    const subtreeRaw = localStorage.getItem(`lablate_trash_subtree_${item.id}`);
    const subtreeNodes: Record<string, PageNode> = subtreeRaw ? JSON.parse(subtreeRaw) : {};
    for (const nid of Object.keys(subtreeNodes)) {
      deleteDoc(nid);
    }
    localStorage.removeItem(`lablate_trash_subtree_${item.id}`);
  }
  saveTrash([]);
}
