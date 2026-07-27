import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Mario Tennis Fever = テニスコートの世界観
        clay: "#c65f3f",       // クレーコートの赤茶（アクセント）
        court: "#3f7d5a",      // ハードコート/芝の緑
        courtdk: "#2b5a41",
        chalk: "#f4f1e8",      // ライン（オフホワイト）
        ink: "#161b17",        // ほぼ黒（背景）
        panel: "#1e2620",      // パネル
        line: "#33403a",       // 罫線
        sub: "#8fa197",        // サブテキスト
        ball: "#d8ef4a",       // テニスボールの蛍光イエロー（ライブ表示）
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
