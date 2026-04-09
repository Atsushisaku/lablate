import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lablate",
  description: "記録から報告書まで一気通貫の実験記録サービス",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
