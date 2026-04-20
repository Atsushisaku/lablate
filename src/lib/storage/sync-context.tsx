"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { FSProvider, fsProvider, saveDirHandle, loadDirHandle, clearDirHandle } from "./fs-provider";
import { SyncManager, SyncStatus } from "./sync-manager";

interface SyncContextValue {
  /** File System Access API がサポートされているか */
  isSupported: boolean;
  /** フォルダ接続中か */
  isConnected: boolean;
  /** ハンドルは保存済みだが権限が切れている状態（再接続が必要） */
  needsReconnect: boolean;
  /** 同期ステータス */
  status: SyncStatus;
  /** 接続中（または再接続待ち）のフォルダ名 */
  folderName: string | null;
  /** フォルダ選択ダイアログを開いて接続（新規フォルダ選択） */
  connect: () => Promise<void>;
  /** 保存済みハンドルの権限を再取得して再接続 */
  reconnectExisting: () => Promise<void>;
  /** 切断 */
  disconnect: () => void;
  /** 変更を通知（localStorage キーを渡す） */
  notifyChange: (key: string) => void;
  /** グラフ画像を保存 */
  saveChartImage: (blockId: string, blob: Blob) => Promise<void>;
  /** エクスポート（ZIP） */
  exportZip: () => Promise<void>;
  /** インポート（ZIP） */
  importZip: (file: File) => Promise<{ success: boolean; pageCount: number; datasetCount: number; imageCount: number }>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function useSyncContext(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSyncContext must be used within SyncProvider");
  return ctx;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const pendingHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const isSupported = FSProvider.isSupported();

  // SyncManager の初期化 + 起動時の自動同期
  useEffect(() => {
    const manager = new SyncManager(fsProvider);
    syncManagerRef.current = manager;
    const unsub = manager.onStatusChange(setStatus);

    (async () => {
      try {
        const handle = await loadDirHandle();
        if (!handle) return;

        // 権限が既に付与されている場合のみサイレント再接続
        const ok = await fsProvider.reconnect(handle, true);
        if (ok) {
          // 起動時は常にフォルダから読み込む（他端末の更新を反映）
          const hasProject = await manager.hasProjectFile();
          if (hasProject) {
            await manager.loadFromFolder();
          }
          setFolderName(fsProvider.getFolderName());
          setIsConnected(true);
          manager.start();
        } else {
          // 権限切れ → 再接続待ち
          pendingHandleRef.current = handle;
          setFolderName(handle.name);
          setNeedsReconnect(true);
        }
      } finally {
        setIsInitializing(false);
      }
    })();

    return () => {
      unsub();
      manager.stop();
    };
  }, []);

  const connect = useCallback(async () => {
    const manager = syncManagerRef.current;
    if (!manager) return;

    const ok = await fsProvider.connect();
    if (!ok) return;

    const handle = fsProvider.getHandle();
    if (handle) await saveDirHandle(handle);

    setIsConnected(true);
    setNeedsReconnect(false);
    setFolderName(fsProvider.getFolderName());
    manager.start();

    // 既存プロジェクトか新規か判定
    const hasProject = await manager.hasProjectFile();
    if (hasProject) {
      // フォルダからデータを読み込み
      await manager.loadFromFolder();
      // localStorage を更新したのでリロードしてUIに反映
      window.location.reload();
    } else {
      // 現在のデータをフォルダに書き出し
      await manager.saveToFolder();
    }
  }, []);

  const reconnectExisting = useCallback(async () => {
    const manager = syncManagerRef.current;
    const handle = pendingHandleRef.current;
    if (!manager || !handle) return;

    const ok = await fsProvider.reconnect(handle, false);
    if (!ok) return;

    setIsConnected(true);
    setNeedsReconnect(false);
    setFolderName(fsProvider.getFolderName());
    manager.start();

    const hasProject = await manager.hasProjectFile();
    if (hasProject) {
      await manager.loadFromFolder();
      window.location.reload();
    } else {
      await manager.saveToFolder();
    }
  }, []);

  const disconnect = useCallback(() => {
    syncManagerRef.current?.stop();
    fsProvider.disconnect();
    clearDirHandle();
    pendingHandleRef.current = null;
    setIsConnected(false);
    setNeedsReconnect(false);
    setFolderName(null);
  }, []);

  const notifyChange = useCallback((key: string) => {
    syncManagerRef.current?.notifyChange(key);
  }, []);

  const saveChartImage = useCallback(async (blockId: string, blob: Blob) => {
    await syncManagerRef.current?.saveChartImage(blockId, blob);
  }, []);

  const exportZip = useCallback(async () => {
    const { exportProjectZip, downloadBlob } = await import("./zip-export");
    const blob = await exportProjectZip();
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `lablate-export-${timestamp}.zip`);
  }, []);

  const importZip = useCallback(async (file: File) => {
    const { importProjectZip } = await import("./zip-export");
    return importProjectZip(file);
  }, []);

  return (
    <SyncContext.Provider
      value={{
        isSupported,
        isConnected,
        needsReconnect,
        status,
        folderName,
        connect,
        reconnectExisting,
        disconnect,
        notifyChange,
        saveChartImage,
        exportZip,
        importZip,
      }}
    >
      {isInitializing ? (
        <div className="flex h-screen items-center justify-center bg-white text-sm text-gray-500">
          保存先フォルダから読み込み中...
        </div>
      ) : (
        children
      )}
    </SyncContext.Provider>
  );
}
