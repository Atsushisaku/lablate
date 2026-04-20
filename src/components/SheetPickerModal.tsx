"use client";

import { useEffect } from "react";
import { SheetSummary } from "@/lib/excel-import";

interface Props {
  sheets: SheetSummary[];
  onSelect: (sheetName: string) => void;
  onCancel: () => void;
}

export default function SheetPickerModal({ sheets, onSelect, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        className="w-80 max-h-[70vh] flex flex-col bg-white rounded-lg shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-800">シートを選択</h2>
          <p className="text-xs text-gray-500 mt-0.5">取り込むシートを1つ選んでください</p>
        </div>
        <ul className="overflow-y-auto flex-1 py-1">
          {sheets.map((s) => (
            <li key={s.name}>
              <button
                onClick={() => onSelect(s.name)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none flex items-center justify-between gap-2"
              >
                <span className="truncate font-medium text-gray-800">{s.name}</span>
                <span className="text-xs text-gray-500 shrink-0">{s.rows}行×{s.cols}列</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end">
          <button
            onClick={onCancel}
            className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
