# Lablate - Phase 4 仕様書

## 目標

ブラウザの File System Access API を利用し、ローカルフォルダへの自動保存・読み込みを実現する。
**Lablate はローカルファイルシステムにのみアクセスし、外部サービスとの通信は一切行わない**。
結果として、ユーザーが OneDrive / Google Drive 等の同期フォルダを保存先に指定した場合は、OS レベルの同期機能によりクラウド同期・複数 PC 間の共有が実現される。

---

## 背景・方針

### データ主権の設計思想

- 研究機関ではデータの保存先に厳格なポリシーがある
- Lablate はデータを一切預からない（Lablate サーバーへのデータ送信なし）
- データの保存先は各機関が管理する場所（ローカル / OneDrive / SharePoint 等）
- ファイルベースで保存することで、Excel / Word と同じ運用感を実現

### OneDrive 同期フォルダの扱い（重要）

本フェーズでは OneDrive の **API 連携（Microsoft Graph API）は行わない**。
Lablate から見える世界はローカルのファイルシステムのみであり、そのフォルダが OneDrive 同期対象かどうかは Lablate は一切関知しない。

| 項目 | Phase 4 の方式 | 将来の Graph API 連携（予定なし） |
|---|---|---|
| Lablate 側の通信 | なし（ローカル I/O のみ） | Microsoft API を直接呼び出し |
| 認証 | 不要 | OAuth 2.0 必須 |
| ユーザーの追加操作 | OneDrive クライアントが自動同期 | アプリ内でアカウント連携 |
| 情シス承認観点 | ローカルアプリと同等 | 外部 API 連携アプリ扱い |

情シス説明時は「Lablate はローカルフォルダへの読み書きのみ行い、外部サービスとの通信は発生しません」と説明できる設計にする。

### ストレージ設計の段階的移行

```
Phase 2: localStorage 直接呼び出し
Phase 3: ストレージ抽象化 + IndexedDB（画像）
Phase 4（今回）: File System Access API でローカルフォルダ同期
              localStorage はオフラインキャッシュとして併用
Phase 5 以降: ローカル保存を維持しつつ、認証・AWS 展開・課金を追加
```

### ブラウザ対応状況

| ブラウザ | File System Access API |
|---------|----------------------|
| Chrome  | 対応 |
| Edge    | 対応 |
| Firefox | 非対応 |
| Safari  | 非対応 |

研究機関は Windows + Edge が主流のため、実用上は問題ない。
非対応ブラウザでは従来通り localStorage のみで動作する（機能劣化、エクスポート/インポートは利用可能）。

---

## 保存フォルダ構造

ユーザーが選択したフォルダ直下に以下の構造で保存する：

```
<選択フォルダ>/
  ├─ project.json              ← プロジェクトメタデータ（ページツリー・タブ状態・データセットレジストリ）
  ├─ pages/
  │   ├─ <pageId>/
  │   │   ├─ document.md       ← Markdown 形式（LLM・PPT 素材向け）
  │   │   └─ document.json     ← BlockNote ブロック配列（Lablate 復元用）
  │   └─ .../
  ├─ datasets/
  │   ├─ <datasetId>.csv       ← テーブルデータ（Excel 等でも開ける）
  │   └─ <datasetId>.json      ← テーブル設定（タイトル、折りたたみ状態等）
  ├─ charts/
  │   ├─ <blockId>.png         ← グラフ画像（Plotly.toImage で自動生成、PPT 向け）
  │   └─ <blockId>.json        ← グラフ設定（軸・回帰・サイズ等、復元用）
  └─ images/
      ├─ <imageId>.jpg         ← 挿入画像（IndexedDB から書き出し）
      └─ <imageId>.json        ← 画像メタデータ（alt, width, mimeType 等）
```

### project.json の構造

```typescript
{
  version: 1,                          // スキーマバージョン（将来の互換性用）
  name: string,                        // プロジェクト名
  createdAt: string,                   // ISO 8601
  updatedAt: string,                   // ISO 8601
  tree: PageTree,                      // ページツリー（既存の lablate_tree と同一構造）
  datasetRegistry: DatasetMeta[],      // データセット一覧
  tabs: TabState,                      // タブ状態
}
```

### Markdown 出力仕様（document.md）

BlockNote ブロック配列から Markdown に変換して保存する。LLM に渡す素材として使える形式を重視。

- 見出し → `#` / `##` / `###`
- テキスト → そのまま（インラインスタイルは Markdown 記法に変換）
- 箇条書き → `- `
- 番号リスト → `1. `
- テーブルブロック → `[テーブル: <タイトル>](../datasets/<datasetId>.csv)` （リンク形式で参照）
- グラフブロック → `![<タイトル>](../charts/<blockId>.png)` （画像参照）
- 画像ブロック → `![<alt>](../images/<imageId>.jpg)`
- ページリンク → `[<ページタイトル>](../<pageId>/document.md)`

### グラフ画像の自動生成

- 保存時に `Plotly.toImage()` で PNG 画像を生成し `charts/` に書き出す
- 解像度: 2x（Retina対応、PPT でも綺麗に表示される）
- グラフの設定変更・データ変更時に画像も再生成

---

## 動作フロー

### 初回接続

```
ユーザーが「フォルダを選択」ボタンをクリック
  ↓
ブラウザのフォルダ選択ダイアログ（showDirectoryPicker）
  ↓
選択されたフォルダに project.json が存在する？
  ├─ YES → 既存プロジェクトとして読み込み（localStorage に展開）
  └─ NO  → 新規プロジェクトとして初期化（現在の localStorage をファイルに書き出し）
```

### 自動保存（編集 → ファイル）

```
localStorage への保存（既存の動作、変更なし）
  ↓
デバウンス（2秒間の無操作を待つ）
  ↓
変更されたデータのみフォルダに書き出し
  ├─ ページ編集 → pages/<pageId>/document.json + document.md を更新
  ├─ テーブル編集 → datasets/<datasetId>.csv を更新
  ├─ グラフ設定変更 → charts/<blockId>.json + .png を更新
  └─ ページツリー変更 → project.json を更新
```

### 再接続（ブラウザ再起動後）

```
Lablate を開く
  ↓
localStorage にキャッシュがある → そのまま表示（即座に使える）
  ↓
「フォルダに再接続」ボタンをクリック（手動）
  ↓
権限の再取得（ブラウザが再度許可を求める）
  ↓
フォルダのファイルと localStorage を比較
  ├─ フォルダの方が新しい → フォルダからロード（別 PC で編集された場合）
  └─ localStorage の方が新しい → フォルダに書き出し
```

### 非接続時の動作

- File System Access API 非対応ブラウザ、またはフォルダ未選択時
- 従来通り localStorage のみで動作（Phase 3 までと同じ）
- エクスポート/インポート機能で手動のファイル入出力は可能（後述）

---

## エクスポート / インポート（フォールバック）

File System Access API が使えない環境向けに、手動のエクスポート/インポートも提供する。

### エクスポート

- 「エクスポート」ボタンで保存フォルダ構造と同一の内容を **ZIP ファイル** としてダウンロード
- ZIP 内の構造はフォルダ保存と完全に同一
- 用途: バックアップ、非対応ブラウザでの運用、他のユーザーへの共有

### インポート

- 「インポート」ボタンで ZIP ファイルを選択
- project.json を読み取り、全データを localStorage + IndexedDB に展開
- 既存データとの競合時はユーザーに確認（上書き / スキップ / キャンセル）

---

## UI 変更

### ヘッダー / サイドバーに追加する要素

- **接続ステータスインジケーター**（ヘッダー右上）
  - 🟢 緑: フォルダ接続中（自動保存有効）
  - 🟡 黄: localStorage のみ（フォルダ未接続）
  - 保存中はスピナーアイコンを表示
- **「フォルダを選択」ボタン**（サイドバー下部 or 設定画面）
  - 未接続時: 「保存先フォルダを選択」
  - 接続中: フォルダ名を表示 + 「切断」ボタン
- **「エクスポート」「インポート」ボタン**（サイドバー下部 or 設定画面）

### 初回起動ガイド

- フォルダ未接続 + 初回起動時に、軽いガイドバナーを表示
  - 「保存先フォルダを選択すると、自動保存が有効になります」
  - 「OneDrive 同期フォルダを選択すると、複数 PC / メンバー間で共有できます」
  - 「後で設定」で閉じられる

---

## 実装設計

### ディレクトリ構成（新規 / 変更）

```
src/lib/storage/
  ├─ types.ts              ← StorageProvider に FileSystemProvider を追加
  ├─ local.ts              ← 既存（変更なし）
  ├─ image-store.ts        ← 既存（変更なし）
  ├─ fs-provider.ts        ← 【新規】File System Access API ラッパー
  ├─ sync-manager.ts       ← 【新規】localStorage ↔ ファイルの同期管理
  ├─ markdown-export.ts    ← 【新規】BlockNote → Markdown 変換
  └─ zip-export.ts         ← 【新規】ZIP エクスポート / インポート
```

### fs-provider.ts

File System Access API のラッパー。フォルダハンドルの管理とファイル読み書きを担当。

```typescript
export class FSProvider {
  private dirHandle: FileSystemDirectoryHandle | null;

  /** フォルダ選択ダイアログを開く */
  async connect(): Promise<boolean>;

  /** 権限の再取得（ブラウザ再起動後） */
  async reconnect(): Promise<boolean>;

  /** 接続状態 */
  isConnected(): boolean;

  /** ファイル書き込み */
  async writeFile(path: string, data: string | Blob): Promise<void>;

  /** ファイル読み込み */
  async readFile(path: string): Promise<string | Blob | null>;

  /** フォルダ作成（再帰） */
  async ensureDir(path: string): Promise<void>;

  /** ファイル一覧取得 */
  async listFiles(path: string): Promise<string[]>;

  /** 切断 */
  disconnect(): void;
}
```

### sync-manager.ts

localStorage の変更を検知し、デバウンス後にファイルへ書き出す。

```typescript
export class SyncManager {
  private fsProvider: FSProvider;
  private debounceTimers: Map<string, number>;

  /** 同期の開始（フォルダ接続後に呼ぶ） */
  start(): void;

  /** 同期の停止（切断時に呼ぶ） */
  stop(): void;

  /** 特定データの即時書き出し */
  async flush(target: "project" | "page" | "dataset" | "chart"): Promise<void>;

  /** フォルダからの全データ読み込み */
  async loadFromFolder(): Promise<void>;

  /** localStorage → フォルダへの全データ書き出し */
  async saveToFolder(): Promise<void>;

  /** 競合検出（タイムスタンプ比較） */
  async detectConflicts(): Promise<ConflictInfo[]>;
}
```

### markdown-export.ts

BlockNote のブロック配列を Markdown テキストに変換する。

```typescript
/** BlockNote ブロック配列 → Markdown 文字列 */
export function blocksToMarkdown(
  blocks: PartialBlock[],
  options: { basePath: string }
): string;
```

### zip-export.ts

```typescript
/** 全プロジェクトデータを ZIP として生成 */
export async function exportProjectZip(): Promise<Blob>;

/** ZIP ファイルからプロジェクトを復元 */
export async function importProjectZip(file: File): Promise<void>;
```

---

## localStorage キーとファイルの対応表

| localStorage キー | ファイルパス | 形式 |
|---|---|---|
| `lablate_tree` | `project.json` 内 `tree` | JSON |
| `lablate_datasets` | `project.json` 内 `datasetRegistry` | JSON |
| `lablate_tabs` | `project.json` 内 `tabs` | JSON |
| `lablate_doc_<pageId>` | `pages/<pageId>/document.json` | JSON |
| （変換生成） | `pages/<pageId>/document.md` | Markdown |
| `lablate_dataset_<datasetId>` | `datasets/<datasetId>.csv` | CSV |
| `lablate_table_cfg_<blockId>` | `datasets/<datasetId>.json` 内 | JSON |
| `lablate_chart_config_<blockId>` | `charts/<blockId>.json` | JSON |
| （Plotly.toImage 生成） | `charts/<blockId>.png` | PNG |
| IndexedDB `lablate_images` | `images/<imageId>.jpg` | JPEG/PNG |
| （ImageMeta） | `images/<imageId>.json` | JSON |
| `lablate_collapsed_<blockId>` | 保存しない（UI 状態のみ） | — |
| `lablate_spreadsheet_split_<id>` | 保存しない（UI 状態のみ） | — |
| `lablate_spreadsheet_charts_<id>` | 保存しない（UI 状態のみ） | — |

---

## 完了条件

### コア機能

- [ ] FSProvider: フォルダ選択・ファイル読み書き・権限再取得
- [ ] SyncManager: localStorage 変更検知 → デバウンス → ファイル書き出し
- [ ] 新規プロジェクト: 現在の localStorage データをフォルダに初期書き出し
- [ ] 既存プロジェクト: フォルダから読み込み → localStorage に展開
- [ ] ブラウザ再起動後の再接続・権限再取得

### ファイル入出力

- [ ] ページ: document.json + document.md の読み書き
- [ ] データセット: CSV 形式での読み書き
- [ ] グラフ: 設定 JSON + Plotly.toImage による PNG 自動生成
- [ ] 画像: IndexedDB ↔ ファイルの双方向同期
- [ ] project.json: ページツリー・データセットレジストリ・タブ状態

### Markdown 変換

- [ ] 見出し・テキスト・リストの Markdown 変換
- [ ] テーブル → CSV リンク参照
- [ ] グラフ → PNG 画像参照
- [ ] 画像 → 画像ファイル参照
- [ ] ページリンク → Markdown リンク

### エクスポート / インポート

- [ ] ZIP エクスポート（フォルダ構造と同一内容）
- [ ] ZIP インポート（競合確認付き）

### UI

- [ ] 接続ステータスインジケーター（ヘッダー）
- [ ] フォルダ選択・切断 UI
- [ ] エクスポート・インポートボタン
- [ ] 初回起動ガイドバナー
- [ ] 非対応ブラウザでのフォールバック表示

### 品質

- [ ] 非対応ブラウザで従来通り localStorage のみで動作する
- [ ] フォルダ未接続時も全機能が使える
- [ ] 大量ページ（50ページ以上）でも保存が遅延しない
- [ ] OneDrive 同期フォルダで動作確認（OS レベルの同期を確認）
- [ ] OneDrive 共有フォルダでの動作確認（交代編集時に競合検出が働く）

---

## スコープ外（Phase 5 以降）

- ユーザー認証（AWS Cognito、Phase 5）
- AWS への本番展開（Phase 5）
- LLM 統合（Markdown → PPT 自動生成、データ分析）
- Microsoft Graph API による OneDrive 直接連携（現時点で予定なし）
- 差分同期（現在は全ファイル書き出し → 将来は変更分のみ）
- バージョン履歴・変更ログ
- 共同編集（OneDrive 共有フォルダでの交代編集を推奨、リアルタイム共同編集は当面スコープ外）
- Electron デスクトップアプリ化
