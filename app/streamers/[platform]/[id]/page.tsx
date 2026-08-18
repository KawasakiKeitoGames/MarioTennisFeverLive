"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import LangToggle from "../../../components/LangToggle";
import { useLang } from "../../../components/LocaleProvider";
import { GAME_BY_ID, gameLabel, type GameId, isGameId } from "@/lib/games";
import { intlLocale, type Lang } from "@/lib/i18n";
import { trackOutbound } from "@/lib/track";

interface ChannelStats {
  channel_name: string;
  first_seen_all: string | null;
  last_seen: string | null;
  stream_hours: number;
  viewer_hours: number;
  peak_viewers: number;
  peak_at: string | null;
  avg_viewers: number | null;
  games: string[] | null;
}
interface GridRow {
  dow: number;
  hour: number;
  hours_count: number;
}
interface RecentStream {
  started_at: string;
  ended_at: string;
  peak_viewers: number;
  avg_viewers: number;
  hours: number;
  title: string | null;
  url: string | null;
  game: string | null;
}
interface ChannelRow {
  title: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  broadcaster_type: string | null;
}
interface DailyRow {
  day: string;
  subscriber_count: number | null;
  video_count: number | null;
}
interface RankRow {
  rank: number | null;
  total_channels: number | null;
  prev_rank: number | null;
  prev_total: number | null;
}
interface DetailData {
  stats: ChannelStats | null;
  grid: GridRow[];
  recent: RecentStream[];
  rank: RankRow | null;
  channel: ChannelRow | null;
  daily: DailyRow | null;
}

const PERIODS = [
  { ja: "7日", en: "7d", days: 7 },
  { ja: "30日", en: "30d", days: 30 },
  { ja: "90日", en: "90d", days: 90 },
];
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABEL: Record<Lang, Record<number, string>> = {
  ja: { 0: "日", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土" },
  en: { 0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa" },
};

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("ja-JP");
}
function dt(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  const p = new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}
function timeOnly(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function ymd(iso: string | null, lang: Lang): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(intlLocale(lang), {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function pfRgb(platform: string): string {
  return platform === "twitch" ? "145,70,255" : "230,33,23";
}
// チャンネルページ（外部）URL
function channelUrl(platform: string, channelId: string): string {
  return platform === "twitch"
    ? `https://www.twitch.tv/${channelId}`
    : `https://www.youtube.com/channel/${channelId}`;
}
// 配信行のリンク先（YouTube=動画・Twitch=動画一覧）
function streamUrl(platform: string, url: string | null): string | null {
  if (!url) return null;
  return platform === "twitch" ? `${url.replace(/\/$/, "")}/videos` : url;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <div className="text-xl font-black tabular-nums text-slate-900 sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default function StreamerDetailPage() {
  const { lang, t } = useLang();
  const params = useParams<{ platform: string; id: string }>();
  const platform = params.platform === "twitch" ? "twitch" : "youtube";
  const channelId = decodeURIComponent(params.id ?? "");

  const [days, setDays] = useState(30);
  const [d, setD] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!channelId) return;
    setLoading(true);
    fetch(
      `/api/streamers/detail?platform=${platform}&id=${encodeURIComponent(channelId)}&days=${days}`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((json) => setD(json))
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, [platform, channelId, days]);

  const name = d?.stats?.channel_name && d.stats.channel_name !== channelId
    ? d.stats.channel_name
    : d?.channel?.title ?? d?.stats?.channel_name ?? channelId;

  // 曜日×時間グリッド → 時間帯[24]・曜日[7]に集計
  const profile = useMemo(() => {
    const hours = new Array(24).fill(0);
    const dows = new Array(7).fill(0);
    for (const r of d?.grid ?? []) {
      hours[r.hour] += r.hours_count;
      dows[r.dow] += r.hours_count;
    }
    return { hours, dows, hourMax: Math.max(...hours, 1), dowMax: Math.max(...dows, 1) };
  }, [d]);

  const games = (d?.stats?.games ?? []).filter(isGameId) as GameId[];
  const hasData = !!d?.stats?.first_seen_all || !!d?.channel;
  const subs = d?.daily?.subscriber_count ?? null;
  const extUrl = channelUrl(platform, channelId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/streamers"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.streamers")}
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

      {loading ? (
        <div className="py-20 text-center text-slate-400">{t("common.loading")}</div>
      ) : !hasData ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-400 shadow-sm">
          {t("st.notFound")}
        </div>
      ) : (
        <>
          {/* ヘッダー：基本情報 */}
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              {d?.channel?.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.channel.thumbnail_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <span
                  className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-xl font-black text-white ${
                    platform === "twitch" ? "bg-twitch" : "bg-youtube"
                  }`}
                >
                  {name.charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-xl font-black leading-tight text-slate-900 sm:text-2xl">
                  {name}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
                      platform === "twitch"
                        ? "bg-twitch/10 text-twitch border-twitch/20"
                        : "bg-youtube/10 text-youtube border-youtube/20"
                    }`}
                  >
                    {platform === "twitch" ? "Twitch" : "YouTube"}
                  </span>
                  {games.map((gid) => {
                    const g = GAME_BY_ID.get(gid);
                    if (!g) return null;
                    return (
                      <span
                        key={gid}
                        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${g.badgeClass}`}
                      >
                        <span className={`h-1 w-1 rounded-full ${g.dotClass}`} />
                        {gameLabel(g, lang)}
                      </span>
                    );
                  })}
                </div>
              </div>
              <a
                href={extUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackOutbound({
                    platform,
                    channelId,
                    channelName: name,
                    url: extUrl,
                    kind: "channel",
                  })
                }
                className="shrink-0 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
              >
                {t("st.open")}
              </a>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              {subs != null && (
                <span>
                  {t("st.subs")}{" "}
                  <span className="font-bold tabular-nums text-slate-700">{fmt(subs)}</span>
                </span>
              )}
              {d?.channel?.published_at && (
                <span>
                  {t("st.since")}{" "}
                  <span className="font-bold text-slate-700">{ymd(d.channel.published_at, lang)}</span>
                </span>
              )}
              {d?.stats?.first_seen_all && (
                <span>
                  {t("an.firstSeen")}{" "}
                  <span className="font-bold text-slate-700">{ymd(d.stats.first_seen_all, lang)}</span>
                </span>
              )}
              {d?.stats?.last_seen && (
                <span>
                  {t("st.lastStreamed")}{" "}
                  <span className="font-bold text-slate-700">{dt(d.stats.last_seen, lang)}</span>
                </span>
              )}
            </div>

            {/* 順位（延べ視聴順・期間セレクタに連動） */}
            {d?.rank?.rank != null && (
              <div
                title={t("st.rankTitle")}
                className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-brand/15 bg-brand/5 px-3 py-2 text-xs"
              >
                <span aria-hidden>🏆</span>
                {lang === "en" ? (
                  <span className="text-slate-600">
                    Rank{" "}
                    <span className="text-base font-black tabular-nums text-brand">
                      #{d.rank.rank}
                    </span>{" "}
                    <span className="text-slate-400">
                      of {fmt(d.rank.total_channels)} (last {days}d, by viewer-hours)
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-600">
                    配信者ランキング{" "}
                    <span className="text-base font-black tabular-nums text-brand">
                      {d.rank.rank}位
                    </span>{" "}
                    <span className="text-slate-400">
                      / {fmt(d.rank.total_channels)}ch中（直近{days}日・延べ視聴順）
                    </span>
                  </span>
                )}
                {d.rank.prev_rank != null ? (
                  (() => {
                    const diff = (d.rank!.prev_rank as number) - (d.rank!.rank as number);
                    const cls =
                      diff > 0 ? "text-emerald-600" : diff < 0 ? "text-amber-600" : "text-slate-400";
                    const label =
                      diff > 0 ? `▲ +${diff}` : diff < 0 ? `▼ ${Math.abs(diff)}` : "→ ±0";
                    return (
                      <span className={`font-bold tabular-nums ${cls}`}>
                        {label}
                        <span className="ml-1 font-normal text-slate-400">
                          {lang === "en"
                            ? `vs prev. ${days}d (#${d.rank!.prev_rank})`
                            : `前の${days}日比（${d.rank!.prev_rank}位）`}
                        </span>
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-slate-400">{t("st.rankNew")}</span>
                )}
              </div>
            )}
          </div>

          {/* 期間切替 */}
          <div className="mt-4 flex items-center gap-1">
            <span className="mr-1 text-xs text-slate-400">{t("hist.range")}</span>
            {PERIODS.map((r) => (
              <button
                key={r.days}
                onClick={() => setDays(r.days)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  days === r.days
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                }`}
              >
                {lang === "en" ? r.en : r.ja}
              </button>
            ))}
          </div>

          {/* KPI */}
          <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-4 sm:p-4">
            <Stat label={t("st.kpiHours")} value={`${fmt(d?.stats?.stream_hours)}h`} />
            <Stat label={t("st.kpiViewerHours")} value={fmt(d?.stats?.viewer_hours)} />
            <Stat
              label={t("an.kpiPeak")}
              value={fmt(d?.stats?.peak_viewers)}
              sub={d?.stats?.peak_at ? dt(d.stats.peak_at, lang) : undefined}
            />
            <Stat label={t("st.kpiAvg")} value={fmt(Math.round(d?.stats?.avg_viewers ?? 0))} />
          </div>

          {/* 時間帯・曜日の傾向 */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-black text-slate-700">{t("st.hourTitle")}</h2>
              <div className="flex items-end gap-[2px]" style={{ height: 56 }}>
                {profile.hours.map((v, h) => (
                  <div
                    key={h}
                    title={
                      lang === "en" ? `${h}:00 — ${v}h streamed` : `${h}時台: 配信${v}h`
                    }
                    className="flex-1 rounded-[1px]"
                    style={{
                      height: Math.max(2, (v / profile.hourMax) * 56),
                      background: v === 0 ? "#e2e8f0" : `rgba(${pfRgb(platform)},${0.35 + (v / profile.hourMax) * 0.65})`,
                    }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-slate-300">
                <span>{lang === "en" ? "0:00" : "0時"}</span>
                <span>6</span>
                <span>12</span>
                <span>18</span>
                <span>{lang === "en" ? "23:00" : "23時"}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-black text-slate-700">{t("st.dowTitle")}</h2>
              <div className="flex items-end gap-1.5" style={{ height: 56 }}>
                {DOW_ORDER.map((dw) => {
                  const v = profile.dows[dw];
                  return (
                    <div key={dw} className="flex flex-1 flex-col items-center justify-end">
                      <div
                        title={
                          lang === "en"
                            ? `${DOW_LABEL.en[dw]} — ${v}h streamed`
                            : `${DOW_LABEL.ja[dw]}曜: 配信${v}h`
                        }
                        className="w-full rounded-[2px]"
                        style={{
                          height: Math.max(2, (v / profile.dowMax) * 44),
                          background:
                            v === 0
                              ? "#e2e8f0"
                              : `rgba(${pfRgb(platform)},${0.35 + (v / profile.dowMax) * 0.65})`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex gap-1.5">
                {DOW_ORDER.map((dw) => (
                  <div key={dw} className="flex-1 text-center text-[9px] text-slate-400">
                    {DOW_LABEL[lang][dw]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 直近の配信 */}
          <section className="mt-4">
            <h2 className="mb-2 text-sm font-black text-slate-700">{t("st.recent")}</h2>
            <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:p-3">
              {(d?.recent ?? []).length === 0 ? (
                <p className="px-2 py-4 text-xs text-slate-400">{t("tl.empty")}</p>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {(d?.recent ?? []).map((s, i) => {
                    const href = streamUrl(platform, s.url);
                    const gameDef = s.game && isGameId(s.game) ? GAME_BY_ID.get(s.game) : null;
                    const row = (
                      <>
                        <div className="w-24 shrink-0 text-[11px] leading-tight text-slate-500">
                          <div className="font-bold tabular-nums text-slate-700">
                            {dt(s.started_at, lang)}
                          </div>
                          <div className="tabular-nums">
                            〜{timeOnly(s.ended_at)}・{fmt(s.hours)}h
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs leading-snug text-slate-600">
                            {s.title ?? t("an.untitled")}
                          </div>
                          {gameDef && (
                            <span
                              className={`mt-0.5 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${gameDef.badgeClass}`}
                            >
                              <span className={`h-1 w-1 rounded-full ${gameDef.dotClass}`} />
                              {gameLabel(gameDef, lang)}
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-black tabular-nums text-slate-900">
                            {fmt(s.peak_viewers)}
                          </div>
                          <div className="text-[9px] text-slate-400">{t("hist.peak")}</div>
                        </div>
                      </>
                    );
                    return (
                      <li key={i}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              trackOutbound({
                                platform,
                                channelId,
                                channelName: name,
                                url: href,
                                kind: "vod",
                              })
                            }
                            className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50"
                          >
                            {row}
                          </a>
                        ) : (
                          <div className="flex items-center gap-3 px-2 py-2">{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{t("an.highlightsLinkNote")}</p>
          </section>

          <p className="mt-6 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-400">
            {t("st.dataNote")} {t("common.disclaimerShort")}
          </p>
        </>
      )}
    </main>
  );
}
