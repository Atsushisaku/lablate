"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { ImagePlus } from "lucide-react";
import { imageStore, compressImage } from "@/lib/storage/image-store";
import { ImageMeta } from "@/lib/storage/types";

// ── ImageView ────────────────────────────────────────────────────────

function ImageView({
  block,
  editor,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  block: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: any;
}) {
  const { imageId, alt, width: widthProp } = block.props as {
    imageId: string;
    alt: string;
    width: string;
  };

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 画像の読み込み ──
  useEffect(() => {
    if (!imageId) return;
    let revoked = false;
    setLoading(true);
    imageStore.load(imageId).then((result) => {
      if (revoked) return;
      if (result) {
        const url = URL.createObjectURL(result.blob);
        setObjectUrl(url);
      }
      setLoading(false);
    });
    return () => {
      revoked = true;
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [imageId]);

  // ── 画像の保存 & ブロック更新 ──
  const handleFile = useCallback(async (file: File | Blob, name?: string) => {
    setLoading(true);
    try {
      const id = crypto.randomUUID();
      const { blob, width, height } = await compressImage(file);
      const meta: ImageMeta = {
        id,
        name: name || (file instanceof File ? file.name : "image"),
        mimeType: blob.type,
        width, height,
        size: blob.size,
        createdAt: new Date().toISOString(),
      };
      await imageStore.save(id, blob, meta);
      editor.updateBlock(block, { props: { imageId: id } });
    } catch (e) {
      console.error("画像の保存に失敗:", e);
    } finally {
      setLoading(false);
    }
  }, [block, editor]);

  // ── ファイル選択 ──
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  // ── D&D ──
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("image/")) handleFile(file);
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  // ── ペースト（ブロック内） ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          const file = item.getAsFile();
          if (file) handleFile(file);
          return;
        }
      }
    };
    el.addEventListener("paste", handler);
    return () => el.removeEventListener("paste", handler);
  }, [handleFile]);

  // ── 幅変更 ──
  const setWidth = useCallback((w: string) => {
    editor.updateBlock(block, { props: { width: w } });
  }, [block, editor]);

  // ── alt 変更 ──
  const setAlt = useCallback((value: string) => {
    editor.updateBlock(block, { props: { alt: value } });
  }, [block, editor]);

  // ── 画像未挿入状態 ──
  if (!imageId) {
    return (
      <div
        ref={containerRef}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileRef.current?.click()}
        className={`my-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400 hover:bg-gray-50"
        }`}
      >
        <ImagePlus size={28} className="mx-auto mb-2 text-gray-400" />
        <p className="text-sm text-gray-500">
          {loading ? "読み込み中..." : "画像をドロップ、またはクリックして選択"}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          className="hidden"
        />
      </div>
    );
  }

  // ── 画像表示 ──
  return (
    <div
      ref={containerRef}
      className="my-2 group relative"
      style={{ width: widthProp || "100%" }}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {loading && !objectUrl && (
        <div className="rounded border border-gray-200 p-8 text-center text-gray-400 text-sm">
          読み込み中...
        </div>
      )}
      {objectUrl && (
        <>
          <img
            src={objectUrl}
            alt={alt}
            className="rounded max-w-full"
            style={{ width: "100%", height: "auto" }}
          />
          {/* ホバー時ツールバー */}
          <div className="absolute top-2 right-2 hidden group-hover:flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded shadow-sm border border-gray-200 px-1.5 py-1">
            <button onClick={() => setWidth("25%")}
              className={`text-xs px-1.5 py-0.5 rounded ${widthProp === "25%" ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-500"}`}>
              25%
            </button>
            <button onClick={() => setWidth("50%")}
              className={`text-xs px-1.5 py-0.5 rounded ${widthProp === "50%" ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-500"}`}>
              50%
            </button>
            <button onClick={() => setWidth("100%")}
              className={`text-xs px-1.5 py-0.5 rounded ${widthProp === "100%" || !widthProp ? "bg-blue-100 text-blue-600" : "hover:bg-gray-100 text-gray-500"}`}>
              100%
            </button>
            <div className="w-px h-3 bg-gray-200" />
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              placeholder="alt テキスト"
              className="text-xs w-24 px-1 py-0.5 border border-gray-200 rounded outline-none bg-white"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  );
}

// ── Block Spec ────────────────────────────────────────────────────────

export const imageBlockSpec = createReactBlockSpec(
  {
    type: "image" as const,
    propSchema: {
      imageId: { default: "" },
      alt: { default: "" },
      width: { default: "100%" },
    },
    content: "none" as const,
  },
  {
    render: ({ block, editor }) => <ImageView block={block} editor={editor} />,
  }
);
