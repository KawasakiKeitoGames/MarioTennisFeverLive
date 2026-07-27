import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "./ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
  description:
    "【非公式ファンサイト】今この瞬間にマリオテニスフィーバー / Mario Tennis Fever を配信しているYouTube・Twitchチャンネルを横断表示。視聴者数の推移も。",
  applicationName: "FEVER LIVE",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FEVER LIVE",
  },
  openGraph: {
    title: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
    description:
      "【非公式ファンサイト】YouTube・Twitch横断で、今配信中のマリオテニスフィーバーを一覧表示。",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="font-body antialiased min-h-screen bg-slate-50 text-slate-900">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
