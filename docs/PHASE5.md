# Lablate - Phase 5 仕様書（ドラフト）

## 目標

ユーザー認証基盤を構築し、ログイン/ログアウト機能を実装する。
Supabase をバックエンドとして採用し、将来のクラウド保存・共有・課金の土台を作る。

---

## 背景・方針

### なぜ今認証を入れるか

- Phase 6 以降のサブスクリプション・共有機能の前提条件
- 「誰がログインしているか」を識別できないと課金もアクセス制御もできない
- 認証だけ先に入れておけば、データ保存は Phase 4 のローカル方式のまま運用可能

### 技術選定: Supabase

| 要件 | Supabase の対応 |
|------|----------------|
| 認証（OAuth） | Supabase Auth（Google / Microsoft / メール対応） |
| データベース | PostgreSQL（将来のクラウド保存用） |
| セルフホスト | 可能（研究機関がオンプレで運用できる） |
| リアルタイム | Supabase Realtime（将来の同期用） |
| 料金 | 無料枠あり（月5万リクエスト、500MB DB） |

**セルフホスト可能である点が研究機関向けに重要。**
データ主権を重視する機関は自前サーバーで Supabase を運用できる。

### 認証フロー

```
ユーザーがログインボタンをクリック
  ↓
認証プロバイダー選択（Microsoft / Google / メール）
  ├─ Microsoft → Azure AD OAuth（研究機関の既存アカウント）
  ├─ Google → Google OAuth
  └─ メール → Supabase Auth メール+パスワード
  ↓
Supabase が JWT トークンを発行
  ↓
クライアントがトークンを保持（自動更新）
  ↓
ログイン状態に応じて UI を切り替え
```

---

## データベース設計（初期）

### users テーブル（Supabase Auth が自動管理）

Supabase Auth が `auth.users` テーブルを自動管理する。
アプリ固有の情報は `public.profiles` テーブルで拡張する。

```sql
-- Supabase Auth が自動管理（参考）
-- auth.users: id, email, created_at, ...

-- アプリ固有のユーザー情報
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  avatar_url text,
  plan text default 'free',           -- 'free' | 'pro' | 'team'（Phase 6）
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 新規ユーザー作成時に自動で profiles を作成するトリガー
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 実装設計

### ディレクトリ構成（新規 / 変更）

```
src/lib/
  ├─ supabase/
  │   ├─ client.ts          ← Supabase クライアント初期化
  │   ├─ auth.ts            ← 認証ヘルパー（ログイン/ログアウト/セッション取得）
  │   └─ types.ts           ← DB 型定義（Supabase CLI で自動生成可能）
  └─ ...

src/components/
  ├─ AuthProvider.tsx        ← 認証コンテキスト（ログイン状態の管理）
  ├─ LoginPage.tsx           ← ログイン画面
  └─ UserMenu.tsx            ← ヘッダー右上のユーザーメニュー
```

### supabase/client.ts

```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

### AuthProvider.tsx

```typescript
// ログイン状態を管理する React コンテキスト
interface AuthContextValue {
  user: User | null;          // null = 未ログイン
  profile: Profile | null;
  loading: boolean;
  signInWithMicrosoft: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
```

---

## UI 変更

### ログイン画面（LoginPage）

- Lablate ロゴ + キャッチコピー
- 「Microsoft でログイン」ボタン（推奨、目立たせる）
- 「Google でログイン」ボタン
- 区切り線「または」
- メール + パスワードフォーム
- 「アカウント作成」リンク

### 未ログイン時の動作

- **ログインなしでも基本機能は使える**（Phase 4 までのローカル保存）
- ログインすると追加機能（クラウド保存・共有）が有効になる
- サイドバー下部またはヘッダーに「ログインして同期を有効にする」の軽いバナー

### ログイン後のヘッダー

```
[≡] ──────────────────────────── [●同期中] [👤 ユーザー名 ▼]
                                              ├─ プロフィール
                                              ├─ プラン: Free
                                              └─ ログアウト
```

---

## 環境変数

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
```

---

## Supabase プロジェクトセットアップ手順

1. [supabase.com](https://supabase.com) でプロジェクト作成
2. Authentication > Providers で Microsoft / Google を有効化
   - Microsoft: Azure AD でアプリ登録 → Client ID / Secret を設定
   - Google: Google Cloud Console でOAuth 2.0 クライアント作成
3. SQL Editor で profiles テーブル・トリガーを作成
4. `.env.local` に URL と anon key を設定
5. Row Level Security (RLS) を有効化

### RLS ポリシー（初期）

```sql
-- profiles: 自分のプロフィールのみ読み書き可
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);
```

---

## 完了条件

- [ ] Supabase プロジェクトのセットアップ
- [ ] Microsoft OAuth ログイン
- [ ] Google OAuth ログイン
- [ ] メール+パスワード ログイン / サインアップ
- [ ] AuthProvider コンテキスト実装
- [ ] ログイン画面 UI
- [ ] ヘッダーにユーザーメニュー表示
- [ ] profiles テーブル + 自動作成トリガー
- [ ] RLS ポリシー設定
- [ ] 未ログインでもローカル機能が使える
- [ ] ログアウト後にローカルデータが消えない

---

## スコープ外（Phase 6）

- サブスクリプション（Stripe 連携）
- クラウドへのプロジェクトデータ保存
- プロジェクト共有・アクセス制御
- チーム管理
