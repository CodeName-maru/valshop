/**
 * Root Layout
 */

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valshop - 발로란트 상점",
  description: "오늘의 발로란트 상점 스킨 확인",
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex-1">{children}</div>;
}
