/**
 * ZIP エクスポート / インポート
 * File System Access API 非対応ブラウザ向けのフォールバック
 */

import JSZip from "jszip";
import {
  loadTree, saveTree, loadDoc, saveDoc, loadDataset, saveDataset,
  loadDatasetRegistry, saveDatasetRegistry, loadTabState, saveTabState,
  ROOT_ID, DatasetMeta, PageTree, TabState,
} from "../storage";
import { imageStore } from "./image-store";
import { ImageMeta } from "./types";
import { blocksToMarkdown, datasetToCsv, csvToDataset } from "./markdown-export";
import type { ProjectJson } from "./sync-manager";
import { PartialBlock } from "@blocknote/core";

// ── エクスポート ────────────────────────────────────────────────────

export async function exportProjectZip(): Promise<Blob> {
  const zip = new JSZip();
  const tree = loadTree();
  const registry = loadDatasetRegistry();
  const tabs = loadTabState();

  // project.json
  const project: ProjectJson = {
    version: 1,
    name: "Lablate Project",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tree,
    datasetRegistry: registry,
    tabs,
  };
  zip.file("project.json", JSON.stringify(project, null, 2));

  // ページ
  const pageIds = Object.keys(tree).filter((id) => id !== ROOT_ID);
  for (const pageId of pageIds) {
    const blocks = loadDoc(pageId);
    if (!blocks) continue;
    const page = tree[pageId];
    zip.file(
      `pages/${pageId}/document.json`,
      JSON.stringify(blocks, null, 2),
    );
    zip.file(
      `pages/${pageId}/document.md`,
      blocksToMarkdown(blocks, tree, page?.title),
    );
  }

  // データセット
  for (const meta of registry) {
    const data = loadDataset(meta.id);
    if (!data) continue;
    zip.file(
      `datasets/${meta.id}.csv`,
      datasetToCsv(data.headers, data.rows),
    );
    const cfgRaw = localStorage.getItem(`lablate_table_cfg_${meta.id}`);
    if (cfgRaw) {
      zip.file(`datasets/${meta.id}.json`, cfgRaw);
    }
  }

  // グラフ設定
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("lablate_chart_config_")) {
      const blockId = key.replace("lablate_chart_config_", "");
      const raw = localStorage.getItem(key);
      if (raw) {
        zip.file(`charts/${blockId}.json`, raw);
      }
    }
  }

  // 画像
  const images = await imageStore.list();
  for (const meta of images) {
    const record = await imageStore.load(meta.id);
    if (!record) continue;
    const ext = meta.mimeType === "image/png" ? "png" : "jpg";
    zip.file(`images/${meta.id}.${ext}`, record.blob);
    zip.file(`images/${meta.id}.json`, JSON.stringify(record.meta, null, 2));
  }

  return zip.generateAsync({ type: "blob" });
}

// ── インポート ──────────────────────────────────────────────────────

export async function importProjectZip(file: File): Promise<{
  success: boolean;
  pageCount: number;
  datasetCount: number;
  imageCount: number;
}> {
  const zip = await JSZip.loadAsync(file);
  let pageCount = 0;
  let datasetCount = 0;
  let imageCount = 0;

  // project.json
  const projectFile = zip.file("project.json");
  if (!projectFile) {
    return { success: false, pageCount: 0, datasetCount: 0, imageCount: 0 };
  }
  const projectRaw = await projectFile.async("string");
  const project = JSON.parse(projectRaw) as ProjectJson;

  saveTree(project.tree);
  if (project.datasetRegistry) saveDatasetRegistry(project.datasetRegistry);
  if (project.tabs) saveTabState(project.tabs);

  // ページ
  const pageFolder = zip.folder("pages");
  if (pageFolder) {
    const pageIds = new Set<string>();
    pageFolder.forEach((relativePath) => {
      const parts = relativePath.split("/");
      if (parts[0]) pageIds.add(parts[0]);
    });
    for (const pageId of pageIds) {
      const docFile = zip.file(`pages/${pageId}/document.json`);
      if (docFile) {
        const raw = await docFile.async("string");
        const blocks = JSON.parse(raw) as PartialBlock[];
        saveDoc(pageId, blocks);
        pageCount++;
      }
    }
  }

  // データセット
  const datasetFolder = zip.folder("datasets");
  if (datasetFolder) {
    const csvFiles: string[] = [];
    datasetFolder.forEach((relativePath) => {
      if (relativePath.endsWith(".csv")) csvFiles.push(relativePath);
    });
    for (const csvPath of csvFiles) {
      const datasetId = csvPath.replace(".csv", "");
      const csvFile = zip.file(`datasets/${csvPath}`);
      if (csvFile) {
        const raw = await csvFile.async("string");
        const { headers, rows } = csvToDataset(raw);
        saveDataset(datasetId, { headers, rows });
        datasetCount++;
      }
      const cfgFile = zip.file(`datasets/${datasetId}.json`);
      if (cfgFile) {
        const cfgRaw = await cfgFile.async("string");
        localStorage.setItem(`lablate_table_cfg_${datasetId}`, cfgRaw);
      }
    }
  }

  // グラフ設定
  const chartFolder = zip.folder("charts");
  if (chartFolder) {
    chartFolder.forEach(async (relativePath, file) => {
      if (relativePath.endsWith(".json")) {
        const blockId = relativePath.replace(".json", "");
        const raw = await file.async("string");
        localStorage.setItem(`lablate_chart_config_${blockId}`, raw);
      }
    });
  }

  // 画像
  const imageFolder = zip.folder("images");
  if (imageFolder) {
    const metaFiles: string[] = [];
    imageFolder.forEach((relativePath) => {
      if (relativePath.endsWith(".json")) metaFiles.push(relativePath);
    });
    for (const metaPath of metaFiles) {
      const imageId = metaPath.replace(".json", "");
      const metaFile = zip.file(`images/${metaPath}`);
      if (!metaFile) continue;
      const metaRaw = await metaFile.async("string");
      const meta = JSON.parse(metaRaw) as ImageMeta;

      // 画像本体を探す（jpg or png）
      const ext = meta.mimeType === "image/png" ? "png" : "jpg";
      const blobFile = zip.file(`images/${imageId}.${ext}`);
      if (blobFile) {
        const blob = await blobFile.async("blob");
        await imageStore.save(imageId, blob, meta);
        imageCount++;
      }
    }
  }

  return { success: true, pageCount, datasetCount, imageCount };
}

// ── ダウンロードヘルパー ────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
