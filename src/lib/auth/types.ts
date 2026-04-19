/** Cognito ID トークンから取り出したユーザー情報 */
export interface User {
  /** Cognito のユニーク ID (`sub` クレーム) */
  sub: string;
  email: string;
  /** 表示名。未設定なら email のローカル部をフォールバック */
  name: string;
  /** どのプロバイダーでログインしたか（identities 由来、ネイティブなら "Cognito"） */
  provider: "Microsoft" | "Google" | "Cognito";
}

/** トークンセット（OAuth code → token エンドポイントのレスポンス） */
export interface TokenSet {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** 絶対時刻 (ms, Date.now() 基準) */
  expiresAt: number;
}

/** 認証コンテキストが配信する状態 */
export interface AuthState {
  user: User | null; // null = 未ログイン
  loading: boolean;  // 初期化中 or トークンリフレッシュ中
  error: string | null;
}

export type AuthProvider = "Microsoft" | "Google" | "Cognito";
