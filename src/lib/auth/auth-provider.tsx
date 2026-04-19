"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AuthState, User, AuthProvider as ProviderKind } from "./types";
import {
  getLoginUrl,
  getLogoutUrl,
  parseUserFromIdToken,
} from "./cognito-client";
import {
  clearTokens,
  loadTokens,
  saveTokens,
  startAutoRefresh,
  stopAutoRefresh,
} from "./token-manager";

interface AuthContextValue extends AuthState {
  /** Hosted UI へリダイレクト（mock モード時は即時ログイン） */
  signIn: (provider?: Exclude<ProviderKind, "Cognito">) => void;
  /** ログアウト */
  signOut: () => void;
  /** mock モードで動作しているか */
  isMock: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const MOCK_USER: User = {
  sub: "mock-user-001",
  email: "mock@example.com",
  name: "Mock User",
  provider: "Cognito",
};

const MOCK_STORAGE_KEY = "lablate_auth_mock";

function isMockEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_MOCK === "1";
}

function loadMockUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as User;
  } catch { return null; }
}

function saveMockUser(user: User | null): void {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(MOCK_STORAGE_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });
  const mock = isMockEnabled();

  // ── 初期化: localStorage から復元 ──
  useEffect(() => {
    if (mock) {
      setState({ user: loadMockUser(), loading: false, error: null });
      return;
    }

    const tokens = loadTokens();
    if (!tokens) {
      setState({ user: null, loading: false, error: null });
      return;
    }
    try {
      const user = parseUserFromIdToken(tokens.idToken);
      setState({ user, loading: false, error: null });
      startAutoRefresh(
        (next) => {
          try {
            const refreshed = parseUserFromIdToken(next.idToken);
            setState({ user: refreshed, loading: false, error: null });
          } catch { /* ignore parse errors on refresh */ }
        },
        () => {
          // リフレッシュ失敗 → ログアウト扱い
          clearTokens();
          stopAutoRefresh();
          setState({ user: null, loading: false, error: "セッションが切れました。再ログインしてください。" });
        }
      );
    } catch {
      clearTokens();
      setState({ user: null, loading: false, error: null });
    }
    return () => stopAutoRefresh();
  }, [mock]);

  const signIn = useCallback((provider?: Exclude<ProviderKind, "Cognito">) => {
    if (mock) {
      saveMockUser(MOCK_USER);
      setState({ user: MOCK_USER, loading: false, error: null });
      return;
    }
    try {
      window.location.href = getLoginUrl(provider);
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : "ログインに失敗しました" }));
    }
  }, [mock]);

  const signOut = useCallback(() => {
    if (mock) {
      saveMockUser(null);
      setState({ user: null, loading: false, error: null });
      return;
    }
    clearTokens();
    stopAutoRefresh();
    setState({ user: null, loading: false, error: null });
    try { window.location.href = getLogoutUrl(); } catch { /* config 未設定なら何もしない */ }
  }, [mock]);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut, isMock: mock }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
