# スプレッドシート組み込み関数リファレンス

Lablate のスプレッドシート（jspreadsheet-ce + `@jspreadsheet/formula`）でセルに `=` から始めて使える関数の一覧。構文と簡単な説明を記載。

> **表記**: `[...]` は省略可。`N` は数値、`S` は文字列、`B` は真偽、`R` は範囲、`D` は日付。

---

## 目次

- [よく使う基本関数](#よく使う基本関数)
- [数学・三角関数](#数学三角関数)
- [統計](#統計)
- [文字列](#文字列)
- [日付・時刻](#日付時刻)
- [論理](#論理)
- [検索・参照](#検索参照)
- [情報](#情報)
- [財務](#財務)
- [工学](#工学)
- [データベース関数 (D*)](#データベース関数-d)
- [複素数 (IM*)](#複素数-im)
- [分布系（統計分布）](#分布系統計分布)

---

## よく使う基本関数

| 関数 | 構文 | 説明 |
|------|------|------|
| `SUM` | `SUM(N1, [N2, ...])` | 合計 |
| `AVERAGE` | `AVERAGE(N1, ...)` | 平均（空白セル除外） |
| `AVERAGEA` | `AVERAGEA(N1, ...)` | 平均（文字列は0扱い） |
| `MAX` / `MIN` | `MAX(N1, ...)` | 最大 / 最小 |
| `COUNT` | `COUNT(R)` | 数値セル数 |
| `COUNTA` | `COUNTA(R)` | 非空白セル数 |
| `COUNTBLANK` | `COUNTBLANK(R)` | 空白セル数 |
| `COUNTIF` | `COUNTIF(R, 条件)` | 条件に合うセル数 |
| `COUNTIFS` | `COUNTIFS(R1, 条件1, R2, 条件2, ...)` | 複数条件 |
| `SUMIF` | `SUMIF(R, 条件, [合計R])` | 条件付き合計 |
| `SUMIFS` | `SUMIFS(合計R, R1, 条件1, ...)` | 複数条件合計 |
| `IF` | `IF(条件, 真, 偽)` | 分岐 |
| `IFS` | `IFS(条件1, 値1, 条件2, 値2, ...)` | 多分岐 |
| `IFERROR` | `IFERROR(式, エラー時値)` | エラー時の代替値 |
| `ROUND` | `ROUND(N, 桁数)` | 四捨五入 |
| `ROUNDUP` / `ROUNDDOWN` | `ROUNDUP(N, 桁数)` | 切り上げ / 切り捨て |
| `ABS` | `ABS(N)` | 絶対値 |
| `VLOOKUP` | `VLOOKUP(検索値, R, 列, [完全一致])` | 垂直検索 |
| `HLOOKUP` | `HLOOKUP(検索値, R, 行, [完全一致])` | 水平検索 |
| `INDEX` / `MATCH` | `INDEX(R, 行, [列])` / `MATCH(値, R, [型])` | 範囲検索 |

---

## 数学・三角関数

`ABS(N)` 絶対値
`ACOS(N)`, `ACOSH(N)`, `ACOT(N)`, `ACOTH(N)` 逆余弦系
`ARABIC(S)` ローマ数字→整数
`ASIN(N)`, `ASINH(N)` 逆正弦系
`ATAN(N)`, `ATAN2(x, y)`, `ATANH(N)` 逆正接系
`BASE(N, 基数, [桁数])` 任意基数に変換
`CEILING(N, [基準])`, `CEILING.MATH(N, [基準, モード])`, `CEILING.PRECISE(N)` 切り上げ
`COMBIN(n, k)`, `COMBINA(n, k)` 組み合わせ / 重複組み合わせ
`COS(N)`, `COSH(N)`, `COT(N)`, `COTH(N)`, `CSC(N)`, `CSCH(N)` 三角関数系
`DECIMAL(S, 基数)` 任意基数→10進
`DEGREES(N)` ラジアン→度
`EVEN(N)` 最も近い偶数へ切り上げ
`EXP(N)` eのN乗
`FACT(N)` 階乗
`FACTDOUBLE(N)` 二重階乗
`FLOOR(N, 基準)`, `FLOOR.MATH`, `FLOOR.PRECISE` 切り捨て
`GCD(N1, N2, ...)` 最大公約数
`INT(N)` 整数部（負数は切り下げ）
`LCM(N1, N2, ...)` 最小公倍数
`LN(N)` 自然対数
`LOG(N, [底])` 対数（デフォルト10）
`LOG10(N)` 常用対数
`MOD(被除数, 除数)` 剰余
`MROUND(N, 倍数)` 倍数に丸め
`MULTINOMIAL(N1, ...)` 多項係数
`MUNIT(N)` N×Nの単位行列
`ODD(N)` 奇数に切り上げ
`PI()` 円周率
`POWER(N, 指数)` べき乗
`PRODUCT(N1, ...)` 総乗
`QUOTIENT(被除数, 除数)` 商の整数部
`RADIANS(度)` 度→ラジアン
`RAND()` 0–1 乱数
`RANDBETWEEN(下限, 上限)` 範囲内の整数乱数
`ROMAN(N, [形式])` アラビア→ローマ数字
`ROUND(N, 桁)`, `ROUNDUP(N, 桁)`, `ROUNDDOWN(N, 桁)` 丸め系
`SEC(N)`, `SECH(N)` 正割 / 双曲正割
`SERIESSUM(x, n, m, [係数...])` 級数和
`SIGN(N)` 符号
`SIN(N)`, `SINH(N)` 正弦 / 双曲正弦
`SQRT(N)` 平方根
`SQRTPI(N)` √(π·N)
`SUM(N1, ...)` 合計
`SUMIF(R, 条件, [合計R])`、`SUMIFS(合計R, 条件R1, 条件1, ...)` 条件付き
`SUMPRODUCT(R1, R2, ...)` 積の合計
`SUMSQ(N1, ...)` 平方和
`SUMX2MY2(R1, R2)` Σ(xᵢ²−yᵢ²)
`SUMX2PY2(R1, R2)` Σ(xᵢ²+yᵢ²)
`SUMXMY2(R1, R2)` Σ(xᵢ−yᵢ)²
`TAN(N)`, `TANH(N)` 正接
`TRUNC(N, [桁])` 切り捨て

---

## 統計

`AVEDEV(N1, ...)` 平均絶対偏差
`AVERAGE(N1, ...)`, `AVERAGEA(N1, ...)` 平均
`AVERAGEIF(R, 条件, [平均R])` 条件付き平均
`AVERAGEIFS(平均R, 条件R1, 条件1, ...)` 複数条件
`CORREL(R1, R2)` 相関係数
`COUNT(R)`, `COUNTA(R)`, `COUNTBLANK(R)` カウント
`COUNTIF(R, 条件)`, `COUNTIFS(R1, 条件1, ...)` 条件付きカウント
`COVARIANCE.P(R1, R2)`, `COVARIANCE.S(R1, R2)` 共分散（母/標本）
`DEVSQ(N1, ...)` 平均との二乗偏差和
`FISHER(N)`, `FISHERINV(N)` Fisher 変換
`FORECAST(x, 既知y, 既知x)` 線形予測
`FREQUENCY(データR, 区切りR)` 度数分布
`GAMMA(N)`, `GAMMALN(N)`, `GAMMALN.PRECISE(N)` γ関数
`GEOMEAN(N1, ...)` 幾何平均
`HARMEAN(N1, ...)` 調和平均
`INTERCEPT(既知y, 既知x)` 回帰切片
`KURT(N1, ...)` 尖度
`LARGE(R, k)` k 番目に大きい値
`LINEST(既知y, [既知x], [定数], [詳細])` 線形回帰係数
`LOGEST(既知y, [既知x], [定数], [詳細])` 指数回帰
`MAX(N1, ...)`, `MAXA(N1, ...)` 最大
`MEDIAN(N1, ...)` 中央値
`MIN(N1, ...)`, `MINA(N1, ...)` 最小
`MODE.SNGL(N1, ...)` 最頻値
`MODE.MULT(N1, ...)` 最頻値（複数返す）
`PEARSON(R1, R2)` Pearson 相関係数
`PERCENTILE.EXC(R, k)`, `PERCENTILE.INC(R, k)` k-分位
`PERCENTRANK.EXC(R, x, [桁])`, `PERCENTRANK.INC(...)` 順位率
`PERMUT(n, k)`, `PERMUTATIONA(n, k)` 順列 / 重複順列
`PHI(N)` 標準正規の密度
`PROB(xR, pR, 下限, [上限])` 確率区間
`QUARTILE.EXC(R, q)`, `QUARTILE.INC(R, q)` 四分位
`RANK.AVG(x, R, [順])`, `RANK.EQ(x, R, [順])` 順位
`RSQ(既知y, 既知x)` 決定係数 R²
`SKEW(N1, ...)`, `SKEW.P(N1, ...)` 歪度
`SLOPE(既知y, 既知x)` 回帰傾き
`SMALL(R, k)` k 番目に小さい値
`STANDARDIZE(x, 平均, 標準偏差)` 標準化
`STDEV.S(N1, ...)`, `STDEV.P(N1, ...)`, `STDEVA`, `STDEVPA` 標準偏差
`STEYX(既知y, 既知x)` 回帰の標準誤差
`TREND(既知y, [既知x], [新x], [定数])` 線形予測（配列）
`TRIMMEAN(R, 割合)` 一部除外平均
`VAR.S(N1, ...)`, `VAR.P(N1, ...)`, `VARA`, `VARPA` 分散

---

## 分布系（統計分布）

`BETA.DIST(x, α, β, 累積, [A, B])`, `BETA.INV(確率, α, β, [A, B])`
`BINOM.DIST(成功, 試行, 成功確率, 累積)`, `BINOM.INV(試行, 成功確率, 目標確率)`
`CHISQ.DIST(x, 自由度, 累積)`, `CHISQ.DIST.RT`, `CHISQ.INV`, `CHISQ.INV.RT`, `CHISQ.TEST(実測, 理論)`
`CONFIDENCE.NORM(α, 標準偏差, n)`, `CONFIDENCE.T(α, 標準偏差, n)` 信頼区間
`EXPON.DIST(x, λ, 累積)` 指数分布
`F.DIST(x, df1, df2, 累積)`, `F.DIST.RT`, `F.INV`, `F.INV.RT`, `F.TEST(R1, R2)`
`GAMMA.DIST(x, α, β, 累積)`, `GAMMA.INV(確率, α, β)`
`GAUSS(z)` 標準正規の累積（0から）
`HYPGEOM.DIST(成功, 標本, 母集団成功, 母集団, 累積)`
`LOGNORM.DIST(x, 平均, σ, 累積)`, `LOGNORM.INV`
`NEGBINOM.DIST(失敗, 成功, 成功確率, 累積)`
`NORM.DIST(x, 平均, σ, 累積)`, `NORM.INV`, `NORM.S.DIST(z, 累積)`, `NORM.S.INV(確率)`
`POISSON.DIST(x, 平均, 累積)`
`T.DIST(x, df, 累積)`, `T.DIST.RT`, `T.DIST.2T`, `T.INV`, `T.INV.2T`, `T.TEST(R1, R2, 尾, 型)`
`WEIBULL.DIST(x, α, β, 累積)`
`Z.TEST(R, x, [σ])`
`CRITBINOM(試行, 成功確率, α)`

---

## 文字列

`ASC(S)` 全角→半角
`BAHTTEXT(N)` 数値→タイ語金額
`CHAR(N)` 文字コード→文字
`CLEAN(S)` 制御文字除去
`CODE(S)` 先頭文字のコード
`CONCAT(S1, S2, ...)` / `CONCATENATE(...)` 連結
`DBCS(S)` 半角→全角
`DOLLAR(N, [桁])` 通貨書式
`EXACT(S1, S2)` 完全一致
`FIND(検索, S, [開始])` 位置（大文字小文字区別）
`FIXED(N, [桁], [区切無])` 固定小数点
`LEFT(S, N)` 左から N 文字
`LEN(S)` 文字数
`LOWER(S)` 小文字化
`MID(S, 開始, N)` 中央抽出
`NUMBERVALUE(S, [小数点], [桁区切])` 数値化
`PROPER(S)` 単語先頭大文字
`REPLACE(旧S, 開始, 文字数, 新S)` 位置置換
`REPT(S, N)` N 回繰り返し
`RIGHT(S, N)` 右から N 文字
`SEARCH(検索, S, [開始])` 位置（区別なし、ワイルドカード可）
`SUBSTITUTE(S, 旧, 新, [回])` 置換
`T(値)` 文字列のみそのまま返す
`TEXT(N, 書式)` 数値→文字列書式
`TEXTJOIN(区切, 空無視, S1, ...)` 結合
`TRIM(S)` 前後空白除去
`UNICHAR(N)`, `UNICODE(S)` Unicode
`UPPER(S)` 大文字化
`VALUE(S)` 数値変換

---

## 日付・時刻

`DATE(年, 月, 日)` 日付構築
`DATEDIF(開始D, 終了D, 単位)` 日付差（"Y"/"M"/"D"/"MD"/"YM"/"YD"）
`DATEVALUE(S)` 文字列→日付値
`DAY(D)`, `MONTH(D)`, `YEAR(D)` 分解
`DAYS(終了D, 開始D)` 日数差
`DAYS360(開始D, 終了D, [方式])` 360日基準
`EDATE(開始D, 月数)` 月加算
`EOMONTH(開始D, 月数)` 月末
`HOUR(D)`, `MINUTE(D)`, `SECOND(D)` 時刻分解
`ISOWEEKNUM(D)` ISO週番号
`NETWORKDAYS(開始, 終了, [祝日])`, `NETWORKDAYS.INTL(開始, 終了, [週末], [祝日])`
`NOW()` 現在日時
`TIME(時, 分, 秒)` 時刻構築
`TIMEVALUE(S)` 文字列→時刻値
`TODAY()` 今日の日付
`WEEKDAY(D, [種類])` 曜日番号
`WEEKNUM(D, [種類])` 週番号
`WORKDAY(開始, 日数, [祝日])`, `WORKDAY.INTL(...)`
`YEARFRAC(開始, 終了, [基準])` 年換算

---

## 論理

`AND(B1, B2, ...)` すべて真
`OR(B1, B2, ...)` いずれか真
`NOT(B)` 否定
`XOR(B1, B2, ...)` 排他的論理和
`TRUE()` / `FALSE()` 定数
`IF(条件, 真値, 偽値)`
`IFS(条件1, 値1, ..., [デフォルト条件, デフォルト値])`
`IFERROR(式, エラー時値)`
`IFNA(式, NA時値)`
`SWITCH(対象, 値1, 結果1, ..., [デフォルト])`

---

## 検索・参照

`CHOOSE(番号, 値1, ...)` 番号で値選択
`COLUMN([参照])` 列番号
`COLUMNS(R)` 列数
`HLOOKUP(値, R, 行, [完全])` 水平検索
`INDEX(R, 行, [列])` 位置参照
`LOOKUP(値, 検索R, [結果R])` 単純検索
`MATCH(値, R, [型])` 位置取得
`ROW([参照])` 行番号
`ROWS(R)` 行数
`SORT(R, [ソート列], [順], [列方向])` ソート
`TRANSPOSE(R)` 行列転置
`UNIQUE(R, [列方向], [唯一])` 重複排除
`VLOOKUP(値, R, 列, [完全])` 垂直検索

---

## 情報

`CELL(情報種, [参照])` セル情報
`ERROR.TYPE(エラー)` エラー種別
`INFO(種)` 環境情報
`ISBLANK(値)`, `ISERR(値)`, `ISERROR(値)`, `ISEVEN(N)`, `ISFORMULA(参照)`, `ISLOGICAL(値)`, `ISNA(値)`, `ISNONTEXT(値)`, `ISNUMBER(値)`, `ISODD(N)`, `ISREF(値)`, `ISTEXT(値)` 判定
`N(値)` 値を数値化
`NA()` #N/A エラー
`SHEET([参照])`, `SHEETS([参照])` シート番号 / 数
`TYPE(値)` データ型番号

---

## 財務

`ACCRINT(...)`、`ACCRINTM(...)` 経過利息
`AMORDEGRC(原価, 購入, 初期, 残存, 期間, 率, [基準])`、`AMORLINC(...)` 減価償却（仏式）
`COUPDAYBS / COUPDAYS / COUPDAYSNC / COUPNCD / COUPNUM / COUPPCD(決済, 満期, 頻度, [基準])` クーポン日計算
`CUMIPMT(率, 期間, PV, 開始, 終了, 型)`、`CUMPRINC(...)` 累積利息/元本
`DB(原価, 残存, 耐用, 期, [月])`、`DDB(原価, 残存, 耐用, 期, [率])` 減価償却
`DISC(決済, 満期, 価格, 償還, [基準])` 割引率
`DOLLARDE(小数, 分母)`、`DOLLARFR(...)` ドル表記変換
`DURATION(決済, 満期, 利率, 利回り, 頻度, [基準])`、`MDURATION(...)` 修正デュレーション
`EFFECT(名目, 期/年)` 実効金利
`FV(率, 期, 支払, [PV], [型])` 将来価値
`FVSCHEDULE(元本, 金利配列)`
`INTRATE(決済, 満期, 投資, 償還, [基準])` 利率
`IPMT(率, 期, 総期, PV, [FV], [型])` 利息支払
`IRR(CF範囲, [推定])` 内部収益率
`ISPMT(率, 期, 総期, PV)` 基本利息
`MIRR(CF, 財務率, 再投資率)` 修正 IRR
`NOMINAL(実効, 期/年)` 名目金利
`NPER(率, 支払, PV, [FV], [型])` 期数
`NPV(率, CF1, ...)` 現在価値
`ODDFPRICE(...)`、`ODDFYIELD(...)`、`ODDLPRICE(...)`、`ODDLYIELD(...)` 不揃い期
`PDURATION(率, PV, FV)` 期間
`PMT(率, 期, PV, [FV], [型])` 定期支払額
`PPMT(率, 期, 総期, PV, [FV], [型])` 元本支払
`PRICE(決済, 満期, 利率, 利回り, 償還, 頻度, [基準])`、`PRICEDISC(...)`、`PRICEMAT(...)` 価格
`PV(率, 期, 支払, [FV], [型])` 現在価値
`RATE(期, 支払, PV, [FV], [型], [推定])` 金利
`RECEIVED(決済, 満期, 投資, 割引, [基準])` 受取額
`RRI(期, PV, FV)` 等価利率
`SLN(原価, 残存, 耐用)` 定額減価
`SYD(原価, 残存, 耐用, 期)` 級数法
`TBILLEQ(決済, 満期, 割引)`、`TBILLPRICE(...)`、`TBILLYIELD(決済, 満期, 価格)` 米財務省証券
`VDB(原価, 残存, 耐用, 開始, 終了, [率], [切替])` 可変減価
`XIRR(CF, 日付, [推定])` 不定期 IRR
`XNPV(率, CF, 日付)` 不定期 NPV
`YIELD(決済, 満期, 利率, 価格, 償還, 頻度, [基準])`、`YIELDDISC(...)`、`YIELDMAT(...)` 利回り

---

## 工学

**進数変換**
`BIN2DEC(S)`、`BIN2HEX(S, [桁])`、`BIN2OCT(...)`
`DEC2BIN(N, [桁])`、`DEC2HEX(...)`、`DEC2OCT(...)`
`HEX2BIN(S, [桁])`、`HEX2DEC(S)`、`HEX2OCT(...)`
`OCT2BIN(...)`、`OCT2DEC(S)`、`OCT2HEX(...)`

**ビット演算**
`BITAND(N1, N2)`、`BITOR(...)`、`BITXOR(...)`、`BITLSHIFT(N, 桁)`、`BITRSHIFT(N, 桁)`

**ベッセル関数**
`BESSELI(x, n)`、`BESSELJ(...)`、`BESSELK(...)`、`BESSELY(...)`

**その他**
`COMPLEX(実部, 虚部, [接尾])` 複素数構築
`CONVERT(N, 元単位, 先単位)` 単位変換
`DELTA(N1, [N2])` 等しければ 1
`ERF(下限, [上限])`、`ERF.PRECISE(x)`、`ERFC(x)`、`ERFC.PRECISE(x)` 誤差関数
`GESTEP(N, [閾値])` 閾値以上で 1

---

## 複素数 (IM*)

（複素数は `COMPLEX(実, 虚)` または `"a+bi"` 文字列で指定）

`IMABS(z)` 絶対値
`IMAGINARY(z)` 虚部
`IMARGUMENT(z)` 偏角
`IMCONJUGATE(z)` 共役
`IMCOS(z)`, `IMCOSH(z)`, `IMCOT(z)`, `IMCSC(z)`, `IMCSCH(z)` 三角系
`IMDIV(z1, z2)` 除算
`IMEXP(z)` 指数
`IMLN(z)`, `IMLOG10(z)`, `IMLOG2(z)` 対数
`IMPOWER(z, N)` べき乗
`IMPRODUCT(z1, ...)` 積
`IMREAL(z)` 実部
`IMSEC(z)`, `IMSECH(z)` 正割
`IMSIN(z)`, `IMSINH(z)` 正弦
`IMSQRT(z)` 平方根
`IMSUB(z1, z2)` 差
`IMSUM(z1, ...)` 和
`IMTAN(z)` 正接

---

## データベース関数 (D*)

範囲 + フィールド + 条件で集計。構文共通: `Dxxx(DB範囲, フィールド, 条件範囲)`

| 関数 | 説明 |
|------|------|
| `DAVERAGE` | 条件に合う行の平均 |
| `DCOUNT` | 数値セル数 |
| `DCOUNTA` | 非空白セル数 |
| `DGET` | 単一値取得 |
| `DMAX` / `DMIN` | 最大 / 最小 |
| `DPRODUCT` | 積 |
| `DSTDEV` / `DSTDEVP` | 標準偏差（標本/母） |
| `DSUM` | 合計 |
| `DVAR` / `DVARP` | 分散（標本/母） |

---

## 使用例

```
=SUM(A1:A10)                         10 行の合計
=AVERAGE(B:B)                        B 列全体の平均
=IF(A1>0, "正", IF(A1<0, "負", "零"))  条件分岐
=VLOOKUP("key", A1:C100, 2, FALSE)   検索
=COUNTIF(A:A, ">100")                条件カウント
=TEXT(NOW(), "yyyy-mm-dd")           日付書式
=INDEX($A$1:$D$10, MATCH("x", $A:$A, 0), 3)  INDEX/MATCH
=IFERROR(A1/B1, 0)                   0 除算のフォールバック
```

## 備考

- 大文字小文字は区別しない（`=sum(A1:A2)` も OK）
- 関数名は `@jspreadsheet/formula` v2 に登録されているものから抽出。分布系は `.` 区切りで `NORM.DIST` のように呼ぶ
- 最新追加関数は [jspreadsheet 公式ドキュメント](https://jspreadsheet.com/docs/formulas) を参照
