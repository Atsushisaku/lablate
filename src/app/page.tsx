"use client";

import dynamic from "next/dynamic";
import { SyncProvider } from "@/lib/storage/sync-context";

const WorklogPage = dynamic(() => import("@/components/WorklogPage"), { ssr: false });

export default function Home() {
  return (
    <SyncProvider>
      <WorklogPage />
    </SyncProvider>
  );
}
