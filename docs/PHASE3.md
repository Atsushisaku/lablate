# Lablate - Phase 3 仕様書

## 目標

画像挿入機能の追加と、SaaS化に向けたストレージ抽象化を行う。
ローカル（IndexedDB）で完動する状態を作り、将来 OneDrive / サーバーバックエンドに差し替え可能な設計にする。

---

## 背景・方針

### サービスとしての方向性

- サブスクリプションモデルでの SaaS 提供を目指す
- Windows 依存の企業が多いため、OneDrive 連携を重視
- 保存データを LLM で活用（資料作成等）しやすい構造にする
- 実験データはクローズドに扱いたいというニーズに対応
- 導入のしやすさが最重要（ブラウザで完結、インストール不要）

### ストレージ設計の段階的移行

```
Phase 2（現在）: localStorage 直接呼び出し
    ↓
Phase 3（今回）: ストレージ抽象化 + IndexedDB（画像のみ）
    ↓
Phase 4（将来）: 全データを StorageProvider 経由に統一
                  → OneDrive / S3 / サーバー実装に差し替え
```

---

## ストレージ抽象化

### ディレクトリ構成

```
src/lib/storage/
  ├─ types.ts          ← ストレージインターフェース定義
  ├─ local.ts          ← 既存の localStorage 関数群（storage.ts から移動）
  └─ image-store.ts    ← 画像用 IndexedDB 実装（新規、インターフェース準拠）
```

### インターフェース定義（types.ts）

```typescript
// 将来の差し替えポイント
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

export interface ImageMeta {
  id: string;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  size: number;       // bytes（圧縮後）
  createdAt: string;  // ISO 8601
}
```

### 移行方針

- **既存コード（localStorage）**: `local.ts` に移動するが、呼び出し側は今回は変更しない。`src/lib/storage.ts` からの re-export で互換性を維持
- **画像のみ**: `ImageStorage` インターフェース経由で IndexedDB 実装を使用
- **将来**: SaaS 基盤構築時に全データを `StorageProvider` 経由に統一

---

## 画像ブロック（ImageBlock）

### 基本機能

- ドキュメント内に画像を挿入・表示する BlockNote カスタムブロック
- 画像データは IndexedDB に Blob として保存
- ブロックの props には `imageId`（UUID）のみを持つ

### 挿入方法

| 方法 | 説明 |
|------|------|
| ドラッグ&ドロップ | エディタ領域に画像ファイルをドロップ |
| クリップボードペースト | スクリーンショット等を Ctrl+V で貼り付け |
| ファイル選択 | ツールバーまたは `/` メニューからファイルピッカーを起動 |

### 画像処理フロー

```
入力（D&D / ペースト / ファイル選択）
  ↓
クライアント側でリサイズ・圧縮
  - Canvas API で最大幅 1600px にリサイズ
  - JPEG 80% 品質で圧縮（元が PNG/WebP でも JPEG に変換）
  - 透過画像（PNG）はそのまま PNG で保存
  ↓
IndexedDB に保存
  - DB名: "lablate_images"
  - ストア: "images"
  - キー: imageId（UUID）
  - 値: { blob: Blob, meta: ImageMeta }
  ↓
レンダリング
  - URL.createObjectURL(blob) で表示
  - コンポーネントアンマウント時に revokeObjectURL で解放
```

### 想定サイズ

- スマホ写真（3〜5MB）→ 圧縮後 200〜400KB
- スクリーンショット → 圧縮後 50〜200KB
- IndexedDB の容量上限は一般的に数百MB〜数GB（ブラウザ依存）

### ブロック構造

```typescript
createReactBlockSpec({
  type: "image",
  propSchema: {
    imageId: { default: "" },
    alt: { default: "" },        // 代替テキスト
    width: { default: "100%" },  // 表示幅（CSS値）
  },
  content: "none",
})
```

### UI コンポーネント

**未挿入状態（imageId が空）：**
- 破線枠のプレースホルダー
- 「画像をドロップ、またはクリックして選択」テキスト
- クリックでファイルピッカーを起動

**挿入済み：**
- 画像をレンダリング
- ホバー時にツールバー表示
  - 代替テキスト編集
  - 幅リサイズ（25% / 50% / 100%）
  - 削除ボタン

### データ永続化

| 保存先 | キー | 内容 |
|--------|------|------|
| IndexedDB `lablate_images` | `imageId` | `{ blob, meta }` |
| BlockNote ドキュメント（localStorage） | ブロック props | `{ imageId, alt, width }` |

---

## エクスポート対応（将来）

画像を含むドキュメントのエクスポート方針：

- IndexedDB から全画像 Blob を取得
- ドキュメント JSON + 画像ファイルを ZIP にまとめてダウンロード
- または Markdown + 画像フォルダの形式で出力（LLM 活用に適する）

```
export/
  ├─ document.md          ← Markdown 本文（画像は相対パスで参照）
  ├─ document.json        ← BlockNote 形式（復元用）
  ├─ data/
  │   └─ dataset-xxx.csv  ← テーブルデータ
  └─ images/
      ├─ img-aaa.jpg
      └─ img-bbb.jpg
```

---

## 完了条件

- [ ] ストレージインターフェース（types.ts）を定義
- [ ] 既存 localStorage 関数を storage/local.ts に移動（re-export で互換維持）
- [ ] IndexedDB 画像ストレージを実装（image-store.ts）
- [ ] ImageBlock カスタムブロックを実装
- [ ] ドラッグ&ドロップで画像を挿入できる
- [ ] クリップボードペーストで画像を挿入できる
- [ ] `/` メニュー・ファイル選択で画像を挿入できる
- [ ] 画像がリサイズ・圧縮されて IndexedDB に保存される
- [ ] ページリロード後も画像が表示される
- [ ] 画像ブロックの幅変更ができる

---

## スコープ外（Phase 4 以降）

- OneDrive 連携・Microsoft 認証
- サーバーサイド画像ストレージ（S3 / R2）
- 全ストレージの StorageProvider 統一移行
- 共同編集・リアルタイム同期
- LLM 統合（記録の要約・報告書自動生成）
- エクスポート / バックアップ機能の実装
