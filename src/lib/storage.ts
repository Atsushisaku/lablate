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
