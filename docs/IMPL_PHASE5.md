# Lablate - Phase 5 実装指示書（Claude Code 用）

このドキュメントは `PHASE5.md`（設計仕様）を補完する、実装作業用の指示書です。

設計の背景や全体方針は PHASE5.md を参照してください。
本ドキュメントでは **「何をどう作るか」「何を作らないか」「どう依頼するか」** を明確にします。

---

## 前提

### 作業状況

- AWS 側のリソース（Cognito、Azure AD、Google OAuth）は **並行して人間が設定中**
- **環境変数の実値はまだない**。キー名だけ使って実装すること
- 動作確認は全実装完了 + AWS 設定完了の合流後に行う
- 既存アプリ（Phase 1〜4）は Vercel 上で稼働中

### 絶対に守るべきこと

- **仮の環境変数値を書かない**。値は空欄のまま `.env.local.example` にキー名だけ書く
- **既存機能を壊さない**。Phase 1〜4 の動作を保証すること
- **未ログインでも全機能が使える**状態を維持する（ログイン必須化しない）
- 既存ファイルを編集する場合は、変更箇所を diff で明示する

---

## 実装する範囲

### ✅ このフェーズで実装するもの

1. `amazon-cognito-identity-js` の導入
2. Cognito Hosted UI へのリダイレクト（Microsoft / Google / Email）
3. OAuth コールバック受信 → トークン取得 → localStorage 保存
4. AuthProvider コンテキスト（ログイン状態の配信）
5. ヘッダー右上のログインボタン / ユーザーメニュー
6. ログアウト機能
7. トークンの自動リフレッシュ（55分ごと）

### ❌ このフェーズで実装しないもの

- AWS 側の設定（人間が並行実施）
- サブスクリプション課金（Phase 6）
- クラウドへのデータ保存（OneDrive 共有フォルダに委譲、Phase 6 方針変更）
- 機能制限（未ログインでも全機能使える）
- プロフィール編集画面（将来対応）
- MFA / SSO（Phase 7 以降）

---

## ファイル配置

### 新規作成するファイル

```
src/lib/auth/
  ├─ cognito-client.ts     ← Cognito クライアント初期化 + Hosted UI URL 生成
  ├─ auth-provider.tsx     ← React Context（ログイン状態の管理）
  ├─ token-manager.ts      ← localStorage トークン保持 + 自動リフレッシュ
  └─ types.ts              ← User / TokenSet / AuthState 型定義

src/app/auth/callback/
  └─ page.tsx              ← OAuth コード受信 → トークン交換 → ホームへ

src/components/
  ├─ LoginButton.tsx       ← 未ログイン時にヘッダー右上に表示
  └─ UserMenu.tsx          ← ログイン後にヘッダー右上に表示（ドロップダウン）
```

### 編集する既存ファイル

```
src/app/layout.tsx         ← AuthProvider でアプリ全体をラップ
src/components/Header.tsx  ← （既存のヘッダー）LoginButton / UserMenu を組み込み
.env.local.example         ← 新規作成 or 既存に追記
package.json               ← 依存パッケージ追加
```

**注意**: 既存のヘッダーコンポーネントの正確なパス・構造は、現状のコードを確認してから組み込むこと。
ヘッダーに既に配置されている要素（接続ステータスインジケーター等）を壊さないように。

---

## 環境変数

### `.env.local.example`（新規作成）

```env
# AWS Cognito 設定（値は人間が AWS 側設定完了後に入力）
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_CLIENT_ID=
NEXT_PUBLIC_COGNITO_DOMAIN=
NEXT_PUBLIC_COGNITO_REGION=ap-northeast-1

# コールバック URL（環境ごとに変わる）
NEXT_PUBLIC_COGNITO_REDIRECT_URI=http://localhost:3000/auth/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 本番用の値（Vercel 側で別途設定予定）

```env
NEXT_PUBLIC_COGNITO_REDIRECT_URI=https://lablate.com/auth/callback
NEXT_PUBLIC_APP_URL=https://lablate.com
```

---

## 実装詳細

### 1. 依存パッケージ

```json
{
  "dependencies": {
    "amazon-cognito-identity-js": "^6.3.x"
  }
}
```

- Amplify UI は **使わない**（バンドルサイズを抑えるため）
- ログイン UI は Cognito Hosted UI を利用（独自 UI は作らない）

### 2. `types.ts`

```typescript
/** Cognito から取得したユーザー情報 */
export interface User {
  sub: string;              // Cognito のユニーク ID
  email: string;
  name: string;
  provider: "Microsoft" | "Google" | "Cognito";  // どのプロバイダーでログインしたか
}

/** トークンセット */
export interface TokenSet {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;        // Unix timestamp (ms)
}

/** 認証状態 */
export interface AuthState {
  user: User | null;        // null = 未ログイン
  loading: boolean;         // 初期化中 or トークンリフレッシュ中
  error: string | null;
}
```

### 3. `cognito-client.ts`

```typescript
import { CognitoUserPool } from "amazon-cognito-identity-js";

export const userPool = new CognitoUserPool({
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
});

/** Hosted UI のログイン URL を生成 */
export function getLoginUrl(provider?: "Microsoft" | "Google"): string {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const redirectUri = encodeURIComponent(
    process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI!
  );
  const scope = encodeURIComponent("openid email profile");
  const base = `https://${domain}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;

  if (provider === "Microsoft") {
    return `${base}&identity_provider=Microsoft`;
  }
  if (provider === "Google") {
    return `${base}&identity_provider=Google`;
  }
  return base;  // Hosted UI のログイン画面を表示（全プロバイダー選択可）
}

/** Hosted UI のログアウト URL */
export function getLogoutUrl(): string {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const logoutUri = encodeURIComponent(process.env.NEXT_PUBLIC_APP_URL!);
  return `https://${domain}/logout?client_id=${clientId}&logout_uri=${logoutUri}`;
}

/** OAuth コード → トークン交換 */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI;

  const response = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId!,
      code,
      redirect_uri: redirectUri!,
    }),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** リフレッシュトークンで新しいアクセストークンを取得 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet>;

/** ID トークンをデコードしてユーザー情報を取得 */
export function parseUserFromIdToken(idToken: string): User;
```

### 4. `token-manager.ts`

```typescript
const STORAGE_KEY = "lablate_tokens";

/** トークンを localStorage に保存 */
export function saveTokens(tokens: TokenSet): void;

/** localStorage からトークンを読み込み */
export function loadTokens(): TokenSet | null;

/** トークンを削除（ログアウト時） */
export function clearTokens(): void;

/** 期限切れチェック（5 分前までに true） */
export function isTokenExpiringSoon(tokens: TokenSet): boolean;

/** 55 分ごとに自動リフレッシュ開始 */
export function startAutoRefresh(onRefresh: (tokens: TokenSet) => void): void;

/** 自動リフレッシュ停止 */
export function stopAutoRefresh(): void;
```

### 5. `auth-provider.tsx`

```typescript
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { AuthState, User } from "./types";
import { getLoginUrl, getLogoutUrl, parseUserFromIdToken, refreshTokens } from "./cognito-client";
import { clearTokens, loadTokens, saveTokens, startAutoRefresh, stopAutoRefresh } from "./token-manager";

interface AuthContextValue extends AuthState {
  signIn: (provider?: "Microsoft" | "Google") => void;     // Hosted UI へリダイレクト
  signOut: () => void;                                      // トークン削除 + Cognito ログアウト
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  // 初期化: localStorage からトークンを読み込み
  useEffect(() => {
    const tokens = loadTokens();
    if (tokens) {
      try {
        const user = parseUserFromIdToken(tokens.idToken);
        setState({ user, loading: false, error: null });
        startAutoRefresh((newTokens) => saveTokens(newTokens));
      } catch {
        clearTokens();
        setState({ user: null, loading: false, error: null });
      }
    } else {
      setState({ user: null, loading: false, error: null });
    }

    return () => stopAutoRefresh();
  }, []);

  const signIn = (provider?: "Microsoft" | "Google") => {
    window.location.href = getLoginUrl(provider);
  };

  const signOut = () => {
    clearTokens();
    stopAutoRefresh();
    setState({ user: null, loading: false, error: null });
    window.location.href = getLogoutUrl();
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

### 6. OAuth コールバックページ

`src/app/auth/callback/page.tsx`

```typescript
"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeCodeForTokens, parseUserFromIdToken } from "@/lib/auth/cognito-client";
import { saveTokens } from "@/lib/auth/token-manager";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      console.error("OAuth error:", error);
      router.replace("/?auth_error=" + error);
      return;
    }

    if (!code) {
      router.replace("/");
      return;
    }

    exchangeCodeForTokens(code)
      .then((tokens) => {
        saveTokens(tokens);
        router.replace("/");  // ホームへリダイレクト
      })
      .catch((err) => {
        console.error("Token exchange failed:", err);
        router.replace("/?auth_error=token_exchange_failed");
      });
  }, [router, searchParams]);

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <p>ログイン処理中...</p>
    </div>
  );
}
```

### 7. UI コンポーネント

#### `LoginButton.tsx`（未ログイン時）

```typescript
"use client";

import { useAuth } from "@/lib/auth/auth-provider";

export function LoginButton() {
  const { signIn } = useAuth();
  return (
    <button
      onClick={() => signIn()}
      className="..."  // 既存のボタンスタイルに合わせる
    >
      ログイン
    </button>
  );
}
```

#### `UserMenu.tsx`（ログイン後）

ドロップダウンメニュー。以下の項目：

- ユーザー名・メールアドレス表示（ヘッダー）
- （将来: プロフィール）※グレーアウト or 非表示でOK
- ログアウト

既存の UI ライブラリ・スタイル体系に合わせて実装。新しい UI ライブラリを追加しないこと。

#### 既存ヘッダーへの組み込み

```typescript
// 既存ヘッダー内
{user ? <UserMenu /> : <LoginButton />}
```

既存の接続ステータスインジケーター等は**絶対に壊さない**こと。

### 8. `layout.tsx` への AuthProvider 組み込み

```typescript
// src/app/layout.tsx
import { AuthProvider } from "@/lib/auth/auth-provider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

既存の Provider（あれば）とネスト順を確認して組み込むこと。

---

## 動作要件

### 機能要件

- [ ] 未ログインでも Phase 4 までの全機能が動作する
- [ ] 「ログイン」ボタンクリック → Cognito Hosted UI にリダイレクト
- [ ] Microsoft / Google / Email でログインできる
- [ ] ログイン後にユーザー名がヘッダーに表示される
- [ ] ページリロード後もログイン状態が維持される
- [ ] ログアウト後はローカルデータが消えない（lablate_* の localStorage キーは保持）
- [ ] トークン期限切れ前に自動リフレッシュされる

### エラーハンドリング

- [ ] OAuth エラー時の表示（URL パラメータで受け取る）
- [ ] トークン期限切れ + リフレッシュ失敗時はログアウト扱い
- [ ] ネットワークエラー時の再試行 or エラーメッセージ

### 非機能要件

- [ ] SSR / SSG でエラーが出ない（`typeof window === "undefined"` のチェック）
- [ ] 初期ロード時のちらつき最小化（loading 状態の適切な表示）
- [ ] TypeScript の strict mode でエラーなし

---

## Next.js App Router の注意点

- Cognito トークンは `localStorage` に保存するため、サーバー側では読めない
- ログイン必須のページ（今回はなし）は **クライアントサイドガード**（useEffect）で実装
- SSR 時は「未ログイン」として扱い、ハイドレート後に状態更新
- `"use client"` ディレクティブを必要な箇所に適切に付与

---

## 実装の依頼順序

以下のステップで **分割して依頼** してください。各ステップ完了後に動作確認（可能な範囲で）を挟む：

### Step 1: 基盤（依存追加 + 型 + 環境変数）

- `amazon-cognito-identity-js` 追加
- `src/lib/auth/types.ts`
- `.env.local.example` 作成

### Step 2: Cognito クライアント + トークン管理

- `src/lib/auth/cognito-client.ts`
- `src/lib/auth/token-manager.ts`

### Step 3: AuthProvider + フック

- `src/lib/auth/auth-provider.tsx`
- `src/app/layout.tsx` への組み込み

### Step 4: UI コンポーネント

- `src/components/LoginButton.tsx`
- `src/components/UserMenu.tsx`
- 既存ヘッダーへの組み込み

### Step 5: OAuth コールバック

- `src/app/auth/callback/page.tsx`

### Step 6: 仕上げ

- エラーハンドリング
- ローディング状態の UX 調整
- 型チェック・リント通過

---

## 実装完了時の成果物

Claude Code が実装を完了した際、以下を報告すること：

1. **新規作成したファイル一覧**
2. **編集した既存ファイルの diff**（変更箇所を明示）
3. **追加した依存パッケージ**
4. **動作確認ができなかった箇所**（環境変数未設定のため）
5. **人間側で必要な残作業**
   - 環境変数値の入力
   - AWS 側設定で必要な URL / 値
   - Vercel 側の環境変数設定

---

## 人間側の並行作業（Claude Code への情報共有用）

以下は人間が別途進める作業です。Claude Code は**これらの作業を指示したり代行したりしないこと**。

- [ ] AWS アカウント作成
- [ ] Cognito User Pool 作成（東京リージョン）
- [ ] Hosted UI ドメイン設定
- [ ] Azure AD アプリ登録 + Microsoft IdP 設定
- [ ] Google Cloud Console で OAuth クライアント作成 + Google IdP 設定
- [ ] Callback URL 登録:
  - `http://localhost:3000/auth/callback`（開発）
  - `https://lablate.com/auth/callback`（本番）
  - `https://<vercelドメイン>/auth/callback`（Vercel プレビュー、必要なら）
- [ ] 環境変数値の取得

完了後、人間が `.env.local` と Vercel 環境変数に値を入力し、動作確認を行う。

---

## 参考情報

- 設計仕様: `docs/PHASE5.md`
- Phase 4 で実装した File System Access API の仕組みは絶対に壊さないこと
- 既存のストレージ抽象化レイヤー（`src/lib/storage/`）には一切手を加えないこと
