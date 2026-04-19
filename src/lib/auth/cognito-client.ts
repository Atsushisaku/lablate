import { CognitoUserPool } from "amazon-cognito-identity-js";
import type { TokenSet, User, AuthProvider } from "./types";

/** 実行時に環境変数が未設定でもビルドは通るよう lazy に取得 */
function env(key: string, required = false): string {
  const v = process.env[key];
  if (!v && required) {
    // 実行時に Cognito 実フローへ入った場合のみエラー（ビルド時は握る）
    throw new Error(`Missing env: ${key}`);
  }
  return v ?? "";
}

/** Cognito User Pool インスタンス（実値未設定時は参照するだけで例外にはしない） */
export function getUserPool(): CognitoUserPool | null {
  const UserPoolId = env("NEXT_PUBLIC_COGNITO_USER_POOL_ID");
  const ClientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID");
  if (!UserPoolId || !ClientId) return null;
  return new CognitoUserPool({ UserPoolId, ClientId });
}

/** Hosted UI のログイン URL を生成（provider 指定で直接 IdP へ飛ばす） */
export function getLoginUrl(provider?: Exclude<AuthProvider, "Cognito">): string {
  const domain = env("NEXT_PUBLIC_COGNITO_DOMAIN", true);
  const clientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID", true);
  const redirectUri = encodeURIComponent(env("NEXT_PUBLIC_COGNITO_REDIRECT_URI", true));
  const scope = encodeURIComponent("openid email profile");
  const base =
    `https://${domain}/oauth2/authorize` +
    `?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${scope}`;
  if (provider === "Microsoft") return `${base}&identity_provider=Microsoft`;
  if (provider === "Google") return `${base}&identity_provider=Google`;
  return base;
}

/** Hosted UI のログアウト URL */
export function getLogoutUrl(): string {
  const domain = env("NEXT_PUBLIC_COGNITO_DOMAIN", true);
  const clientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID", true);
  const logoutUri = encodeURIComponent(env("NEXT_PUBLIC_APP_URL", true));
  return `https://${domain}/logout?client_id=${clientId}&logout_uri=${logoutUri}`;
}

/** OAuth code → token エンドポイント */
export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const domain = env("NEXT_PUBLIC_COGNITO_DOMAIN", true);
  const clientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID", true);
  const redirectUri = env("NEXT_PUBLIC_COGNITO_REDIRECT_URI", true);

  const res = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** リフレッシュトークンで新しいアクセストークンを取得 */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const domain = env("NEXT_PUBLIC_COGNITO_DOMAIN", true);
  const clientId = env("NEXT_PUBLIC_COGNITO_CLIENT_ID", true);

  const res = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    // refresh_token は応答に含まれないことが多いので元の値を残す
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** base64url デコード（ブラウザ / Node 両対応） */
function base64UrlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  if (typeof atob === "function") {
    return decodeURIComponent(
      atob(b64 + pad)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  }
  // Node / SSR フォールバック
  return Buffer.from(b64 + pad, "base64").toString("utf-8");
}

/** JWT をデコード（検証はしない — Cognito の応答は信頼する） */
function decodeJwt<T = Record<string, unknown>>(token: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  return JSON.parse(base64UrlDecode(parts[1])) as T;
}

/** ID トークンから User を組み立てる */
export function parseUserFromIdToken(idToken: string): User {
  const claims = decodeJwt<{
    sub: string;
    email?: string;
    name?: string;
    identities?: { providerName?: string }[];
    "cognito:username"?: string;
  }>(idToken);
  const email = claims.email ?? "";
  const name = claims.name ?? (email ? email.split("@")[0] : (claims["cognito:username"] ?? ""));
  const providerName = claims.identities?.[0]?.providerName?.toLowerCase() ?? "";
  let provider: User["provider"] = "Cognito";
  if (providerName.includes("microsoft") || providerName.includes("azure")) provider = "Microsoft";
  else if (providerName.includes("google")) provider = "Google";
  return { sub: claims.sub, email, name, provider };
}
