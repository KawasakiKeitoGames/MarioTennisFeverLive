import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
  description:
    "今この瞬間にマリオテニスフィーバー / Mario Tennis Fever を配信しているYouTube・Twitchチャンネルを横断表示。視聴者数の推移も。",
  openGraph: {
    title: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
    description:
      "YouTube・Twitch横断で、今配信中のマリオテニスフィーバーを一覧表示。",
    type: "website",
  },
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
      </body>
    </html>
  );
}
