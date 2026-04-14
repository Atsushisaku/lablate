/**
 * File System Access API ラッパー
 * ローカルフォルダへの読み書きを担当する
 */

// ── 型定義（File System Access API の型補完） ────────────────────────

interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string | { type: string; data?: unknown; position?: number; size?: number }): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: "read" | "readwrite";
      startIn?: string;
    }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }
}

// ── FSProvider ────────────────────────────────────────────────────────

export class FSProvider {
  private dirHandle: FileSystemDirectoryHandle | null = null;

  /** File System Access API がサポートされているか */
  static isSupported(): boolean {
    return typeof window !== "undefined" && "showDirectoryPicker" in window;
  }

  /** フォルダ選択ダイアログを開いて接続 */
  async connect(): Promise<boolean> {
    if (!FSProvider.isSupported()) return false;
    try {
      this.dirHandle = await window.showDirectoryPicker!({
        id: "lablate-project",
        mode: "readwrite",
      });
      return true;
    } catch {
      // ユーザーがキャンセルした場合
      return false;
    }
  }

  /** 保存済みハンドルで権限を再取得（ブラウザ再起動後） */
  async reconnect(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
      const permission = await (handle as unknown as { queryPermission(d: { mode: string }): Promise<string> })
        .queryPermission({ mode: "readwrite" });
      if (permission === "granted") {
        this.dirHandle = handle;
        return true;
      }
      const request = await (handle as unknown as { requestPermission(d: { mode: string }): Promise<string> })
        .requestPermission({ mode: "readwrite" });
      if (request === "granted") {
        this.dirHandle = handle;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** 接続中かどうか */
  isConnected(): boolean {
    return this.dirHandle !== null;
  }

  /** 接続中のフォルダ名 */
  getFolderName(): string | null {
    return this.dirHandle?.name ?? null;
  }

  /** ディレクトリハンドルを取得（IndexedDB に保存して再接続に使う） */
  getHandle(): FileSystemDirectoryHandle | null {
    return this.dirHandle;
  }

  /** 切断 */
  disconnect(): void {
    this.dirHandle = null;
  }

  // ── ファイル操作 ──────────────────────────────────────────────────

  /** サブディレクトリを再帰的に取得・作成 */
  private async getDir(
    path: string,
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    if (!this.dirHandle) return null;
    const parts = path.split("/").filter(Boolean);
    let current = this.dirHandle;
    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }
    return current;
  }

  /** フォルダ作成（再帰） */
  async ensureDir(path: string): Promise<void> {
    await this.getDir(path, true);
  }

  /** テキストファイル書き込み */
  async writeText(path: string, data: string): Promise<void> {
    if (!this.dirHandle) return;
    const { dir, name } = this.splitPath(path);
    const dirHandle = await this.getDir(dir, true);
    if (!dirHandle) return;
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  /** Blob ファイル書き込み */
  async writeBlob(path: string, blob: Blob): Promise<void> {
    if (!this.dirHandle) return;
    const { dir, name } = this.splitPath(path);
    const dirHandle = await this.getDir(dir, true);
    if (!dirHandle) return;
    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  /** テキストファイル読み込み */
  async readText(path: string): Promise<string | null> {
    if (!this.dirHandle) return null;
    const { dir, name } = this.splitPath(path);
    const dirHandle = await this.getDir(dir);
    if (!dirHandle) return null;
    try {
      const fileHandle = await dirHandle.getFileHandle(name);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  /** Blob ファイル読み込み */
  async readBlob(path: string): Promise<Blob | null> {
    if (!this.dirHandle) return null;
    const { dir, name } = this.splitPath(path);
    const dirHandle = await this.getDir(dir);
    if (!dirHandle) return null;
    try {
      const fileHandle = await dirHandle.getFileHandle(name);
      return await fileHandle.getFile();
    } catch {
      return null;
    }
  }

  /** ファイルの存在確認 */
  async exists(path: string): Promise<boolean> {
    if (!this.dirHandle) return false;
    const { dir, name } = this.splitPath(path);
    const dirHandle = await this.getDir(dir);
    if (!dirHandle) return null as unknown as boolean;
    try {
      await dirHandle.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  /** ディレクトリ内のエントリ一覧 */
  async listDir(path: string): Promise<{ name: string; kind: "file" | "directory" }[]> {
    const dirHandle = path ? await this.getDir(path) : this.dirHandle;
    if (!dirHandle) return [];
    const entries: { name: string; kind: "file" | "directory" }[] = [];
    for await (const [name, handle] of (dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      entries.push({ name, kind: handle.kind as "file" | "directory" });
    }
    return entries;
  }

  // ── ユーティリティ ────────────────────────────────────────────────

  private splitPath(path: string): { dir: string; name: string } {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop()!;
    return { dir: parts.join("/"), name };
  }
}

// ── シングルトンインスタンス ──────────────────────────────────────────

export const fsProvider = new FSProvider();

// ── IndexedDB にフォルダハンドルを永続化 ─────────────────────────────

const HANDLE_DB = "lablate_fs_handle";
const HANDLE_STORE = "handles";

function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, "project");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get("project");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearDirHandle(): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete("project");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
