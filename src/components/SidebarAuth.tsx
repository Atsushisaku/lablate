"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, User as UserIcon, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-provider";

export default function SidebarAuth() {
  const { user, loading, signIn, signOut, isMock, error } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 外側クリックでメニューを閉じる
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  if (loading) {
    return (
      <div className="px-3 pt-2 pb-1">
        <div className="h-7 rounded bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={() => signIn()}
          className="flex items-center justify-center gap-1.5 w-full text-xs text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 rounded py-1.5 transition-colors"
          title={isMock ? "モックログイン (開発用)" : "Cognito Hosted UI へ"}
        >
          <LogIn size={13} className="shrink-0" />
          <span>ログイン{isMock ? "（モック）" : ""}</span>
        </button>
        {error && (
          <div className="mt-1 text-[10px] text-red-500 truncate" title={error}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // ログイン済み
  const displayName = user.name || user.email || user.sub;
  return (
    <div className="px-3 pt-2 pb-1" ref={wrapperRef}>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-1.5 w-full text-left text-xs text-gray-700 hover:bg-gray-100 rounded px-1.5 py-1 transition-colors"
          title={user.email || displayName}
        >
          <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600">
            <UserIcon size={11} />
          </span>
          <span className="flex-1 min-w-0 truncate font-medium">
            {displayName}
          </span>
          <ChevronDown
            size={13}
            className={`shrink-0 text-gray-400 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          />
        </button>
        {isMock && (
          <span className="absolute -top-1 -right-1 text-[9px] bg-yellow-100 text-yellow-700 border border-yellow-200 rounded px-1 leading-3">
            mock
          </span>
        )}
        {menuOpen && (
          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-md z-20 py-1 text-xs">
            <div className="px-3 py-1.5 text-gray-500 truncate border-b border-gray-100">
              <div className="text-gray-700 font-medium truncate">{user.name || "(名前未設定)"}</div>
              {user.email && <div className="text-[11px] text-gray-400 truncate">{user.email}</div>}
              <div className="text-[10px] text-gray-400 mt-0.5">
                プロバイダー: {user.provider}
              </div>
            </div>
            <button
              onClick={() => { setMenuOpen(false); signOut(); }}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-gray-600 hover:bg-gray-100"
            >
              <LogOut size={12} />
              ログアウト
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
