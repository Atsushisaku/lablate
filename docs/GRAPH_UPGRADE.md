# グラフ機能アップグレード要件

## 背景

現状のグラフ機能は XY 散布図 + 多項式回帰のみ。
化学・物理・生物系の実験データを扱うラボノートとしては不足している。
本ドキュメントでは **グラフ種別・フィッティング・軸・UI の拡張** と **クロスページ参照によるグラフ挿入** の 2 つを定義する。

---

## 1. グラフ種別の拡張

### 1.1 追加するグラフ種別

| 種別 | 用途例 | 備考 |
|---|---|---|
| **折れ線グラフ (Line)** | 時系列データ、反応速度の経時変化 | 散布図 + 線の接続。マーカー ON/OFF 切替 |
| **棒グラフ (Bar)** | 試料間の比較、収率比較 | 縦棒。グループ化 (grouped) と積み上げ (stacked) を選択可能 |
| **ヒストグラム (Histogram)** | 測定値の分布、粒径分布 | ビン数の手動指定 or 自動 (Sturges / Scott) |
| **箱ひげ図 (Box Plot)** | 測定値のばらつき比較 | 外れ値プロット付き。各列 = 1 グループ |
| **エラーバー付き散布図/折れ線** | 誤差を含む実験データ全般 | 後述 (1.2) |

散布図は現行のまま維持する。種別はツールバーのドロップダウンで切り替え可能とし、切り替え時にデータは保持する。

### 1.2 エラーバー

実験データの標準偏差・標準誤差を表示する。

- **設定方法**: Y 列ごとに「誤差列」を指定（ドロップダウンで列を選択 or 「なし」）
- **対応グラフ**: 散布図、折れ線、棒グラフ
- **表示**: Y 方向のエラーバー（X 方向は Phase 2 では対象外）
- **ChartConfig への追加**:
  ```typescript
  errorColumns: Record<string, string>;  // { [yColumnIndex]: errorColumnIndex }
  ```

### 1.3 ChartConfig 拡張

```typescript
export type ChartConfig = {
  // --- 既存 ---
  xColumn: string;
  yColumns: string[];
  title: string;
  headerRow: string;
  dataStartRow: string;
  dataEndRow: string;
  showDataRange: boolean;
  showLegend: boolean;
  regressionDegree: number;
  regressionColumns: string[];

  // --- 新規 ---
  chartType: "scatter" | "line" | "bar" | "histogram" | "box";
  markerVisible: boolean;         // 折れ線でマーカーを表示するか
  barMode: "group" | "stack";     // 棒グラフのモード
  histogramBins: number | "auto"; // ヒストグラムのビン数
  errorColumns: Record<string, string>;
};
```

デフォルト値:
```typescript
{
  chartType: "scatter",
  markerVisible: true,
  barMode: "group",
  histogramBins: "auto",
  errorColumns: {},
}
```

---

## 2. フィッティング・回帰の拡張

### 2.1 追加するフィッティングモデル

現行は多項式回帰（1〜3 次）のみ。以下を追加する。

| モデル | 式 | 用途例 |
|---|---|---|
| **指数関数** | y = a * exp(b * x) | 放射性崩壊、菌の増殖曲線、一次反応速度 |
| **対数関数** | y = a * ln(x) + b | 対数応答、Weber-Fechner 則 |
| **べき乗関数** | y = a * x^b | アロメトリー、物性のスケーリング則 |
| **4PL (4 パラメータロジスティック)** | y = d + (a - d) / (1 + (x/c)^b) | 用量反応曲線（IC50）、ELISA 標準曲線 |

### 2.2 実装方針

- 多項式: 現行の正規方程式のまま
- 指数・対数・べき乗: 対数変換による線形化 → 最小二乗法
- 4PL: Levenberg-Marquardt（反復最適化）。外部ライブラリの使用可
- 各モデルで R² を算出・表示

### 2.3 UI

- 回帰モデルの選択を「次数セレクタ」から「モデルセレクタ」に変更
  - 選択肢: `多項式(1次)` / `多項式(2次)` / `多項式(3次)` / `指数` / `対数` / `べき乗` / `4PL`
- 系列ごとに異なるモデルを選択可能にする（現行は全系列共通の次数 → 系列ごと独立に変更）
- ChartConfig:
  ```typescript
  // regressionDegree, regressionColumns は廃止し以下に統合
  regressions: Record<string, RegressionModel>;  // { [yColumnIndex]: model }

  type RegressionModel =
    | { type: "poly"; degree: 1 | 2 | 3 }
    | { type: "exp" }
    | { type: "log" }
    | { type: "power" }
    | { type: "4pl" };
  ```

---

## 3. 軸・表示オプションの拡張

### 3.1 対数軸

- X 軸・Y 軸それぞれで線形 / 対数スケールを選択可能
- 用途: pH と反応速度、用量反応、吸光度スペクトルなど
- ChartConfig:
  ```typescript
  xAxisScale: "linear" | "log";
  yAxisScale: "linear" | "log";
  ```

### 3.2 軸ラベル・単位

- X 軸・Y 軸にカスタムラベルを設定可能（現行はヘッダー行から自動生成のみ）
- 入力欄をツールバーの詳細設定に配置
- ChartConfig:
  ```typescript
  xAxisLabel: string;  // 空 = 自動
  yAxisLabel: string;  // 空 = 自動
  ```

### 3.3 軸範囲の手動設定

- X / Y 軸の最小値・最大値を手動入力で指定可能（空 = Plotly の auto range）
- 詳細設定内に配置
- ChartConfig:
  ```typescript
  xAxisMin: string;  xAxisMax: string;
  yAxisMin: string;  yAxisMax: string;
  ```

### 3.4 第 2 Y 軸（Dual Y-Axis）

- 異なるスケール・単位の系列を 1 つのグラフに重ねて表示
- Y 列ごとに「左軸 (y1) / 右軸 (y2)」を割り当て
- ChartConfig:
  ```typescript
  yAxisSide: Record<string, "y1" | "y2">;
  y2AxisLabel: string;
  y2AxisScale: "linear" | "log";
  y2AxisMin: string;  y2AxisMax: string;
  ```

---

## 4. 画像エクスポート

論文・スライド挿入用にグラフを画像として書き出す。

| 形式 | 用途 |
|---|---|
| PNG | スライド挿入、Web |
| SVG | 論文投稿（ベクター） |

- ツールバーにエクスポートボタンを追加（ダウンロードアイコン）
- Plotly の `Plotly.downloadImage()` を使用
- 解像度: PNG はデフォルト 2x (retina)

---

## 5. クロスページ グラフ参照

### 5.1 概要

あるページのテーブルデータを、別のページにグラフとして挿入する機能。
「参照グラフブロック」を新設し、データソースとなるテーブル（Dataset）を指定して描画する。

### 5.2 ユースケース

- 実験データページにテーブルを置き、考察ページにグラフだけを挿入
- 複数の実験ページのデータを 1 つのまとめページで比較表示
- データの一元管理（テーブルを更新すれば参照先のグラフも自動更新）

### 5.3 挿入フロー

```
[参照先ページ]
  ユーザーが /グラフ参照 or /chart-ref スラッシュコマンドを実行
    → データセット選択ダイアログが開く
      ├─ 全ページのテーブル一覧（ページ名 > テーブル名）
      └─ 検索フィルタ
    → データセットを選択
    → 参照グラフブロックが挿入される
```

### 5.4 データセット選択ダイアログ

- 全ページに存在する Dataset をリスト表示
- 表示形式: `ページ名 / テーブル名（行数 × 列数）`
- テキスト検索でフィルタ可能
- 選択するとブロックが挿入される

### 5.5 ブロック定義

```typescript
createReactBlockSpec({
  type: "chartRef",
  propSchema: {
    datasetId: { default: "" },       // 参照先の Dataset UUID
    sourcePageId: { default: "" },    // データ元のページ ID（表示用）
  },
  content: "none",
});
```

### 5.6 表示・動作

- **グラフ描画**: 既存の ChartRenderer をそのまま使用。datasetId でデータを取得して描画する
- **設定**: 通常のグラフブロックと同じ設定項目（軸、回帰、種別など）を独立に持つ
  - 設定は `lablate_chart_config_<blockId>` に保存（通常グラフと同じ仕組み）
- **リアルタイム同期**: 元テーブルの変更は `lablate-dataset-change` イベント経由で自動反映（既存の仕組みをそのまま活用）
- **ソース表示**: ツールバーに参照元を表示（例: `📊 実験1 / 吸光度データ`）。クリックで元ページに遷移
- **データ元が削除された場合**: 「データソースが見つかりません」と表示し、データセット再選択を促す

### 5.7 Dataset メタデータの拡張

参照先を一覧するために、Dataset にページ情報を紐付ける。

```typescript
interface DatasetMeta {
  id: string;
  name: string;
  createdAt: string;
  pageId: string;       // 新規: このデータセットが属するページ ID
}
```

- テーブルブロック作成時に pageId を記録する
- ページ削除時は Dataset は残す（他ページで参照されている可能性がある）
- 孤立した Dataset の一括削除は別途検討

### 5.8 既存のグラフブロックとの関係

| | 通常グラフ (`chart`) | 参照グラフ (`chartRef`) |
|---|---|---|
| データソース | 同じページ内のテーブルから渡される | 任意のページの Dataset を UUID で参照 |
| 描画エンジン | ChartRenderer | ChartRenderer（共通） |
| 設定の保存先 | `lablate_chart_config_<blockId>` | 同左 |
| データ同期 | `lablate-dataset-change` イベント | 同左 |
| ソース遷移 | なし | ツールバーから元ページに遷移可能 |

---

## 6. 実装の優先度

| 優先度 | 項目 | 理由 |
|---|---|---|
| **P0** | 折れ線グラフ・エラーバー | 実験データの基本表現。散布図の次に使用頻度が高い |
| **P0** | 対数軸 | 化学・生物で頻出。対数プロットなしでは多くのデータを正しく可視化できない |
| **P0** | 軸ラベル・単位 | 論文・レポートに貼るには軸名のカスタマイズが必須 |
| **P1** | クロスページ参照 | まとめページ・考察ページでの利用価値が高い |
| **P1** | 棒グラフ・箱ひげ図 | 試料比較・統計要約に必要 |
| **P1** | 指数・対数・べき乗フィッティング | 多項式では表現できない非線形モデル |
| **P1** | 画像エクスポート (PNG/SVG) | 論文・スライドへの貼り付け |
| **P2** | 第 2 Y 軸 | あると便利だが頻度は低い |
| **P2** | ヒストグラム | 分布の可視化。棒グラフで代替可能なケースも多い |
| **P2** | 4PL フィッティング | 生物系の用量反応に特化。ユーザー層が限定的 |
| **P2** | 軸範囲の手動設定 | Plotly のドラッグズームで暫定対応可能 |
| **P2** | 系列ごとの回帰モデル独立選択 | 現行の全系列共通でも多くのケースは対応できる |

---

## 7. スコープ外（将来検討）

- 3D プロット
- 等高線図 / ヒートマップ
- X 方向エラーバー
- カスタム数式によるカーブフィット（ユーザー定義式）
- グラフテンプレート（設定のプリセット保存・適用）
- 複数 Dataset の重ね合わせ（異なるテーブルのデータを 1 つのグラフに）
