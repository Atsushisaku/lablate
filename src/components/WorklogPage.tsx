"use client";

import dynamic from "next/dynamic";

const WorklogEditor = dynamic(() => import("./WorklogEditor"), { ssr: false });

export default function WorklogPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-6 py-3">
          <span className="text-lg font-semibold tracking-tight text-gray-800">
            Lablate
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <WorklogEditor />
      </main>
    </div>
  );
}
