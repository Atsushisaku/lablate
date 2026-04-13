"use client";

import { useState, useEffect, useRef } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ChartRenderer, ChartConfig, defaultChartConfig } from "./ChartRenderer";

// ── ブロック固有設定（リサイズ・折りたたみを含む） ──────────────────

type BlockChartConfig = ChartConfig & {
  collapsed: boolean;
  chartWidth: number;   // px, 0 = auto
  chartHeight: number;  // px
};

const defaultBlockConfig: BlockChartConfig = {
  ...defaultChartConfig,
  collapsed: false,
  chartWidth: 0,
  chartHeight: 340,
};

function loadBlockConfig(blockId: string): BlockChartConfig {
  if (typeof window === "undefined") return defaultBlockConfig;
  try {
    const raw = localStorage.getItem(`lablate_chart_config_${blockId}`);
    if (raw) return { ...defaultBlockConfig, ...JSON.parse(raw) } as BlockChartConfig;
  } catch { /* ignore */ }
  return defaultBlockConfig;
}

function saveBlockConfig(blockId: string, config: BlockChartConfig): void {
  localStorage.setItem(`lablate_chart_config_${blockId}`, JSON.stringify(config));
}

// ── リサイズハンドル ──────────────────────────────────────────────

const HANDLES: { id: string; style: React.CSSProperties }[] = [
  { id: "n",  style: { top: -4, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
  { id: "s",  style: { bottom: -4, left: "50%", transform: "translateX(-50%)", cursor: "ns-resize" } },
  { id: "e",  style: { right: -4, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
  { id: "w",  style: { left: -4, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" } },
  { id: "ne", style: { top: -4, right: -4, cursor: "nesw-resize" } },
  { id: "se", style: { bottom: -4, right: -4, cursor: "nwse-resize" } },
  { id: "sw", style: { bottom: -4, left: -4, cursor: "nesw-resize" } },
  { id: "nw", style: { top: -4, left: -4, cursor: "nwse-resize" } },
];

// ── ChartView（ブロックラッパー） ──────────────────────────────────

function ChartView({ block }: { block: any }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { datasetId } = block.props as { datasetId: string };
  const [config, setConfig] = useState<BlockChartConfig>(() => loadBlockConfig(block.id));
  const outerRef = useRef<HTMLDivElement>(null);

  // ── リサイズ ──
  const dragRef = useRef<{ handle: string; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const liveSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null);
  const [chartFocused, setChartFocused] = useState(false);

  const updateConfig = (updates: Partial<BlockChartConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveBlockConfig(block.id, next);
      return next;
    });
  };

  const { collapsed: isCollapsed, chartWidth, chartHeight } = config;

  // ── フォーカス追跡 ──
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = outerRef.current;
      if (!el) return;
      setChartFocused(el.contains(e.target as Node));
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, []);

  // ── ドラッグリサイズ ──
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      let newW = d.startW, newH = d.startH;
      if (d.handle.includes("e")) newW = Math.max(200, d.startW + (e.clientX - d.startX));
      if (d.handle.includes("w")) newW = Math.max(200, d.startW - (e.clientX - d.startX));
      if (d.handle.includes("s")) newH = Math.max(100, d.startH + (e.clientY - d.startY));
      if (d.handle.includes("n")) newH = Math.max(100, d.startH - (e.clientY - d.startY));
      liveSizeRef.current = { w: newW, h: newH };
      setLiveSize({ w: newW, h: newH });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      const size = liveSizeRef.current;
      if (size) updateConfig({ chartWidth: size.w, chartHeight: size.h });
      dragRef.current = null; liveSizeRef.current = null; setLiveSize(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  const startDrag = (e: React.MouseEvent, handleId: string) => {
    e.preventDefault(); e.stopPropagation();
    const el = outerRef.current;
    if (!el) return;
    dragRef.current = {
      handle: handleId,
      startX: e.clientX, startY: e.clientY,
      startW: el.getBoundingClientRect().width, startH: config.chartHeight,
    };
  };

  const displayW = liveSize?.w ?? (chartWidth > 0 ? chartWidth : 0);
  const displayH = liveSize?.h ?? chartHeight;
  const showHandles = (chartFocused || !!liveSize) && !isCollapsed;

  // ── 折りたたみサマリー ──
  const summaryLabel = config.title || "グラフ";

  if (!datasetId) {
    return (
      <div className="my-2 rounded border border-dashed border-gray-300 p-8 text-center text-gray-400 text-sm">
        テーブルブロックの「グラフ」からデータを渡してください
      </div>
    );
  }

  return (
    <div
      ref={outerRef}
      className="my-2 text-sm relative"
      style={{ width: displayW > 0 ? displayW : "100%" }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="rounded border border-gray-200 overflow-hidden">
        {/* ── 折りたたみバー ── */}
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => updateConfig({ collapsed: !isCollapsed })}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 shrink-0"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            {isCollapsed ? "展開" : "最小化"}
          </button>
          {isCollapsed && <span className="text-xs text-gray-500 truncate">{summaryLabel}</span>}
        </div>

        {/* ── グラフ本体（ChartRenderer に委譲） ── */}
        {!isCollapsed && (
          <ChartRenderer
            datasetId={datasetId}
            config={config}
            onConfigChange={updateConfig}
            height={displayH}
          />
        )}
      </div>

      {/* ── リサイズハンドル ── */}
      {showHandles && HANDLES.map(({ id, style }) => (
        <div key={id} onMouseDown={(e) => startDrag(e, id)}
          style={{ position: "absolute", ...style, width: 8, height: 8,
            background: "#fff", border: "2px solid #3b82f6", borderRadius: 2, zIndex: 10 }} />
      ))}

      {liveSize && (
        <div style={{ position: "absolute", inset: 0, border: "2px dashed #3b82f6", borderRadius: 4,
          display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 9 }}>
          <span style={{ background: "rgba(59,130,246,0.9)", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
            {Math.round(liveSize.w)} × {Math.round(liveSize.h)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const chartBlockSpec = createReactBlockSpec(
  {
    type: "chart" as const,
    propSchema: { datasetId: { default: "" } },
    content: "none" as const,
  },
  { render: ({ block }) => <ChartView block={block} /> }
);
