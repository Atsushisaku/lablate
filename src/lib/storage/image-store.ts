import { ImageStorage, ImageMeta } from "./types";

const DB_NAME = "lablate_images";
const STORE_NAME = "images";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── IndexedDB 実装 ──────────────────────────────────────────────────

export const imageStore: ImageStorage = {
  async save(id, blob, meta) {
    const db = await openDB();
    await reqToPromise(tx(db, "readwrite").put({ id, blob, meta }));
  },

  async load(id) {
    const db = await openDB();
    const record = await reqToPromise(tx(db, "readonly").get(id));
    if (!record) return null;
    return { blob: record.blob as Blob, meta: record.meta as ImageMeta };
  },

  async delete(id) {
    const db = await openDB();
    await reqToPromise(tx(db, "readwrite").delete(id));
  },

  async list() {
    const db = await openDB();
    const all = await reqToPromise(tx(db, "readonly").getAll());
    return (all as { meta: ImageMeta }[]).map((r) => r.meta);
  },
};

// ── 画像圧縮ユーティリティ ──────────────────────────────────────────

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.8;

export async function compressImage(file: File | Blob): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const bitmap = await createImageBitmap(file);
  const { width: origW, height: origH } = bitmap;

  let w = origW;
  let h = origH;
  if (w > MAX_WIDTH) {
    h = Math.round(h * (MAX_WIDTH / w));
    w = MAX_WIDTH;
  }

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  // 透過画像（PNG）はそのまま PNG で保存
  const isTransparent =
    file instanceof File && file.type === "image/png";
  const mimeType = isTransparent ? "image/png" : "image/jpeg";
  const quality = isTransparent ? undefined : JPEG_QUALITY;

  const blob = await canvas.convertToBlob({ type: mimeType, quality });
  return { blob, width: w, height: h };
}
