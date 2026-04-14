import { PartialBlock } from "@blocknote/core";

// ── 将来の差し替えポイント ──────────────────────────────────────────

export interface StorageProvider {
  docs: DocStorage;
  datasets: DatasetStorage;
  images: ImageStorage;
}

export interface DocStorage {
  load(pageId: string): PartialBlock[] | undefined;
  save(pageId: string, content: PartialBlock[]): void;
  delete(pageId: string): void;
}

export interface DatasetStorage {
  load(id: string): Dataset | null;
  save(id: string, data: Dataset): void;
  delete(id: string): void;
}

export interface ImageStorage {
  save(id: string, blob: Blob, meta: ImageMeta): Promise<void>;
  load(id: string): Promise<{ blob: Blob; meta: ImageMeta } | null>;
  delete(id: string): Promise<void>;
  list(): Promise<ImageMeta[]>;
}

// ── 共有型 ──────────────────────────────────────────────────────────

export interface Dataset {
  headers: string[];
  rows: string[][];
}

export interface ImageMeta {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;       // bytes（圧縮後）
  createdAt: string;  // ISO 8601
}
