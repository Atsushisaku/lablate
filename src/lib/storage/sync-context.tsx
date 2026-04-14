"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from "react";
import { FSProvider, fsProvider, saveDirHandle, loadDirHandle, clearDirHandle } from "./fs-provider";
import { SyncManager, SyncStatus } from "./sync-manager";

interface SyncContextValue {
  /** File System Access API がサポートされているか */
  isSupported: boolean;
  /** フォルダ接続中か */
  isConnected: boolean;
  /** 同期ステータス */
  status: SyncStatus;
  /** 接続中のフォルダ名 */
  folderName: string | null;
  /** フォルダ選択ダイアログを開いて接続 */
  connect: () => Promise<void>;
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
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [folderName, setFolderName] = useState<string | null>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const isSupported = FSProvider.isSupported();

  // SyncManager の初期化
  useEffect(() => {
    const manager = new SyncManager(fsProvider);
    syncManagerRef.current = manager;
    const unsub = manager.onStatusChange(setStatus);

    // 保存済みハンドルで自動再接続を試みる
    (async () => {
      const handle = await loadDirHandle();
      if (handle) {
        const ok = await fsProvider.reconnect(handle);
        if (ok) {
          setIsConnected(true);
          setFolderName(fsProvider.getFolderName());
          manager.start();
        }
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

  const disconnect = useCallback(() => {
    syncManagerRef.current?.stop();
    fsProvider.disconnect();
    clearDirHandle();
    setIsConnected(false);
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
        status,
        folderName,
        connect,
        disconnect,
        notifyChange,
        saveChartImage,
        exportZip,
        importZip,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}
