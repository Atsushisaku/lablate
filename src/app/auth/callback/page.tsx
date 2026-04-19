"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { exchangeCodeForTokens } from "@/lib/auth/cognito-client";
import { saveTokens } from "@/lib/auth/token-manager";

function CallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("ログイン処理中…");

  useEffect(() => {
    const code = searchParams.get("code");
    const err = searchParams.get("error");

    if (err) {
      setMessage(`ログインエラー: ${err}`);
      const t = setTimeout(() => router.replace("/?auth_error=" + encodeURIComponent(err)), 1500);
      return () => clearTimeout(t);
    }
    if (!code) {
      router.replace("/");
      return;
    }

    exchangeCodeForTokens(code)
      .then((tokens) => {
        saveTokens(tokens);
        router.replace("/");
      })
      .catch((e) => {
        console.error("Token exchange failed:", e);
        setMessage("ログイン処理に失敗しました。");
        setTimeout(() => router.replace("/?auth_error=token_exchange_failed"), 1500);
      });
  }, [router, searchParams]);

  return (
    <div className="flex items-center justify-center min-h-screen text-gray-500 text-sm">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
        <p>{message}</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">読み込み中…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
