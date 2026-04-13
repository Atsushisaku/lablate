"use client";

import { FileText, Table2, X } from "lucide-react";
import { Tab } from "@/lib/storage";

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export default function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-gray-200 bg-white px-2 shrink-0 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isDoc = tab.type === "document";
        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-b-2 shrink-0 transition-colors ${
              isActive
                ? "border-blue-500 text-gray-900 bg-blue-50/40"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isDoc ? <FileText size={12} /> : <Table2 size={12} />}
            <span className="max-w-[120px] truncate">{tab.label}</span>
            {/* ドキュメントタブは閉じない */}
            {!isDoc && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                className="ml-1 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
              >
                <X size={10} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
