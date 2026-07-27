import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FEVER LIVE — マリオテニスフィーバー 配信中まとめ",
    short_name: "FEVER LIVE",
    description:
      "【非公式ファンサイト】YouTube・Twitch横断で、いま配信中のマリオテニスフィーバーを一覧表示。",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#f8fafc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
