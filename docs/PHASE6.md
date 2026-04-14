# Lablate - Phase 6 仕様書（ドラフト）

## 目標

サブスクリプション課金を導入し、クラウドへのプロジェクト保存とプロジェクト共有（交代編集）を実現する。
Phase 5 の認証基盤の上に構築する。

---

## 背景・方針

### ビジネスモデル

```
Free プラン（無料）
  ├─ ローカル保存のみ
  ├─ エクスポート / インポート
  └─ 全エディタ機能

Pro プラン（個人向け有料）
  ├─ Free の全機能
  ├─ クラウド保存（プロジェクト数無制限）
  ├─ デバイス間同期
  └─ グラフ画像の高解像度エクスポート

Team プラン（チーム向け有料）
  ├─ Pro の全機能
  ├─ プロジェクト共有（最大 N メンバー）
  ├─ アクセス制御（閲覧 / 編集 / 管理者）
  └─ 編集履歴・変更ログ
```

**※ 料金設定は別途決定。ここでは機能仕様のみ定義する。**

### データ保存の選択制

ユーザーが保存先を選べる設計を維持する：

```
プロジェクト作成時:
  ├─ 「ローカルに保存」→ Phase 4 のフォルダ保存（無料）
  └─ 「クラウドに保存」→ Supabase DB に保存（Pro 以上）
```

---

## Part 1: サブスクリプション（Stripe）

### Stripe 連携の仕組み

```
ユーザーが「Pro にアップグレード」をクリック
  ↓
Stripe Checkout セッションを作成（サーバー側）
  ↓
Stripe の決済画面にリダイレクト
  ↓
決済完了 → Stripe Webhook が Supabase に通知
  ↓
profiles.plan を 'pro' に更新
  ↓
クライアント側でプラン変更を検知 → 機能解放
```

### データベース追加

```sql
-- サブスクリプション管理
create table public.subscriptions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text default 'free',                    -- 'free' | 'pro' | 'team'
  status text default 'active',                -- 'active' | 'canceled' | 'past_due'
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### API Routes（Next.js）

```
src/app/api/
  ├─ stripe/
  │   ├─ checkout/route.ts       ← Checkout セッション作成
  │   ├─ portal/route.ts         ← カスタマーポータル（プラン変更・解約）
  │   └─ webhook/route.ts        ← Stripe Webhook 受信
  └─ ...
```

### UI

- **設定画面 / プロフィール画面**にプラン表示
- 「Pro にアップグレード」ボタン → Stripe Checkout へ
- 「プランを管理」ボタン → Stripe Customer Portal へ（解約・カード変更）
- プラン制限に達した場合のアップグレード誘導 UI

---

## Part 2: クラウド保存

### データベース設計

```sql
-- プロジェクト
create table public.projects (
  id uuid default gen_random_uuid() primary key,
  owner_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'Untitled',
  tree jsonb not null default '{}',                -- PageTree
  dataset_registry jsonb not null default '[]',    -- DatasetMeta[]
  tabs jsonb,                                       -- TabState
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ページ（ドキュメント）
create table public.pages (
  id uuid primary key,                             -- pageId
  project_id uuid references public.projects(id) on delete cascade not null,
  blocks jsonb not null default '[]',              -- PartialBlock[]
  markdown text,                                    -- 生成された Markdown
  updated_at timestamptz default now()
);

-- データセット（テーブルデータ）
create table public.datasets (
  id uuid primary key,                             -- datasetId
  project_id uuid references public.projects(id) on delete cascade not null,
  headers jsonb not null default '[]',
  rows jsonb not null default '[]',
  config jsonb,                                     -- テーブル設定
  updated_at timestamptz default now()
);

-- グラフ設定
create table public.charts (
  id text primary key,                             -- blockId
  project_id uuid references public.projects(id) on delete cascade not null,
  config jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- 画像（メタデータのみ。Blob は Supabase Storage）
create table public.images (
  id uuid primary key,                             -- imageId
  project_id uuid references public.projects(id) on delete cascade not null,
  meta jsonb not null,
  storage_path text not null,                      -- Supabase Storage 内のパス
  updated_at timestamptz default now()
);
```

### 画像ストレージ

- Supabase Storage を使用（S3 互換）
- バケット: `project-images`
- パス: `{project_id}/{image_id}.{ext}`
- RLS でプロジェクトメンバーのみアクセス可能

### クラウド保存の StorageProvider 実装

```
src/lib/storage/
  ├─ types.ts              ← 既存
  ├─ local.ts              ← 既存（localStorage）
  ├─ fs-provider.ts        ← 既存（File System Access API）
  ├─ cloud-provider.ts     ← 【新規】Supabase 経由のクラウド保存
  └─ ...
```

Phase 3 で定義した `StorageProvider` インターフェースの Supabase 実装を作成。
プロジェクトの保存先設定に応じて `local` / `fs` / `cloud` を切り替える。

### 同期戦略（交代編集向け）

リアルタイム同期ではなく、**楽観的ロック**方式を採用する：

```
ユーザー A がプロジェクトを開く
  ↓
クラウドから最新データをダウンロード → localStorage に展開
  ↓
編集（ローカルで操作、デバウンスでクラウドに保存）
  ↓
保存時に updated_at を比較
  ├─ 自分が最後の編集者 → そのまま保存
  └─ 他の人が編集済み → 競合通知
      ├─ 「自分の変更で上書き」
      ├─ 「サーバーの内容で更新」
      └─ 「両方ダウンロードして手動マージ」
```

**リアルタイム同時編集は Phase 7 以降のスコープとする。**

---

## Part 3: プロジェクト共有

### 共有モデル

```sql
-- プロジェクトメンバー
create table public.project_members (
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null default 'viewer',       -- 'owner' | 'editor' | 'viewer'
  invited_at timestamptz default now(),
  primary key (project_id, user_id)
);
```

### 権限

| ロール | 閲覧 | 編集 | メンバー招待 | プロジェクト削除 |
|--------|------|------|-------------|----------------|
| viewer | 可   | 不可 | 不可         | 不可            |
| editor | 可   | 可   | 不可         | 不可            |
| owner  | 可   | 可   | 可           | 可              |

### 共有フロー

```
オーナーが「共有」ボタンをクリック
  ↓
メールアドレスを入力 + ロール選択（閲覧 / 編集）
  ↓
招待メール送信（Supabase Edge Function 経由）
  ↓
招待されたユーザーがログイン
  ↓
プロジェクト一覧に共有プロジェクトが表示される
```

### RLS ポリシー

```sql
-- projects: オーナーまたはメンバーのみアクセス
alter table public.projects enable row level security;

create policy "Owner and members can view projects"
  on public.projects for select
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.project_members
      where project_id = projects.id and user_id = auth.uid()
    )
  );

create policy "Owner and editors can update projects"
  on public.projects for update
  using (
    owner_id = auth.uid()
    or exists (
      select 1 from public.project_members
      where project_id = projects.id
        and user_id = auth.uid()
        and role in ('editor', 'owner')
    )
  );

-- 他テーブル（pages, datasets, charts, images）も同様のポリシーを適用
```

---

## UI 変更

### プロジェクト一覧画面（新規）

ログイン後の最初の画面。ダッシュボード的な役割。

```
┌──────────────────────────────────────────┐
│ Lablate                    [👤 ユーザー] │
├──────────────────────────────────────────┤
│                                          │
│ マイプロジェクト          [+ 新規作成]   │
│                                          │
│  📁 実験A（ローカル）     最終編集: 4/14 │
│  ☁️ 実験B（クラウド）     最終編集: 4/13 │
│  👥 共有プロジェクトC     最終編集: 4/12 │
│                                          │
│ 共有されたプロジェクト                   │
│                                          │
│  👥 田中さんの実験D（閲覧のみ）         │
│                                          │
└──────────────────────────────────────────┘
```

### 共有ダイアログ

```
┌─ プロジェクトを共有 ──────────────────┐
│                                        │
│ メールアドレス: [____________] [招待]   │
│ ロール: [編集者 ▼]                     │
│                                        │
│ メンバー:                              │
│  👤 自分（オーナー）                   │
│  👤 tanaka@univ.ac.jp（編集者）[×]     │
│  👤 suzuki@univ.ac.jp（閲覧者）[×]     │
│                                        │
│ リンクで共有: [https://...] [コピー]   │
│                                        │
└────────────────────────────────────────┘
```

### 設定 / プラン画面

```
┌─ アカウント設定 ──────────────────────┐
│                                        │
│ プラン: Free                           │
│ [Pro にアップグレード]                 │
│                                        │
│ プロフィール:                          │
│  名前: [____________]                  │
│  メール: user@example.com              │
│                                        │
│ [ログアウト]                           │
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
STRIPE_TEAM_PRICE_ID=price_...
```

---

## 実装の優先順位

Phase 6 は範囲が広いため、以下の順で段階的に実装する：

```
Step 1: クラウド保存（cloud-provider + DB テーブル + RLS）
  → ログインユーザーが自分のプロジェクトをクラウドに保存できる

Step 2: プロジェクト一覧画面
  → ローカル / クラウドのプロジェクトを統合表示

Step 3: プロジェクト共有
  → メンバー招待、ロール管理、RLS による制御

Step 4: Stripe 連携
  → 課金、プラン管理、機能制限
```

---

## 完了条件

### サブスクリプション

- [ ] Stripe アカウントセットアップ
- [ ] Checkout セッション API
- [ ] Webhook 受信 → プラン更新
- [ ] Customer Portal（プラン変更・解約）
- [ ] プラン表示 UI
- [ ] 機能制限（Free ユーザーのクラウド保存ブロック等）

### クラウド保存

- [ ] DB テーブル作成（projects, pages, datasets, charts, images）
- [ ] RLS ポリシー設定
- [ ] cloud-provider.ts 実装
- [ ] プロジェクト作成時に保存先選択（ローカル / クラウド）
- [ ] デバウンス付き自動保存（クラウド）
- [ ] クラウドからの読み込み
- [ ] 画像の Supabase Storage 保存
- [ ] 楽観的ロックによる競合検出

### プロジェクト共有

- [ ] project_members テーブル + RLS
- [ ] メンバー招待（メール送信）
- [ ] ロール管理 UI（owner / editor / viewer）
- [ ] 共有プロジェクト一覧表示
- [ ] 権限に応じた UI 制御（viewer は編集不可）

### UI

- [ ] プロジェクト一覧画面
- [ ] 共有ダイアログ
- [ ] 設定 / プラン画面
- [ ] アップグレード誘導 UI

---

## スコープ外（Phase 7 以降）

- リアルタイム同時編集（CRDT / Yjs）
- LLM 統合（Markdown → PPT 自動生成、データ分析）
- チーム管理画面（管理者ダッシュボード）
- 監査ログ
- SSO（SAML）対応
- オンプレミス版 Supabase のデプロイガイド
- モバイルアプリ
