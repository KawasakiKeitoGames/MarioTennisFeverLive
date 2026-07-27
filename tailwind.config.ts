import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // プラットフォーム別アクセント
        youtube: "#e62117", // YouTube レッド
        twitch: "#9146ff", // Twitch パープル
        brand: "#16a34a", // アプリのアクセント（テニスグリーン / green-600）
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
