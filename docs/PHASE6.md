# Lablate - Phase 6 仕様書（ドラフト）

## 目標

Stripe によるサブスクリプション課金を導入する。
**クラウド保存・プロジェクト共有機能は Lablate 側で実装せず、OneDrive 共有フォルダの活用を公式推奨とする**。
Phase 5 の Cognito 認証基盤の上に構築する。

---

## 背景・方針の転換（重要）

### なぜクラウド保存・共有を Lablate で作らないのか

当初は Supabase DB にプロジェクトを保存し、アプリ内共有機能を実装する想定だった。
しかし以下の理由から方針転換する：

1. **データ主権の思想と矛盾する**
   Phase 4 で「Lablate はデータを一切預からない」と明言している。クラウド保存を足すと説明が揺らぐ。

2. **情シス承認の難易度が跳ね上がる**
   データを預かる = 個人情報保護法 + 各機関のデータ管理規程の対象になる。ISMAP 登録・SOC 2 等の追加対応が必要になる可能性。

3. **開発工数が膨大**
   共有機能（ロール管理、招待メール、RLS、競合解決）は自前で作ると数ヶ月かかる。

4. **OneDrive 共有フォルダで十分**
   対象ユーザー（研究機関勤務者）は全員 OneDrive / SharePoint を持っている。共有機能はそこに丸投げできる。

### 新しい共有モデル

```
ユーザーが OneDrive で共有フォルダを作成
  ↓
共有フォルダ内に Lablate プロジェクトフォルダを配置
  ↓
メンバーがそのフォルダを Lablate で開く
  ↓
OneDrive が自動同期、Lablate は交代編集（順番に編集）を想定
```

**共有機能はユーザー組織が既に運用している OneDrive / SharePoint に委譲する。**
Lablate 側は「競合検出 UI」だけを提供する（Phase 4 で既に仕込んでいる）。

### Phase 6 で本当にやること

- Stripe による Pro プランの課金（Lablate を継続運営する収益源）
- Pro 機能の実装（何を Pro 限定にするかは下記）

---

## ビジネスモデル

```
Free プラン（無料）
  ├─ 全エディタ機能
  ├─ ローカル保存（Phase 4）
  ├─ OneDrive 同期フォルダ保存
  ├─ エクスポート / インポート
  └─ グラフ画像エクスポート（標準解像度）

Pro プラン（個人向け有料）
  ├─ Free の全機能
  ├─ グラフ画像の高解像度エクスポート（4x 以上、学会発表向け）
  ├─ LLM 連携機能（Phase 7 での先行提供）
  ├─ 優先サポート
  └─ 将来: テンプレート集、統計関数拡張など
```

**※ 料金設定は別途決定。ここでは機能仕様のみ定義する。**

### Team プランはいったん作らない

共有機能を Lablate で持たない方針なので、Team プランは定義しない。
将来的に組織ライセンス（まとめて N ライセンス契約）を提供する可能性はあるが、Phase 6 では Free / Pro の 2 段階でシンプルに始める。

---

## Stripe 連携

### Stripe 側のセットアップ

1. Stripe アカウント作成（本人確認必要）
2. 商品・価格作成（Pro プラン月額）
3. Webhook エンドポイント設定
4. Tax（消費税）設定 - 日本向けなら 10%

### 決済フロー

```
ユーザーが「Pro にアップグレード」をクリック
  ↓
[Next.js API] Stripe Checkout セッション作成（サーバー側）
  ↓
Stripe の決済画面にリダイレクト
  ↓
決済完了
  ↓
Stripe Webhook → [Next.js API] → Cognito カスタム属性 `plan` を 'pro' に更新
  ↓
クライアント側でトークン再取得 → プラン変更を反映 → 機能解放
```

### プラン情報の保持場所

- Cognito のカスタム属性 `custom:plan` に保存（'free' | 'pro'）
- DB を別途持たない（Cognito で完結させる）
- Stripe Customer ID もカスタム属性 `custom:stripe_customer_id` に保存

**これにより Lablate 側 DB は不要になる**。Cognito + Stripe の二層で完結。

### API Routes（Next.js）

Next.js の API Routes を AWS Lambda + API Gateway 経由で動かす。
または Lambda@Edge / CloudFront Functions でサーバーレスに処理。

```
src/app/api/
  ├─ stripe/
  │   ├─ checkout/route.ts       ← Checkout セッション作成
  │   ├─ portal/route.ts         ← カスタマーポータル
  │   └─ webhook/route.ts        ← Stripe Webhook 受信 → Cognito 更新
  └─ ...
```

**実装メモ**: Phase 5 で静的エクスポート（`output: "export"`）にしている場合、API Routes は別途 Lambda で動かす必要あり。以下のいずれかを選択：

| 方式 | 難易度 | コスト |
|------|--------|--------|
| AWS Lambda + API Gateway（自前実装） | 中 | 無料枠内 |
| AWS Amplify Hosting（SSR モード） | 低 | 無料枠あり |
| Vercel に戻す（API 部分のみ） | 低 | 無料枠あり |

**推奨: Amplify Hosting または Lambda + API Gateway**（AWS 完結を優先）。

---

## Pro プランの機能

### 1. グラフ画像の高解像度エクスポート

```
Free: Plotly.toImage() で 2x 解像度（Phase 4 実装済み）
Pro:  Plotly.toImage() で 4x 解像度 + SVG エクスポート追加
```

実装は `plan` 属性を見て分岐するだけ。機能制限の実装コストが低い。

### 2. LLM 連携（Phase 7 相当の機能を Pro で先行提供）

- Markdown をもとにした要約・報告書生成
- データから考察のドラフト生成
- OpenAI API or Anthropic API を Lablate のバックエンドから呼ぶ（ユーザーが自分の API キーを登録する方式でも可）

**Phase 6 時点では基盤のみ用意。実機能は Phase 7 で実装する前提でも可。**

### 3. プラン制限の実装

```typescript
// 機能ゲート
const { user } = useAuth();
const isPro = user?.plan === "pro";

<Button
  onClick={() => exportHighRes()}
  disabled={!isPro}
  title={isPro ? "" : "Pro プランで利用できます"}
>
  高解像度エクスポート
</Button>
```

### 4. アップグレード誘導 UI

- Pro 限定機能をクリックしたとき、ロック解除のモーダル表示
- 「Pro にアップグレード」ボタン → Stripe Checkout へ
- 押しつけがましくならない程度に配置

---

## 共有機能の代替（OneDrive 共有フォルダの使い方ガイド）

**Lablate 側で共有機能は実装しない**が、ユーザーに使い方を案内する。

### ヘルプドキュメント / サイト内ガイド

```markdown
# プロジェクトを共有する

Lablate はデータを預からない設計のため、共有は OneDrive / SharePoint の
共有フォルダ機能を利用してください。

## 手順

1. OneDrive で新しいフォルダを作成（例: `Lablate_共有_実験A`）
2. そのフォルダを「共有」→ 共有したい相手のメールアドレスを指定
3. Lablate を開き、「フォルダを選択」でその共有フォルダを指定
4. 通常通り編集。変更内容は OneDrive が自動同期します

## 注意事項

- **同時編集はできません**。メンバーが順番に編集してください。
- 誰かが編集中かは OneDrive の表示で確認できます。
- 競合が発生した場合は Lablate が通知します。
```

### サンプルワークフロー

```
週次ミーティングで担当を決める
  → Aさんが月曜に実験ノート編集
  → Bさんが火曜にグラフ追加
  → Cさんが水曜に考察記入
```

この方式なら共同編集がなくても実用上は問題ないケースが多い。

### Lablate 側のサポート機能（軽量）

- フォルダ接続時に `.lablate-lock` ファイルを作成 → 他ユーザーに編集中を通知（シンプルな排他制御）
- 開始時に最終編集者・最終編集日時を表示

**※ これは軽量な実装で済む。RLS も DB も不要。**

---

## プロジェクト一覧画面（縮小版）

クラウド保存がないので、プロジェクト一覧はシンプルになる：

```
┌──────────────────────────────────────────┐
│ Lablate                    [👤 ユーザー] │
├──────────────────────────────────────────┤
│                                          │
│ 最近開いたプロジェクト    [+ 新規作成]   │
│                                          │
│  📁 実験A（ローカル）     最終編集: 4/14 │
│  📁 実験B（OneDrive）     最終編集: 4/13 │
│                                          │
│ [フォルダを選択して開く]                 │
│                                          │
└──────────────────────────────────────────┘
```

- 「最近開いたプロジェクト」は **ブラウザ側でフォルダハンドルを永続化** して実現
  （File System Access API + IndexedDB でハンドルを保存）
- 「共有されたプロジェクト」の区別は不要（全て OneDrive 経由）

---

## 設定 / プラン画面

```
┌─ アカウント設定 ──────────────────────┐
│                                        │
│ プラン: Free                           │
│ [Pro にアップグレード]                 │
│                                        │
│ プロフィール:                          │
│  名前: 山田 太郎                       │
│  メール: user@example.com              │
│                                        │
│ 請求 (Pro プラン):                     │
│  [プランを管理] （Stripe Portal へ）   │
│                                        │
│ [ログアウト] [アカウント削除]          │
└────────────────────────────────────────┘
```

---

## 環境変数（追加）

```env
# .env.local（Phase 5 に追加）
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRO_PRICE_ID=price_...

# Cognito 管理用（Lambda 側）
COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxxx
AWS_REGION=ap-northeast-1
```

---

## 実装の優先順位

```
Step 1: Amplify Hosting または Lambda + API Gateway セットアップ
        → Phase 5 の静的配信を SSR / API 対応に拡張

Step 2: プラン属性を Cognito に追加、クライアント側でプラン判定
        → 未課金でも 'free' として動くようにする

Step 3: Stripe Checkout + Webhook 実装
        → 決済 → Cognito 更新の流れを通す

Step 4: Pro 機能の実装（高解像度エクスポート等）
        → 機能ゲートをつける

Step 5: プラン管理 UI + カスタマーポータル
        → ユーザーが自分で解約できる状態にする

Step 6: OneDrive 共有ワークフローのガイド整備
        → サイト内ヘルプ + 動画チュートリアル
```

---

## 完了条件

### インフラ追加

- [ ] Amplify Hosting または Lambda + API Gateway のセットアップ
- [ ] API Routes を AWS 上で動作可能にする
- [ ] Stripe アカウント作成 + 商品登録

### 課金

- [ ] Checkout セッション API
- [ ] Webhook 受信 → Cognito の `custom:plan` 更新
- [ ] Customer Portal 連携（プラン変更・解約）
- [ ] プラン表示 UI
- [ ] 支払い失敗時の処理（past_due ステータス）

### Pro 機能

- [ ] Cognito カスタム属性 `custom:plan`, `custom:stripe_customer_id` 追加
- [ ] クライアント側でプラン判定フック実装
- [ ] 高解像度グラフエクスポート（Pro 限定）
- [ ] SVG エクスポート（Pro 限定）
- [ ] アップグレード誘導モーダル

### 共有ワークフロー

- [ ] OneDrive 共有フォルダ活用ガイド（サイト内ヘルプ）
- [ ] `.lablate-lock` による簡易排他制御
- [ ] 最終編集者・編集日時表示
- [ ] プロジェクト競合検出 UI（Phase 4 の機能を実運用投入）

### UI

- [ ] プロジェクト一覧画面（最近開いたフォルダ）
- [ ] 設定 / プラン画面
- [ ] アップグレード誘導 UI

### 運用

- [ ] 特商法表記
- [ ] 返金ポリシー
- [ ] サポート窓口設置（メール or フォーム）

---

## スコープ外（Phase 7 以降）

- LLM 統合の本実装（Markdown → 報告書自動生成、データ考察生成）
- リアルタイム同時編集（CRDT / Yjs）- 見通しは立っていない
- Team / Enterprise プラン（組織ライセンス）
- 監査ログ
- ISMAP-LIU 申請
- モバイルアプリ
- Microsoft Graph API による OneDrive 直接連携（現時点で予定なし）

---

## 備考: Phase 6 の前に検討すべきこと

Phase 6 は課金を入れるフェーズ。開始前に以下を確認：

1. **Phase 5 の無料版で十分なユーザーがついたか**（最低 50-100 人の継続利用）
2. **課金に値する Pro 機能が明確に見えているか**（ユーザーヒアリング）
3. **個人事業主 or 法人として請求書発行が可能か**（税務・法務の準備）
4. **継続的な運用コストの見通し**（サーバー・Stripe 手数料・サポート工数）

**ユーザーがつかないうちに課金を入れても意味がない**。Phase 5 で手応えを確認してから Phase 6 に着手する判断を。
