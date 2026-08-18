"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { tr, type DictKey, type Lang } from "@/lib/i18n";

// 言語の保持と切り替え。既定は日本語（SEO・既存ユーザーへの影響なし）。
// - 保存は端末ごと（localStorage "fl-lang"）
// - ?lang=en / ?lang=ja のURLクエリでも切り替え可能（共有リンク用・開いた時点で保存）
// - SSRは常に日本語で行い、マウント後に保存値を反映する（英語設定時は一瞬日本語が見えるが許容）
const LANG_KEY = "fl-lang";

interface LocaleCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
}

const Ctx = createContext<LocaleCtx>({
  lang: "ja",
  setLang: () => {},
  t: (k) => tr("ja", k),
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ja");

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* プライベートモード等は無視 */
    }
  }, []);

  useEffect(() => {
    let init: Lang | null = null;
    try {
      const q = new URLSearchParams(window.location.search).get("lang");
      if (q === "en" || q === "ja") init = q;
      if (!init) {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved === "en" || saved === "ja") init = saved;
      }
    } catch {
      /* ignore */
    }
    if (init && init !== "ja") setLang(init);
  }, [setLang]);

  const t = useCallback((key: DictKey) => tr(lang, key), [lang]);

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useLang(): LocaleCtx {
  return useContext(Ctx);
}
