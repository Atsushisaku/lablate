/**
 * SyncManager: localStorage ↔ ローカルフォルダの同期管理
 * - localStorage への書き込みを監視
 * - デバウンス（2秒）後にファイルに書き出し
 * - フォルダからの読み込み
 */

import { FSProvider } from "./fs-provider";
import {
  loadTree, saveTree, loadDoc, loadDataset,
  loadDatasetRegistry, loadTabState,
  saveDoc, saveDataset, saveDatasetRegistry, saveTabState, saveTree as saveTreeLocal,
  PageTree, Dataset, DatasetMeta, TabState, ROOT_ID,
} from "../storage";
import { imageStore } from "./image-store";
import { blocksToMarkdown, datasetToCsv, csvToDataset } from "./markdown-export";
import { PartialBlock } from "@blocknote/core";

// ── プロジェクト JSON 型 ────────────────────────────────────────────

export interface ProjectJson {
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  tree: PageTree;
  datasetRegistry: DatasetMeta[];
  tabs: TabState | null;
}

// ── SyncManager ─────────────────────────────────────────────────────

export type SyncStatus = "disconnected" | "idle" | "saving" | "loading";

type Listener = (status: SyncStatus) => void;

export class SyncManager {
  private fs: FSProvider;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _status: SyncStatus = "disconnected";
  private listeners = new Set<Listener>();
  private storageHandler: ((e: StorageEvent) => void) | null = null;

  constructor(fs: FSProvider) {
    this.fs = fs;
  }

  // ── ステータス管理 ────────────────────────────────────────────────

  get status(): SyncStatus {
    return this._status;
  }

  private setStatus(s: SyncStatus) {
    this._status = s;
    this.listeners.forEach((fn) => fn(s));
  }

  onStatusChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ── 同期の開始 / 停止 ─────────────────────────────────────────────

  start(): void {
    if (!this.fs.isConnected()) return;
    this.setStatus("idle");

    // localStorage の変更を監視（他タブからの変更検知用）
    this.storageHandler = (e: StorageEvent) => {
      if (e.key?.startsWith("lablate_")) {
        this.scheduleSync(e.key);
      }
    };
    window.addEventListener("storage", this.storageHandler);
  }

  stop(): void {
    // 全デバウンスタイマーをクリア
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.storageHandler) {
      window.removeEventListener("storage", this.storageHandler);
      this.storageHandler = null;
    }
    this.setStatus("disconnected");
  }

  // ── 変更通知（コンポーネントから呼ぶ） ────────────────────────────

  /** 特定キーの変更をスケジュール（2秒デバウンス） */
  notifyChange(key: string): void {
    if (!this.fs.isConnected()) return;
    this.scheduleSync(key);
  }

  private scheduleSync(key: string): void {
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      this.syncKey(key);
    }, 2000);
    this.debounceTimers.set(key, timer);
  }

  // ── キー別の同期処理 ──────────────────────────────────────────────

  private async syncKey(key: string): Promise<void> {
    if (!this.fs.isConnected()) return;
    this.setStatus("saving");
    try {
      if (key === "lablate_tree" || key === "lablate_datasets" || key === "lablate_tabs") {
        await this.saveProjectJson();
      } else if (key.startsWith("lablate_doc_")) {
        const pageId = key.replace("lablate_doc_", "");
        await this.savePage(pageId);
      } else if (key.startsWith("lablate_dataset_")) {
        const datasetId = key.replace("lablate_dataset_", "");
        await this.saveDataset(datasetId);
      } else if (key.startsWith("lablate_chart_config_")) {
        const blockId = key.replace("lablate_chart_config_", "");
        await this.saveChartConfig(blockId);
      }
    } catch (err) {
      console.error("[SyncManager] sync error:", key, err);
    }
    this.setStatus("idle");
  }

  // ── 個別書き出し ──────────────────────────────────────────────────

  private async saveProjectJson(): Promise<void> {
    const tree = loadTree();
    const registry = loadDatasetRegistry();
    const tabs = loadTabState();

    const existing = await this.fs.readText("project.json");
    let createdAt = new Date().toISOString();
    let name = "Lablate Project";
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as ProjectJson;
        createdAt = parsed.createdAt;
        name = parsed.name;
      } catch { /* ignore */ }
    }

    const project: ProjectJson = {
      version: 1,
      name,
      createdAt,
      updatedAt: new Date().toISOString(),
      tree,
      datasetRegistry: registry,
      tabs,
    };

    await this.fs.writeText("project.json", JSON.stringify(project, null, 2));
  }

  private async savePage(pageId: string): Promise<void> {
    const blocks = loadDoc(pageId);
    if (!blocks) return;

    const tree = loadTree();
    const page = tree[pageId];
    const title = page?.title;

    await this.fs.ensureDir(`pages/${pageId}`);
    await this.fs.writeText(
      `pages/${pageId}/document.json`,
      JSON.stringify(blocks, null, 2),
    );
    await this.fs.writeText(
      `pages/${pageId}/document.md`,
      blocksToMarkdown(blocks, tree, title),
    );
  }

  private async saveDataset(datasetId: string): Promise<void> {
    const data = loadDataset(datasetId);
    if (!data) return;

    await this.fs.ensureDir("datasets");
    await this.fs.writeText(
      `datasets/${datasetId}.csv`,
      datasetToCsv(data.headers, data.rows),
    );

    // テーブル設定も保存
    const cfgRaw = localStorage.getItem(`lablate_table_cfg_${datasetId}`);
    if (cfgRaw) {
      await this.fs.writeText(`datasets/${datasetId}.json`, cfgRaw);
    }
  }

  private async saveChartConfig(blockId: string): Promise<void> {
    const raw = localStorage.getItem(`lablate_chart_config_${blockId}`);
    if (!raw) return;

    await this.fs.ensureDir("charts");
    await this.fs.writeText(`charts/${blockId}.json`, raw);

    // グラフ画像は chartImageToExport イベント経由で別途保存
  }

  /** グラフ PNG を保存（外部から呼ぶ） */
  async saveChartImage(blockId: string, blob: Blob): Promise<void> {
    if (!this.fs.isConnected()) return;
    await this.fs.ensureDir("charts");
    await this.fs.writeBlob(`charts/${blockId}.png`, blob);
  }

  /** 画像を保存 */
  async saveImage(imageId: string, blob: Blob, meta: object): Promise<void> {
    if (!this.fs.isConnected()) return;
    await this.fs.ensureDir("images");
    const ext = (meta as { mimeType?: string }).mimeType === "image/png" ? "png" : "jpg";
    await this.fs.writeBlob(`images/${imageId}.${ext}`, blob);
    await this.fs.writeText(`images/${imageId}.json`, JSON.stringify(meta, null, 2));
  }

  // ── 全データ書き出し ──────────────────────────────────────────────

  async saveToFolder(): Promise<void> {
    if (!this.fs.isConnected()) return;
    this.setStatus("saving");
    try {
      // project.json
      await this.saveProjectJson();

      // 全ページ
      const tree = loadTree();
      const pageIds = Object.keys(tree).filter((id) => id !== ROOT_ID);
      for (const pageId of pageIds) {
        await this.savePage(pageId);
      }

      // 全データセット
      const registry = loadDatasetRegistry();
      for (const meta of registry) {
        await this.saveDataset(meta.id);
      }

      // 全グラフ設定
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("lablate_chart_config_")) {
          const blockId = key.replace("lablate_chart_config_", "");
          await this.saveChartConfig(blockId);
        }
      }

      // 全画像
      const images = await imageStore.list();
      for (const meta of images) {
        const record = await imageStore.load(meta.id);
        if (record) {
          await this.saveImage(meta.id, record.blob, record.meta);
        }
      }
    } catch (err) {
      console.error("[SyncManager] saveToFolder error:", err);
    }
    this.setStatus("idle");
  }

  // ── フォルダから全データ読み込み ──────────────────────────────────

  async loadFromFolder(): Promise<void> {
    if (!this.fs.isConnected()) return;
    this.setStatus("loading");
    try {
      // project.json
      const projectRaw = await this.fs.readText("project.json");
      if (!projectRaw) {
        this.setStatus("idle");
        return;
      }
      const project = JSON.parse(projectRaw) as ProjectJson;
      saveTreeLocal(project.tree);
      if (project.datasetRegistry) saveDatasetRegistry(project.datasetRegistry);
      if (project.tabs) saveTabState(project.tabs);

      // ページ
      const pageEntries = await this.fs.listDir("pages");
      for (const entry of pageEntries) {
        if (entry.kind !== "directory") continue;
        const pageId = entry.name;
        const docRaw = await this.fs.readText(`pages/${pageId}/document.json`);
        if (docRaw) {
          const blocks = JSON.parse(docRaw) as PartialBlock[];
          saveDoc(pageId, blocks);
        }
      }

      // データセット
      const datasetEntries = await this.fs.listDir("datasets");
      for (const entry of datasetEntries) {
        if (entry.kind !== "file") continue;
        if (entry.name.endsWith(".csv")) {
          const datasetId = entry.name.replace(".csv", "");
          const csvRaw = await this.fs.readText(`datasets/${entry.name}`);
          if (csvRaw) {
            const { headers, rows } = csvToDataset(csvRaw);
            saveDataset(datasetId, { headers, rows });
          }
        }
        if (entry.name.endsWith(".json")) {
          const datasetId = entry.name.replace(".json", "");
          const cfgRaw = await this.fs.readText(`datasets/${entry.name}`);
          if (cfgRaw) {
            localStorage.setItem(`lablate_table_cfg_${datasetId}`, cfgRaw);
          }
        }
      }

      // グラフ設定
      const chartEntries = await this.fs.listDir("charts");
      for (const entry of chartEntries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".json")) continue;
        const blockId = entry.name.replace(".json", "");
        const raw = await this.fs.readText(`charts/${entry.name}`);
        if (raw) {
          localStorage.setItem(`lablate_chart_config_${blockId}`, raw);
        }
      }

      // 画像
      const imageEntries = await this.fs.listDir("images");
      for (const entry of imageEntries) {
        if (entry.kind !== "file") continue;
        if (entry.name.endsWith(".json")) {
          // メタデータは blob と一緒に保存するので後で処理
          continue;
        }
        const imageId = entry.name.replace(/\.(jpg|png|jpeg)$/, "");
        const blob = await this.fs.readBlob(`images/${entry.name}`);
        const metaRaw = await this.fs.readText(`images/${imageId}.json`);
        if (blob && metaRaw) {
          const meta = JSON.parse(metaRaw);
          await imageStore.save(imageId, blob, meta);
        }
      }
    } catch (err) {
      console.error("[SyncManager] loadFromFolder error:", err);
    }
    this.setStatus("idle");
  }

  // ── project.json の存在確認 ───────────────────────────────────────

  async hasProjectFile(): Promise<boolean> {
    return this.fs.exists("project.json");
  }
}
