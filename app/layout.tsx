import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "./ServiceWorkerRegistrar";
import AnalyticsTracker from "./AnalyticsTracker";
import { LocaleProvider } from "./components/LocaleProvider";

export const metadata: Metadata = {
  metadataBase: new URL("https://mario-tennis-fever-live.vercel.app"),
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
    siteName: "FEVER LIVE",
    locale: "ja_JP",
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
    description:
      "【非公式ファンサイト】YouTube・Twitch横断で、今配信中のマリオテニスフィーバーを一覧表示。",
    images: ["/og.png"],
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
    <html lang="ja" suppressHydrationWarning>
      <body className="font-body antialiased min-h-screen bg-slate-50 text-slate-900">
        {/* ダークテーマ初期化：描画前に html.dark を付けてライト→ダークのチラつきを防ぐ。
            設定は端末ごと（localStorage）。実際の色は globals.css のダークテーマ層を参照。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('fl-theme')==='dark'){document.documentElement.classList.add('dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0d1410')}}catch(e){}`,
          }}
        />
        <LocaleProvider>{children}</LocaleProvider>
        <ServiceWorkerRegistrar />
        <AnalyticsTracker />
      </body>
    </html>
  );
}
