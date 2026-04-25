import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { PWAInit } from "@/components/PWAInit";
import { InstallPrompt } from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "VAL-Shop",
  description: "발로란트 스킨 상점 가격 비교",
  manifest: "/manifest.webmanifest",
  themeColor: "#ff4655",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "VAL-Shop",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link rel="icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#ff4655" />
      </head>
      <body className="min-h-screen flex flex-col">
        <PWAInit />
        <InstallPrompt />
        {children}
        <Footer />
      </body>
    </html>
  );
}
