"use client";

import { useEffect, useMemo, useCallback } from "react";
import { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

const STORAGE_KEY = "lablate_worklog";

function loadFromStorage(): PartialBlock[] | undefined {
  if (typeof window === "undefined") return undefined;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return undefined;
  try {
    return JSON.parse(saved) as PartialBlock[];
  } catch {
    return undefined;
  }
}

export default function WorklogEditor() {
  const editor = useMemo(() => {
    const initialContent = loadFromStorage();
    return BlockNoteEditor.create({ initialContent });
  }, []);

  const handleChange = useCallback(() => {
    const content = editor.document;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
  }, [editor]);

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
