"use client";

import { useEffect, useState } from "react";
import { useLang } from "./LocaleProvider";
import FlIcon from "./FlIcon";

// ダークテーマ切り替え（SENSEKI FEVER と同じ案A グリーンティント配色）。
// 端末ごとの好みで localStorage に保存（既定はライト）。
// 適用は <html class="dark"> の付け外しのみで、色の実体は globals.css のダークテーマ層にある。
// 初期表示時の復元は layout.tsx のインラインスクリプトが描画前に行う。
const THEME_KEY = "fl-theme";
const THEME_COLOR_LIGHT = "#f8fafc";
const THEME_COLOR_DARK = "#0d1410";

export default function ThemeToggle() {
  const { t } = useLang();
  // SSRとのhydration不一致を避けるため、マウント後に現在の状態を読む
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* プライベートモード等は無視 */
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? t("theme.toLight") : t("theme.toDark")}
      title={dark ? t("theme.toLight") : t("theme.toDark")}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
    >
      <FlIcon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}
