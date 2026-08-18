"use client";

import { useLang } from "./LocaleProvider";

// JP/EN の2ボタン式言語トグル（SENSEKI FEVERと同じ見た目の方針）。
export default function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-full border border-slate-300 bg-white text-[11px] font-bold shadow-sm">
      <button
        type="button"
        onClick={() => setLang("ja")}
        aria-pressed={lang === "ja"}
        className={`px-2 py-1 transition-colors ${
          lang === "ja" ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-50"
        }`}
      >
        JP
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`px-2 py-1 transition-colors ${
          lang === "en" ? "bg-brand text-white" : "text-slate-500 hover:bg-slate-50"
        }`}
      >
        EN
      </button>
    </div>
  );
}
