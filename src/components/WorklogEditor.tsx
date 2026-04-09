"use client";

import { useEffect, useMemo, useCallback } from "react";
import { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { loadDoc, saveDoc } from "@/lib/storage";

interface Props {
  pageId: string;
}

export default function WorklogEditor({ pageId }: Props) {
  const editor = useMemo(() => {
    const initialContent = loadDoc(pageId);
    return BlockNoteEditor.create({ initialContent });
  }, [pageId]);

  const handleChange = useCallback(() => {
    saveDoc(pageId, editor.document as PartialBlock[]);
  }, [editor, pageId]);

  useEffect(() => {
    editor.onChange(handleChange);
  }, [editor, handleChange]);

  return (
    <BlockNoteView
      editor={editor}
      theme="light"
      className="min-h-screen"
    />
  );
}
