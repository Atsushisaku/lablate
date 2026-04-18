# テスト用CSVデータ

グラフ機能の動作確認用データセット。

## ファイル一覧

| ファイル | グラフ種別 | テスト項目 |
|---|---|---|
| `scatter_absorbance.csv` | 散布図 + エラーバー + 1次回帰 | 検量線（濃度 vs 吸光度） |
| `line_reaction_kinetics.csv` | 折れ線 + 複数系列 + エラーバー | 反応速度の経時変化 2系列 |
| `bar_yield_comparison.csv` | 棒グラフ (グループ) + エラーバー | 触媒ごとの収率比較 |
| `bar_stacked_composition.csv` | 棒グラフ (積み上げ) | 合金の組成比較 |
| `histogram_particle_size.csv` | ヒストグラム | ナノ粒子の粒径分布 |
| `box_measurement_variability.csv` | 箱ひげ図 | 4サンプルの測定ばらつき |
| `exp_decay.csv` | 散布図 + 指数フィッティング | 放射性崩壊 |
| `log_axis_dose_response.csv` | 散布図 + 対数X軸 + 4PL | 用量反応曲線 |
| `power_allometry.csv` | 散布図 + べき乗フィッティング + 対数軸 | アロメトリー（体重 vs 代謝率） |
| `dual_yaxis_temp_pressure.csv` | 折れ線 + 第2Y軸 | 温度(左軸) と 圧力(右軸) の同時プロット |

## 使い方

1. CSVテーブルブロックを挿入
2. 「CSV読み込み」で該当ファイルをインポート
3. グラフ種別・回帰モデル・軸設定を切り替えて動作確認
