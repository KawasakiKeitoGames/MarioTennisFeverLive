"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import Timeline, { type Session } from "./Timeline";
import { GAMES, gameLabel, type GameId } from "@/lib/games";
import LangToggle from "../components/LangToggle";
import { useLang } from "../components/LocaleProvider";
import { intlLocale, type Lang } from "@/lib/i18n";

type Platform = "all" | "youtube" | "twitch";
interface TotalPoint {
  t: number; // epoch ms
  total: number;
}

const RANGES = [
  { ja: "6時間", en: "6h", hours: 6 },
  { ja: "24時間", en: "24h", hours: 24 },
  { ja: "3日", en: "3d", hours: 72 },
  { ja: "7日", en: "7d", hours: 168 },
  { ja: "30日", en: "30d", hours: 720 },
];
const PLATFORMS: { key: Platform; label: string | null }[] = [
  { key: "all", label: null }, // null＝翻訳（common.all＝「すべて」）を使う
  { key: "youtube", label: "YouTube" },
  { key: "twitch", label: "Twitch" },
];
const BRAND = "#1f9d4d";
const YOUTUBE = "#e62117";
const TWITCH = "#9146ff";

// X軸ラベル（JST）。期間が長いほど日付主体に。
function jstAxis(t: number, hours: number, lang: Lang): string {
  const d = new Date(t);
  const loc = intlLocale(lang);
  const o: Intl.DateTimeFormatOptions = { timeZone: "Asia/Tokyo", hour12: false };
  if (hours <= 24) return d.toLocaleTimeString(loc, { ...o, hour: "2-digit", minute: "2-digit" });
  if (hours <= 72) return d.toLocaleString(loc, { ...o, month: "numeric", day: "numeric", hour: "2-digit" });
  return d.toLocaleDateString(loc, { ...o, month: "numeric", day: "numeric" });
}

// ツールチップ用のフル日時（JST）。
function jstFull(t: number, lang: Lang): string {
  return new Date(t).toLocaleString(intlLocale(lang), {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function HistoryPage() {
  const { lang, t } = useLang();
  const [hours, setHours] = useState(24);
  const [platform, setPlatform] = useState<Platform>("all");
  const [game, setGame] = useState<"all" | GameId>("all");
  const [points, setPoints] = useState<TotalPoint[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [now, setNow] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const pfq = platform === "all" ? "" : `&platform=${platform}`;
    const gq = game === "all" ? "" : `&game=${game}`;
    Promise.all([
      fetch(`/api/history/total?hours=${hours}${pfq}${gq}`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/history/sessions?hours=${hours}${gq}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([tot, ses]) => {
        setPoints(tot.points ?? []);
        setNow(tot.now ?? Date.now());
        setSessions(ses.sessions ?? []);
      })
      .finally(() => setLoading(false));
  }, [hours, platform, game]);

  const winStart = now - hours * 3600e3;
  const winEnd = now;

  const tlSessions = useMemo(
    () => (platform === "all" ? sessions : sessions.filter((s) => s.platform === platform)),
    [sessions, platform],
  );

  const accent = platform === "twitch" ? TWITCH : platform === "youtube" ? YOUTUBE : BRAND;
  const peak = points.reduce((m, p) => Math.max(m, p.total), 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
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
      <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
        {lang === "en" ? (
          <>
            Viewer <span className="text-brand">Trends</span>
          </>
        ) : (
          <>
            視聴者数の<span className="text-brand">推移</span>
          </>
        )}
      </h1>
      <p className="mt-2 text-sm text-slate-500">{t("hist.subtitle")}</p>

      {/* コントロール */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">{t("hist.game")}</span>
          <button
            onClick={() => setGame("all")}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              game === "all"
                ? "border-brand bg-brand/10 text-brand"
                : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
            }`}
          >
            {t("common.all")}
          </button>
          {GAMES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGame(g.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                game === g.id
                  ? g.badgeClass
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${g.dotClass}`} />
              {gameLabel(g, lang)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">{t("hist.platform")}</span>
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatform(p.key)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                platform === p.key
                  ? p.key === "twitch"
                    ? "border-twitch bg-twitch/10 text-twitch"
                    : p.key === "youtube"
                      ? "border-youtube bg-youtube/10 text-youtube"
                      : "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.label ?? t("common.all")}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">{t("hist.range")}</span>
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                hours === r.hours
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {lang === "en" ? r.en : r.ja}
            </button>
          ))}
        </div>
      </div>

      {/* 総同時視聴者数の推移 */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-bold text-slate-700">{t("hist.total")}</h2>
          <span className="text-xs text-slate-400">
            {t("hist.peak")}{" "}
            <span className="font-bold tabular-nums" style={{ color: accent }}>
              {peak.toLocaleString()}
            </span>
            {lang === "ja" && <> 人</>}
          </span>
        </div>
        {loading ? (
          <div className="flex h-[240px] items-center justify-center text-slate-400">
            {t("common.loading")}
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-slate-400">
            {t("hist.noData")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <defs>
                <linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={accent} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={[winStart, winEnd]}
                tickFormatter={(v) => jstAxis(v as number, hours, lang)}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                minTickGap={40}
                stroke="#e2e8f0"
              />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} stroke="#e2e8f0" width={44} />
              <Tooltip content={<TotalTip accent={accent} />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke={accent}
                strokeWidth={2}
                fill="url(#totalFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* 配信タイムライン */}
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <h2 className="mb-3 px-1 text-sm font-bold text-slate-700">{t("hist.timeline")}</h2>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-slate-400">
            {t("common.loading")}
          </div>
        ) : (
          <Timeline sessions={tlSessions} winStart={winStart} winEnd={winEnd} hours={hours} />
        )}
      </section>

      <p className="mt-4 px-1 text-xs text-slate-400">{t("hist.note")}</p>
      <p className="mt-2 px-1 text-xs text-slate-400">{t("common.disclaimerShort")}</p>
      <Link
        href="/about"
        className="mt-2 inline-block px-1 text-xs font-bold text-slate-500 underline underline-offset-2 transition-colors hover:text-brand"
      >
        {t("nav.about")}
      </Link>
    </main>
  );
}

function TotalTip({
  active,
  label,
  payload,
  accent,
}: {
  active?: boolean;
  label?: number;
  payload?: { value?: number }[];
  accent: string;
}) {
  const { lang, t } = useLang();
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-0.5 font-bold text-slate-500">
        {typeof label === "number" ? jstFull(label, lang) : ""}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-slate-600">{t("hist.tipViewers")}</span>
        <span className="ml-auto font-bold tabular-nums" style={{ color: accent }}>
          {(v as number).toLocaleString()}
        </span>
        {lang === "ja" && <span className="text-slate-400">人</span>}
      </div>
    </div>
  );
}
