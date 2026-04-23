/**
 * Root Layout
 */

import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "Valshop - 발로란트 상점",
  description: "오늘의 발로란트 상점 스킨 확인",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen flex flex-col">
        {children}
        <Footer />
      </body>
    </html>
  );
}
