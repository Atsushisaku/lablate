# Lablate - Phase 5 仕様書

## 目標

AWS Cognito によるユーザー認証基盤を構築し、Lablate を AWS 上で本番展開する。
**ユーザーデータはローカル / OneDrive 保存のまま**（Phase 4 の方式を維持）、Lablate が扱うのは認証情報のみ。

---

## 背景・方針

### このフェーズのゴール

- 知人・研究機関メンバー（想定数百人規模）へ配布できる状態にする
- 情シス承認を通しやすいよう、AWS 東京リージョン + ISMAP 登録済みインフラに寄せる
- Phase 6 の課金導入に備えて認証基盤を先に整える

### 認証・インフラ技術選定: AWS Cognito + AWS スタック

| 要件 | 採用技術 | 補足 |
|------|---------|------|
| 認証 | AWS Cognito User Pool | Microsoft / Google / Email 対応 |
| 静的ホスティング | S3 + CloudFront | PWA 配信 |
| リージョン | ap-northeast-1（東京） | データレジデンシー説明が容易 |
| ドメイン・証明書 | Route 53 + ACM | 独自ドメインで配信 |
| 料金 | 全て無料枠内で起動可能 | Cognito: 月 50,000 MAU まで無料 |

**AWS に統一する理由：**
- ISMAP 登録済みインフラ上で動作するため、情シス承認が通りやすい
- 「AWS 東京リージョンで完結」という一言で説明できる
- Vercel / Supabase を経由しないため、外部サービス依存の説明が不要になる

### 認証プロバイダーの優先順位

Microsoft（Azure AD）を第一推しとする。
理由: 対象ユーザー（研究機関勤務者）は既に Microsoft 365 アカウントを持っているため、新規 ID 発行が不要。

```
ユーザーがログインボタンをクリック
  ↓
Cognito Hosted UI に遷移
  ├─ Microsoft でサインイン（推奨）→ Azure AD OAuth（マルチテナント）
  ├─ Google でサインイン          → Google OAuth
  └─ メール + パスワード          → Cognito ネイティブ
  ↓
Cognito が ID / Access / Refresh トークンを発行
  ↓
クライアントがトークンを保持（localStorage）
  ↓
ログイン状態に応じて UI を切り替え
```

### 未ログインでも動く

- **ログインなしで Phase 4 までの全機能が使える**
- ログインすると将来的にクラウド保存・課金等の追加機能が有効になる（Phase 6）
- ログイン必須にはしない（情シス未承認でも個人利用ができることを重視）

---

## AWS インフラ構成

### 全体図

```
[ユーザー (Chrome / Edge)]
      ↓ HTTPS
[CloudFront]
      ↓
[S3 (PWA 静的ホスティング)]   ← Next.js の静的エクスポート

[認証フロー]
[Cognito User Pool]
  ├─ Identity Provider: Azure AD (Microsoft)
  ├─ Identity Provider: Google
  └─ Cognito ネイティブ (Email / Password)

[DNS / 証明書]
[Route 53] → [ACM]

[ユーザーのプロジェクトデータ]
→ ローカルフォルダ / OneDrive 同期フォルダ（Phase 4 の方式）
→ Lablate のインフラには保存しない
```

### 無料枠の範囲

| サービス | 無料枠 | 想定利用量（数百人規模） |
|---------|-------|----------------------|
| CloudFront | 1 TB / 月 転送 + 10M リクエスト（12 ヶ月） | 余裕 |
| S3 | 5 GB ストレージ + 2,000 PUT / 月（12 ヶ月） | 余裕（PWA は数十 MB） |
| Cognito | 月 50,000 MAU まで永続無料 | 余裕 |
| Route 53 | Hosted Zone: $0.50 / 月（無料枠なし） | 数百円 / 年 |
| ACM | 証明書発行・更新は無料 | 0 円 |

**12 ヶ月無料枠が切れるもの**: CloudFront・S3 のみ。いずれも従量課金で、数百人規模なら月数百円程度。

### リージョン選定

- 全リソース **ap-northeast-1（東京）** に統一
- Cognito も東京リージョンで構築（データレジデンシー説明のため）
- CloudFront はグローバルサービスだが、オリジン S3 が東京にあれば国内向けには問題なし

---

## 実装設計

### ディレクトリ構成（新規 / 変更）

```
src/lib/
  ├─ auth/
  │   ├─ cognito-client.ts    ← Cognito クライアント初期化
  │   ├─ auth-provider.tsx    ← 認証コンテキスト
  │   ├─ token-manager.ts     ← トークン保持・自動リフレッシュ
  │   └─ types.ts             ← User / AuthState 型定義
  └─ ...

src/components/
  ├─ LoginButton.tsx           ← ヘッダーのログインボタン
  ├─ UserMenu.tsx              ← ログイン後のユーザーメニュー
  └─ AuthCallback.tsx          ← OAuth コールバック受け取り
```

### 使用ライブラリ

- `amazon-cognito-identity-js`（AWS 公式、軽量）
- Amplify UI は **使わない**（バンドルサイズ肥大を避けるため）
- ログイン UI は Cognito Hosted UI を利用（初期段階では独自 UI を作らない）

### cognito-client.ts

```typescript
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

export const userPool = new CognitoUserPool({
  UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID!,
  ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
});

/** Hosted UI へのリダイレクト URL を生成 */
export function getHostedUiUrl(provider: "Microsoft" | "Google" | "Cognito"): string;

/** OAuth コールバックのコード → トークン交換 */
export async function exchangeCodeForToken(code: string): Promise<TokenSet>;

/** トークンから現在のユーザー情報を取得 */
export async function getCurrentUser(): Promise<User | null>;
```

### auth-provider.tsx

```typescript
interface AuthContextValue {
  user: User | null;          // null = 未ログイン
  loading: boolean;
  signIn: (provider: "Microsoft" | "Google" | "Cognito") => void;  // Hosted UI へリダイレクト
  signOut: () => Promise<void>;
}

// React Context として提供
export const AuthProvider: React.FC<{ children: React.ReactNode }>;
export function useAuth(): AuthContextValue;
```

### token-manager.ts

```typescript
/** トークンセット */
interface TokenSet {
  idToken: string;        // 1 時間で切れる
  accessToken: string;    // 1 時間で切れる
  refreshToken: string;   // 30 日
  expiresAt: number;      // Unix timestamp
}

/** localStorage への保存 */
export function saveTokens(tokens: TokenSet): void;
export function loadTokens(): TokenSet | null;
export function clearTokens(): void;

/** 期限切れ前の自動リフレッシュ（55 分ごと） */
export function startAutoRefresh(): void;
export function stopAutoRefresh(): void;
```

### Next.js App Router での注意点

- Cognito トークンは localStorage に保存されるため、SSR ではログイン状態を読めない
- ログイン必須ページは **クライアントサイドガード**（useEffect で判定 → リダイレクト）
- SSR 部分は「未ログイン」として静的生成し、ハイドレート後にログイン状態を反映

---

## UI 変更

### ヘッダー（未ログイン時）

```
┌────────────────────────────────────────────────┐
│ ≡  Lablate                      [ログイン]     │
└────────────────────────────────────────────────┘
```

- 「ログイン」ボタンをクリック → Cognito Hosted UI にリダイレクト

### ヘッダー（ログイン後）

```
┌────────────────────────────────────────────────┐
│ ≡  Lablate                    [●同期中] [👤 ▼] │
└────────────────────────────────────────────────┘
                                         ├─ プロフィール
                                         ├─ プラン: Free（Phase 6）
                                         └─ ログアウト
```

### ログイン画面（Cognito Hosted UI）

初期段階では Cognito Hosted UI をそのまま利用する。
- ロゴ・カラーは最低限カスタマイズ
- 「Microsoft でサインイン」ボタンを最上段に
- 独自 UI への置き換えは Phase 6 以降で検討

---

## 環境変数

```env
# .env.local
NEXT_PUBLIC_COGNITO_USER_POOL_ID=ap-northeast-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_DOMAIN=lablate-auth.auth.ap-northeast-1.amazoncognito.com
NEXT_PUBLIC_COGNITO_REDIRECT_URI=https://lablate.example.com/auth/callback
NEXT_PUBLIC_APP_URL=https://lablate.example.com
```

---

## セットアップ手順（AWS コンソール）

### 1. Cognito User Pool 作成

1. AWS コンソール → Cognito → ユーザープール作成
2. リージョン: ap-northeast-1
3. サインインオプション: Email を有効化
4. 必須属性: email, name
5. MFA: オプション（初期は任意、将来必須化を検討）
6. アプリクライアント: SPA 用（シークレットなし）

### 2. Hosted UI 設定

1. ドメインプレフィックス設定: `lablate-auth`
2. Callback URL: `https://lablate.example.com/auth/callback`
3. Sign out URL: `https://lablate.example.com/`
4. OAuth フロー: Authorization code grant
5. OAuth スコープ: openid, email, profile

### 3. Azure AD アプリ登録（Microsoft OAuth）

1. Azure Portal → アプリ登録 → 新規登録
2. サポートされているアカウントの種類: **マルチテナント + 個人の Microsoft アカウント**
3. リダイレクト URI: Cognito が発行した URL を入力
4. 「証明書とシークレット」でクライアントシークレット発行
5. API のアクセス許可: `openid`, `email`, `profile`
6. Cognito の Identity Provider 設定に Client ID / Secret を入力

### 4. Google OAuth クライアント作成

1. Google Cloud Console → API とサービス → 認証情報
2. OAuth 2.0 クライアント ID 作成（ウェブアプリ）
3. 承認済みリダイレクト URI: Cognito が発行した URL
4. Cognito の Identity Provider 設定に Client ID / Secret を入力

### 5. S3 + CloudFront セットアップ

1. S3 バケット作成（例: `lablate-prod-app`）、パブリックアクセスブロック有効
2. CloudFront ディストリビューション作成、オリジンを S3 に設定（OAC 使用）
3. カスタムドメイン + ACM 証明書設定
4. Route 53 で A レコード → CloudFront に向ける

### 6. Next.js 静的エクスポート設定

```typescript
// next.config.ts
export default {
  output: "export",
  images: { unoptimized: true },
};
```

ビルド成果物（`out/` ディレクトリ）を S3 に同期してデプロイ。

---

## デプロイフロー

### 手動デプロイ（Phase 5 初期）

```bash
npm run build
aws s3 sync out/ s3://lablate-prod-app --delete
aws cloudfront create-invalidation --distribution-id XXX --paths "/*"
```

### 自動デプロイ（Phase 5 途中で GitHub Actions 化）

```yaml
# .github/workflows/deploy.yml（後で作成）
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
      - run: npm ci && npm run build
      - run: aws s3 sync out/ s3://lablate-prod-app --delete
      - run: aws cloudfront create-invalidation ...
```

---

## 情シス承認向けの説明資料テンプレート

研究機関に展開する際、情シスから求められる可能性のある説明：

| 質問 | 回答 |
|------|------|
| データはどこに保存されるか | ユーザーのローカル PC / 所属機関の OneDrive。Lablate のサーバーには保存されない |
| 外部サービスとの通信は | AWS 東京リージョンへの認証リクエストのみ。実験データの送信はなし |
| 認証基盤は | AWS Cognito（ISMAP 登録済み AWS 上で動作）+ Microsoft 365 連携 |
| 個人情報の取り扱い | 認証情報（メールアドレス、表示名）のみ取得。研究データは取得しない |
| データの削除 | アカウント削除 API で認証情報を消去。ユーザーのローカルファイルは別途削除 |

---

## 完了条件

### インフラ

- [ ] AWS アカウント作成（個人用と分離）
- [ ] Route 53 でドメイン取得 + ACM 証明書発行
- [ ] S3 バケット + CloudFront ディストリビューション作成
- [ ] Cognito User Pool 作成
- [ ] Azure AD アプリ登録 + Microsoft OAuth 設定
- [ ] Google OAuth クライアント作成 + 設定
- [ ] Hosted UI カスタマイズ（ロゴ・カラー）

### アプリ実装

- [ ] `amazon-cognito-identity-js` 導入
- [ ] cognito-client.ts 実装
- [ ] AuthProvider コンテキスト実装
- [ ] トークン自動リフレッシュ
- [ ] OAuth コールバック受け取り
- [ ] ヘッダーにログインボタン / ユーザーメニュー表示
- [ ] Next.js 静的エクスポート対応

### 運用準備

- [ ] GitHub Actions での自動デプロイ
- [ ] プライバシーポリシー作成（個人情報の取り扱い）
- [ ] 利用規約作成（無保証、データ損失の免責）
- [ ] 特商法表記（将来の有料化に備えて）
- [ ] 情シス向け説明資料テンプレート作成

### 品質

- [ ] 未ログインでも Phase 4 までの全機能が動作する
- [ ] ログアウト後もローカルデータが消えない
- [ ] トークン期限切れ時の自動リフレッシュが動く
- [ ] OAuth コールバック後に元のページに戻る

---

## スコープ外（Phase 6）

- サブスクリプション課金（Stripe）
- Lablate サーバーへのクラウド保存（方針転換: 共有は OneDrive 共有フォルダを推奨）
- プロジェクト共有機能（OneDrive 共有フォルダで代替）
- MFA 必須化
- SSO / SAML 対応
