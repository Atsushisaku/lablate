"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect } from "react";
import { PanelLeft } from "lucide-react";
import Sidebar from "./Sidebar";
import {
  loadTree,
  saveTree,
  deletePageRecursive,
  ROOT_ID,
  PageTree,
  createDefaultTree,
} from "@/lib/storage";

const WorklogEditor = dynamic(() => import("./WorklogEditor"), { ssr: false });

function getFirstPage(tree: PageTree): string {
  return tree[ROOT_ID]?.children[0] ?? ROOT_ID;
}

export default function WorklogPage() {
  const [mounted, setMounted] = useState(false);
  const [tree, setTree] = useState<PageTree>(createDefaultTree);
  const [selectedId, setSelectedId] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const t = loadTree();
    setTree(t);
    setSelectedId(getFirstPage(t));
    setMounted(true);
  }, []);

  const updateTree = useCallback((next: PageTree) => {
    setTree(next);
    saveTree(next);
  }, []);

  const handleAddChild = useCallback((parentId: string) => {
    const newId = crypto.randomUUID();
    setTree((prev) => {
      const next = {
        ...prev,
        [parentId]: {
          ...prev[parentId],
          children: [...prev[parentId].children, newId],
        },
        [newId]: { id: newId, title: "無題のページ", children: [] },
      };
      saveTree(next);
      return next;
    });
    setSelectedId(newId);
  }, []);

  const handleRename = useCallback((id: string, title: string) => {
    setTree((prev) => {
      const next = {
        ...prev,
        [id]: { ...prev[id], title },
      };
      saveTree(next);
      return next;
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    setTree((prev) => {
      const next = deletePageRecursive({ ...prev }, id);
      saveTree(next);
      // 削除したページが選択中なら別ページへ移動
      setSelectedId((cur) => {
        if (cur === id || !next[cur]) {
          return getFirstPage(next);
        }
        return cur;
      });
      return next;
    });
  }, []);

  const selectedPage = tree[selectedId];

  if (!mounted) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* サイドバー */}
      {sidebarOpen && (
        <div className="w-56 shrink-0 h-full">
          <Sidebar
            tree={tree}
            selectedId={selectedId}
            onSelect={setSelectedId}
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
        </header>

        {/* エディタ */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8">
            {selectedPage && (
              <>
                <input
                  key={selectedId}
                  defaultValue={selectedPage.title === "無題のページ" ? "" : selectedPage.title}
                  placeholder="無題のページ"
                  onChange={(e) => handleRename(selectedId, e.target.value || "無題のページ")}
                  className="w-full text-5xl font-bold placeholder-gray-300 outline-none mb-4 bg-transparent"
                  style={{ color: "#1a1a1a", fontWeight: 700 }}
                />
                <WorklogEditor key={`editor-${selectedId}`} pageId={selectedId} />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
