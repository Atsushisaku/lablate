import type { TokenSet } from "./types";
import { refreshTokens } from "./cognito-client";

const STORAGE_KEY = "lablate_tokens";
const REFRESH_INTERVAL_MS = 55 * 60 * 1000; // 55 分
const REFRESH_EARLY_MS = 5 * 60 * 1000;     // 期限 5 分前

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function saveTokens(tokens: TokenSet): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens)); } catch { /* ignore quota */ }
}

export function loadTokens(): TokenSet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TokenSet;
    if (typeof parsed.idToken !== "string" || typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function isTokenExpiringSoon(tokens: TokenSet): boolean {
  return tokens.expiresAt - Date.now() < REFRESH_EARLY_MS;
}

/** 定期的にトークンを更新する。更新成功時 onRefresh、失敗時 onFailure を呼ぶ */
export function startAutoRefresh(
  onRefresh: (tokens: TokenSet) => void,
  onFailure: (error: Error) => void
): void {
  stopAutoRefresh();
  const tick = async () => {
    const current = loadTokens();
    if (!current?.refreshToken) return;
    if (!isTokenExpiringSoon(current)) return;
    try {
      const next = await refreshTokens(current.refreshToken);
      saveTokens(next);
      onRefresh(next);
    } catch (err) {
      onFailure(err instanceof Error ? err : new Error(String(err)));
    }
  };
  refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);
  // 起動時にも一度だけ期限チェック（期限 5 分以内なら即更新）
  void tick();
}

export function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
