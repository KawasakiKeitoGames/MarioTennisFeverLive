"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LangToggle from "../components/LangToggle";
import { useLang } from "../components/LocaleProvider";
import type { Lang } from "@/lib/i18n";

interface SearchRow {
  channel_id: string;
  channel_name: string;
  platform: string;
  first_seen: string;
  last_seen: string;
  stream_hours: number;
  peak_viewers: number;
}

function relativeTime(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (lang === "en") {
    if (min < 60) return `${Math.max(min, 0)}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  }
  if (min < 60) return `${Math.max(min, 0)}分前`;
  if (h < 24) return `${h}時間前`;
  return `${d}日前`;
}

export default function StreamersPage() {
  const { lang, t } = useLang();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState("");

  // 入力から300ms待って検索（空なら「最近配信したch」）
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/streamers/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => {
          setRows(json.results ?? []);
          setSearched(json.q ?? "");
        })
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.home")}
        </Link>
        <Link
          href="/analytics"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.analytics")}
        </Link>
        <span className="ml-auto">
          <LangToggle />
        </span>
      </div>

      <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
        {lang === "en" ? (
          <>
            Streamer <span className="text-brand">Search</span>
          </>
        ) : (
          <>
            配信者<span className="text-brand">検索</span>
          </>
        )}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{t("st.subtitle")}</p>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("st.placeholder")}
        className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      <h2 className="mb-2 mt-5 text-sm font-black text-slate-700">
        {searched ? t("st.resultsHeader") : t("st.recentHeader")}
      </h2>
      {loading ? (
        <div className="py-14 text-center text-slate-400">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400 shadow-sm">
          {t("st.noResults")}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {rows.map((r) => (
            <li key={`${r.platform}-${r.channel_id}`}>
              <Link
                href={`/streamers/${r.platform}/${encodeURIComponent(r.channel_id)}`}
                className="flex items-center gap-3 p-3 transition-colors hover:bg-slate-50"
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${
                    r.platform === "twitch" ? "bg-twitch" : "bg-youtube"
                  }`}
                >
                  {r.channel_name.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-slate-800">{r.channel_name}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {r.platform === "twitch" ? "Twitch" : "YouTube"}・
                    {t("st.lastStreamed")} {relativeTime(r.last_seen, lang)}
                  </div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-slate-500">
                  <div className="font-bold tabular-nums text-slate-800">
                    {r.stream_hours.toLocaleString()}h
                  </div>
                  <div className="tabular-nums">
                    {t("hist.peak")} {r.peak_viewers.toLocaleString()}
                  </div>
                </div>
                <span className="shrink-0 text-slate-300">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-400">
        {t("common.disclaimerShort")}
      </p>
    </main>
  );
}
