# Lablate - Product Specification

## 思想・ビジョン

- NotionとJupyter Notebookの中間に位置するツール
- 非エンジニアがコードなしで「記録→計算→可視化→報告書」を一気通貫で完結できる
- PPTによるプレゼンの代替を目指す（Lablate上で報告・共有まで完結）
- データはmd/csvで管理することでLLMフレンドリーな設計を維持
- 将来的にLLMを組み込む

## 対象ユーザー

- 実験・研究に携わる非エンジニア（多少のPC操作はできる）
- ITリテラシーはNotionやExcelを使える程度を想定

## 技術スタック

| 要素 | 採用技術 |
|---|---|
| フレームワーク | Next.js 15 + React 19 |
| ブロックエディタ | BlockNote 0.25 |
| テーブル | Jspreadsheet CE（MIT）|
| 可視化 | Plotly.js（`plotly.js-dist-min`）|
| ストレージ（暫定） | localStorage |
| ストレージ（本番） | OneDrive / Box（Microsoft Graph API） |
| 認証 | Microsoftアカウント（Azure AD）|
| 配布形式 | PWA（ブラウザ動作、iPad/PC対応） |

### テーブルブロックの技術選定理由

スプレッドシートUIの自作を検討したが、以下の理由から **Jspreadsheet Community Edition** を採用した：

- セル参照・数式エンジン・キーボードナビゲーション・範囲選択などの実装難易度が高い
- 自作実装で flushSync（React 19）、stale closure、正規表現など継続的な問題が発生
- Jspreadsheet CE は MIT ライセンスで Excel 互換数式を含む同等機能を提供
- BlockNote カスタムブロックとして `useRef + useEffect` でDOMマウントする形で統合

## データ設計

- 記録本体：Markdownファイル（.md）- 編集しながら報告書に育てる
- データ：CSVファイル（.csv）
- グラフ・計算設定：JSONファイル（.json）- アプリが自動管理、ユーザーは直接触らない
- ファイルはOneDrive上でプロジェクト・作業ごとにフォルダ管理

```
OneDrive/
└── lablate/
    └── project-name/
        ├── worklog.md       ← 記録・報告書（兼用）
        ├── data.csv         ← 実験データ
        └── worklog.json     ← グラフ設定・計算式（内部管理用）
```

### モード設計
- **WYSIWYGエディタ**：BlockNoteで編集しながらそのまま報告書として見える（Excelに近い感覚）
- プレビューモードは不要と判断（編集画面 = 報告書画面）

## フェーズ計画

### フェーズ1：UIデモ
**目標**：見た目が動くデモを作り、実験者にフィードバックをもらう

**必須画面**
- 記録入力画面（BlockNoteブロックエディタ）
- 報告書プレビュー画面

**対応デバイス**
- PC / iPad（フェーズ1から対応）

**データ保存**
- localStorage（仮置き）

**完了条件**
- テキスト・見出し・箇条書きが入力できる
- 報告書プレビューに切り替えられる
- localStorageに保存・復元される
- iPadのブラウザで崩れずに表示される

---

### フェーズ2：可視化UI追加
**目標**：グラフ・表ブロックを追加し、PPT代替としての価値を示す

- CSVを読み込んでテーブル表示・編集できるブロック（Jspreadsheet CE）
- Excel互換数式（SUM / AVERAGE / セル参照 / 範囲指定 等）
- 数式入力中の矢印キーによるセル参照挿入（Google Sheets 風、参照先ハイライト付き）
- Google Sheets ライクなキーボード操作（直接入力、Delete、Ctrl+Z/Y/C/X/V/A）
- テーブルデータからXYプロットグラフを生成（Plotly.js）
- グラフのドラッグリサイズ（PPT風8ハンドル）
- テーブル変更のグラフ自動反映（CustomEvent連携）
- 詳細仕様：[PHASE2.md](./PHASE2.md)

---

### フェーズ3：OneDrive連携・認証
**目標**：組織展開できる状態にする

- Microsoftアカウントでログイン
- OneDriveへのファイル保存・読み込み
- 共有URL発行・閲覧権限管理（OneDrive側に委譲）
- 非同期共同編集対応

---

## 将来構想

- LLM統合（記録の要約・報告書自動生成）
- Box連携
- 実験テンプレート機能
