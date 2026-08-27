"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { GAMES, gameLabel, type GameId } from "@/lib/games";
import LangToggle from "../components/LangToggle";
import { useLang } from "../components/LocaleProvider";
import { intlLocale, tr, type Lang } from "@/lib/i18n";
import { trackOutbound } from "@/lib/track";

type PlatformSel = "all" | "youtube" | "twitch";

interface ActivityRow {
  day: string;
  unique_streams: number;
  avg_concurrent: number;
  peak_concurrent: number;
  avg_viewers: number;
  peak_viewers: number;
}
interface Headline {
  peak_viewers: number | null;
  peak_at: string | null;
  total_stream_hours: number | null;
  active_channels: number | null;
  span_days: number | null;
}
interface HighlightStream {
  stream_id: string;
  channel_id: string | null;
  channel_name: string;
  platform: string;
  peak_viewers: number;
  avg_viewers: number | null;
  hours: number;
  started_at: string | null;
  title: string | null;
  url: string | null;
  thumbnail_url: string | null;
}
interface HeatRow {
  dow: number;
  hour: number;
  avg_concurrent: number;
}
// 配信者ページ（/streamers/{pf}/{id}）の閲覧ランキング
interface PageRankRow {
  platform: string;
  channel_id: string;
  channel_name: string;
  views: number;
  uniques: number;
  thumbnail_url: string | null;
  rank: number | null;
  prev_rank: number | null; // 直前の同じ長さの期間での順位（無ければnull）
}
interface NewChannel {
  channel_id: string;
  channel_name: string;
  platform: string;
  first_seen: string;
  appearances: number;
}
interface LeaderRow {
  channel_id: string;
  channel_name: string;
  platform: string;
  stream_hours: number;
  viewer_hours: number;
  peak_viewers: number;
  avg_viewers: number | null;
  last_seen: string;
  rank: number | null;
  prev_rank: number | null;
}
interface Growth {
  channel_id: string;
  channel_name: string;
  latest_subs: number | null;
  first_subs: number | null;
  delta: number | null;
  growth_pct: number | null;
  published_at: string | null;
  rank: number | null;
  prev_rank: number | null;
}

interface InsightsData {
  headline: Headline | null;
  activity: ActivityRow[];
  heatmap: HeatRow[];
  new_channels: NewChannel[];
  leaderboard: LeaderRow[];
  growth: Growth[];
  top_streams: HighlightStream[];
  page_ranking: PageRankRow[];
}

const PERIODS = [
  { ja: "7日", en: "7d", days: 7 },
  { ja: "30日", en: "30d", days: 30 },
  { ja: "90日", en: "90d", days: 90 },
];
const MIN_PERIOD = 7; // 常に選べる最小期間
const PLATFORMS: { key: PlatformSel; label: string | null }[] = [
  { key: "all", label: null }, // null＝翻訳（common.all）を使う
  { key: "youtube", label: "YouTube" },
  { key: "twitch", label: "Twitch" },
];

// JST曜日: 0=日。表示は月始まりにする。
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABEL: Record<Lang, Record<number, string>> = {
  ja: { 0: "日", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土" },
  en: { 0: "Su", 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: "Sa" },
};

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("ja-JP");
}
function mdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}
function dt(iso: string | null, lang: Lang = "ja"): string {
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
function pfDot(platform: string): string {
  return platform === "twitch" ? "bg-twitch" : "bg-youtube";
}
// サイト内の配信者詳細ページ（基本情報・配信傾向・直近の配信）へのパス
function streamerPath(platform: string, channelId: string): string {
  return `/streamers/${platform}/${encodeURIComponent(channelId)}`;
}
// 配信ハイライトのリンク先。YouTubeのurlは動画(watch?v=)そのもの。
// TwitchのurlはチャンネルページなのでVOD一覧(/videos)に飛ばす（動画IDは未収集のため個別VOD指定は不可）。
function highlightUrl(s: HighlightStream): string | null {
  if (!s.url) return null;
  return s.platform === "twitch" ? `${s.url.replace(/\/$/, "")}/videos` : s.url;
}
// チャンネルアイコン。画像が無いときは頭文字＋PF色の丸で代替し、
// 右下の小さなドットで YouTube / Twitch のどちらかを示す。
function ChannelIcon({
  src,
  name,
  platform,
  size = 32,
}: {
  src: string | null;
  name: string;
  platform: string;
  size?: number;
}) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full rounded-full border border-slate-200 object-cover"
        />
      ) : (
        <span
          className={`grid h-full w-full place-items-center rounded-full text-[11px] font-bold text-white ${pfDot(platform)}`}
        >
          {name.charAt(0)}
        </span>
      )}
      <span
        title={platform === "twitch" ? "Twitch" : "YouTube"}
        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${pfDot(platform)}`}
      />
    </span>
  );
}

// 直前の同じ長さの期間と比べた順位の変動（▲上昇 / ▼下降 / →横ばい / NEW＝前期間はランク外）。
// 前期間のデータが1件も無いリストでは呼び出し側で丸ごと非表示にする。
function RankDelta({ rank, prevRank }: { rank: number | null; prevRank: number | null }) {
  const { lang } = useLang();
  const ja = lang === "ja";
  if (rank == null) return null;
  if (prevRank == null) {
    return (
      <span
        title={ja ? "前の期間はランク外" : "Not ranked in the previous period"}
        className="block text-[9px] font-bold leading-none text-brand"
      >
        NEW
      </span>
    );
  }
  const diff = prevRank - rank;
  const title = ja
    ? `前の同じ長さの期間: ${prevRank}位`
    : `Previous period of the same length: #${prevRank}`;
  if (diff === 0) {
    return (
      <span title={title} className="block text-[9px] font-bold leading-none text-slate-300">
        →
      </span>
    );
  }
  return (
    <span
      title={title}
      className={`block text-[9px] font-bold leading-none tabular-nums ${
        diff > 0 ? "text-emerald-600" : "text-amber-600"
      }`}
    >
      {diff > 0 ? `▲${diff}` : `▼${-diff}`}
    </span>
  );
}

// 折りたたみ切替ボタン（縦長になりがちなリストを既定は上位だけに抑える）
function ShowMore({
  open,
  hidden,
  onToggle,
  labelAll,
  labelLess,
}: {
  open: boolean;
  hidden: number;
  onToggle: () => void;
  labelAll: string;
  labelLess: string;
}) {
  if (hidden <= 0 && !open) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
    >
      {open ? labelLess : `${labelAll} (+${hidden})`}
    </button>
  );
}

// 2列並びのセクション用。sm以上では「見出し＋説明」と「カード」を親グリッドの行に
// subgridで割り当て、説明文の行数が違ってもカードの上端が左右で揃うようにする。
const COL_ALIGN = "sm:row-span-2 sm:grid sm:grid-rows-subgrid sm:items-start";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-center">
      <div className="text-2xl font-black tabular-nums text-slate-900 sm:text-3xl">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

export default function AnalyticsPage() {
  const { lang, t } = useLang();
  const [days, setDays] = useState(7);
  const [platform, setPlatform] = useState<PlatformSel>("all");
  const [game, setGame] = useState<"all" | GameId>("all");
  const [d, setD] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const pq = platform === "all" ? "" : `&platform=${platform}`;
    const gq = game === "all" ? "" : `&game=${game}`;
    fetch(`/api/insights?days=${days}${pq}${gq}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => setD(json))
      .finally(() => setLoading(false));
  }, [days, platform, game]);

  // 折れ線の系列名は凡例にそのまま出るため、言語別のキー名でデータを組む
  const peakKey = tr(lang, "an.chartPeak");
  const avgKey = tr(lang, "an.chartAvg");
  const activityChart = useMemo(
    () =>
      (d?.activity ?? []).map((r) => ({
        t: mdLabel(r.day),
        [peakKey]: r.peak_viewers,
        [avgKey]: r.avg_viewers,
      })),
    [d, peakKey, avgKey],
  );

  const kpi = useMemo(() => {
    const h = d?.headline;
    const top = d?.top_streams?.[0] ?? null;
    return {
      peakViewers: h?.peak_viewers ?? 0,
      peakAt: h?.peak_at ?? null,
      totalHours: h?.total_stream_hours ?? 0,
      activeChannels: h?.active_channels ?? 0,
      recordViewers: top?.peak_viewers ?? 0,
      recordChannel: top?.channel_name ?? null,
    };
  }, [d]);

  const span = d?.headline?.span_days ?? 999; // データ蓄積日数（未取得時は全期間を許可）
  const periodEnabled = (p: number) => p === MIN_PERIOD || span >= p;

  const heat = useMemo(() => {
    const map = new Map<number, number>();
    let max = 0;
    for (const r of d?.heatmap ?? []) {
      map.set(r.dow * 24 + r.hour, r.avg_concurrent);
      max = Math.max(max, r.avg_concurrent);
    }
    return { map, max };
  }, [d]);

  const hasGrowth = (d?.growth ?? []).some((g) => g.delta != null && g.delta !== 0);
  const maxLeader = Math.max(1, ...(d?.leaderboard ?? []).map((c) => c.viewer_hours));
  const maxPageUniq = Math.max(1, ...(d?.page_ranking ?? []).map((c) => c.uniques));
  // 順位変動は「直前の同じ長さの期間」との比較。前の期間がデータ蓄積開始より前に
  // はみ出すときは RPC 側が prev_rank を一律 null で返すので、ここで表示ごと消す。
  // （出すと大半が「NEW」になり、実際より新顔だらけに見えてしまうため）
  const lbDelta = (d?.leaderboard ?? []).some((c) => c.prev_rank != null);
  const prDelta = (d?.page_ranking ?? []).some((c) => c.prev_rank != null);
  const grDelta = (d?.growth ?? []).some((c) => c.prev_rank != null);

  // 折りたたみ（既定は上位だけ表示して縦長を防ぐ）
  const [lbOpen, setLbOpen] = useState(false);
  const [ncOpen, setNcOpen] = useState(false);
  const [grOpen, setGrOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  const COLLAPSED = 8;

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
          href="/history"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.history")}
        </Link>
        <Link
          href="/streamers"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.streamers")}
        </Link>
        <span className="ml-auto">
          <LangToggle />
        </span>
      </div>
      <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
        {lang === "en" ? (
          <>
            Stream <span className="text-brand">Rankings</span> &amp; Records
          </>
        ) : (
          <>
            配信<span className="text-brand">ランキング</span>・記録
          </>
        )}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">{t("an.subtitle")}</p>

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
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">{t("hist.platform")}</span>
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatform(p.key)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                platform === p.key
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.label ?? t("common.all")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">{t("hist.range")}</span>
          {PERIODS.map((r) => {
            const enabled = periodEnabled(r.days);
            return (
              <button
                key={r.days}
                onClick={() => enabled && setDays(r.days)}
                disabled={!enabled}
                title={
                  enabled
                    ? undefined
                    : lang === "en"
                      ? `Unlocks once ${r.days} days of data are collected`
                      : `データが${r.days}日分たまると選べます`
                }
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  days === r.days
                    ? "border-brand bg-brand/10 text-brand"
                    : enabled
                      ? "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                }`}
              >
                {lang === "en" ? r.en : r.ja}
              </button>
            );
          })}
        </div>
        {d?.headline?.span_days != null && (
          <span className="text-[11px] text-slate-400">
            {lang === "en" ? `${span} ${t("an.daysOfData")}` : `${t("an.daysOfData")} ${span}日`}
          </span>
        )}
      </div>

      {/* 低データ時の前向きな案内（30日ビューが未解放のあいだ） */}
      {d?.headline?.span_days != null && span < 30 && (
        <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          {lang === "en" ? (
            <>
              📈 Day <span className="font-bold text-brand">{span}</span> of data collection —{" "}
              <span className="font-bold text-brand">{Math.max(1, 30 - span)}</span> more{" "}
              {Math.max(1, 30 - span) === 1 ? "day" : "days"} until the 30-day view. Showing the last{" "}
              {days} days for now (trends stabilize as data accumulates).
            </>
          ) : (
            <>
              📈 データ蓄積 <span className="font-bold text-brand">{span}日目</span>。30日ビューまであと{" "}
              <span className="font-bold text-brand">{Math.max(1, 30 - span)}日</span>
              。いまは直近{days}日ぶんで集計しています（日々たまるほど傾向が安定します）。
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400">{t("common.loading")}</div>
      ) : (
        <>
          {/* KPI（視聴者・人ベース） */}
          <div className="mt-5 grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-4 sm:p-4">
            <Stat
              label={t("an.kpiPeak")}
              value={fmt(kpi.peakViewers)}
              sub={
                kpi.peakAt
                  ? lang === "en"
                    ? `around ${dt(kpi.peakAt, lang)}`
                    : `${dt(kpi.peakAt, lang)} ごろ`
                  : t("an.kpiPeakSub")
              }
            />
            <Stat label={t("an.kpiHours")} value={`${fmt(kpi.totalHours)}h`} sub={t("an.kpiHoursSub")} />
            <Stat label={t("an.kpiChannels")} value={fmt(kpi.activeChannels)} sub={t("an.kpiChannelsSub")} />
            <Stat
              label={t("an.kpiRecord")}
              value={fmt(kpi.recordViewers)}
              sub={kpi.recordChannel ?? "—"}
            />
          </div>

          {/* 配信ハイライト（記録） */}
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-black text-slate-700">{t("an.highlights")}</h2>
            <p className="mb-2 text-[11px] text-slate-400">
              {t("an.highlightsDesc")} {t("an.highlightsLinkNote")}
            </p>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              {(d?.top_streams ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">{t("an.highlightsEmpty")}</p>
              ) : (
                <ol className="space-y-1.5">
                  {(d?.top_streams ?? []).map((s, i) => {
                    const row = (
                      <>
                        <span
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums ${
                            i === 0
                              ? "bg-amber-100 text-amber-600"
                              : i === 1
                                ? "bg-slate-200 text-slate-600"
                                : i === 2
                                  ? "bg-orange-100 text-orange-500"
                                  : "text-slate-400"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <ChannelIcon
                          src={s.thumbnail_url}
                          name={s.channel_name}
                          platform={s.platform}
                          size={32}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold text-slate-700">{s.channel_name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {s.title ?? t("an.untitled")}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-black tabular-nums text-slate-900">
                            {fmt(s.peak_viewers)}
                            {lang === "ja" && (
                              <span className="ml-0.5 text-[10px] font-normal text-slate-400">人</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{dt(s.started_at, lang)}</div>
                        </div>
                      </>
                    );
                    const href = highlightUrl(s);
                    return (
                      <li key={s.stream_id}>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              trackOutbound({
                                platform: s.platform,
                                channelId: s.channel_id,
                                channelName: s.channel_name,
                                url: href,
                                kind: "vod",
                              })
                            }
                            className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm transition-colors hover:bg-slate-50"
                          >
                            {row}
                          </a>
                        ) : (
                          <div className="flex items-center gap-2.5 px-1.5 py-1.5 text-sm">{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>

          {/* 盛り上がり推移 */}
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-black text-slate-700">{t("an.activity")}</h2>
            <p className="mb-2 text-[11px] text-slate-400">{t("an.activityDesc")}</p>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              {activityChart.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center text-slate-400">
                  {t("hist.noData")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={activityChart} margin={{ top: 8, right: 12, bottom: 8, left: -12 }}>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                    <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={32} stroke="#e2e8f0" />
                    <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} stroke="#e2e8f0" />
                    <Tooltip
                      contentStyle={{
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#475569" }} />
                    <Line type="monotone" dataKey={peakKey} stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey={avgKey} stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* ヒートマップ */}
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-black text-slate-700">{t("an.heatmap")}</h2>
            <p className="mb-2 text-[11px] text-slate-400">{t("an.heatmapDesc")}</p>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="min-w-[560px]">
                <div className="mb-1 flex pl-6">
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="flex-1 text-center text-[9px] text-slate-400">
                      {h % 3 === 0 ? h : ""}
                    </div>
                  ))}
                </div>
                {DOW_ORDER.map((dow) => (
                  <div key={dow} className="flex items-center">
                    <div className="w-6 shrink-0 text-right pr-1 text-[10px] text-slate-500">
                      {DOW_LABEL[lang][dow]}
                    </div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = heat.map.get(dow * 24 + h) ?? 0;
                      const intensity = heat.max > 0 ? v / heat.max : 0;
                      return (
                        <div key={h} className="flex-1 px-[1px]">
                          <div
                            className="h-4 rounded-[3px]"
                            title={
                              lang === "en"
                                ? `${DOW_LABEL.en[dow]} ${h}:00 — avg ${v} streams`
                                : `${DOW_LABEL.ja[dow]} ${h}時: 平均${v}配信`
                            }
                            style={{
                              background:
                                intensity === 0 ? "var(--heat-empty, #f1f5f9)" : `rgba(22,163,74,${0.12 + intensity * 0.88})`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                  {t("an.less")}
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,0.2)" }} />
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,0.55)" }} />
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,1)" }} />
                  {t("an.more")}
                </div>
              </div>
            </div>
          </section>

          {/* 上段：配信者ランキング／よく見られている配信者ページ（スマホでは1列に積む） */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2 sm:grid-rows-[auto_1fr] sm:gap-y-0">
            {/* 配信者ランキング（盛り上がり順＝延べ視聴時間） */}
            <section className={COL_ALIGN}>
              <div>
                <h2 className="mb-2 text-sm font-black text-slate-700">{t("an.leaderboard")}</h2>
                <p className="mb-2 text-[11px] text-slate-400">
                  {t("an.leaderboardDesc")}
                  {lbDelta ? ` ${t("an.rankDeltaNote")}` : ""}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {(d?.leaderboard ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">{t("an.noDataYet")}</p>
                ) : (
                  <>
                    <ol className="space-y-2.5">
                      {(d?.leaderboard ?? []).slice(0, lbOpen ? undefined : COLLAPSED).map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="w-6 shrink-0 text-center">
                            <span className="block text-xs font-bold leading-tight text-slate-400">
                              {c.rank ?? i + 1}
                            </span>
                            {lbDelta && <RankDelta rank={c.rank ?? i + 1} prevRank={c.prev_rank} />}
                          </span>
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pfDot(c.platform)}`} />
                          <div className="min-w-0 flex-1">
                            <Link
                              href={streamerPath(c.platform, c.channel_id)}
                              className="block truncate text-slate-700 hover:text-brand hover:underline"
                            >
                              {c.channel_name}
                            </Link>
                            <div
                              className="mt-0.5 h-1 rounded-full bg-brand"
                              style={{ width: `${Math.round((c.viewer_hours / maxLeader) * 100)}%` }}
                            />
                            <div className="mt-0.5 text-[10px] text-slate-400">
                              {lang === "en"
                                ? `${fmt(c.stream_hours)}h streamed · peak ${fmt(c.peak_viewers)}`
                                : `配信${fmt(c.stream_hours)}h・ピーク${fmt(c.peak_viewers)}人`}
                            </div>
                          </div>
                          <span className="shrink-0 text-right font-bold tabular-nums text-slate-900">
                            {fmt(c.viewer_hours)}
                            <span className="ml-0.5 text-[10px] font-normal text-slate-400">
                              {t("an.viewerHours")}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                    <ShowMore
                      open={lbOpen}
                      hidden={Math.max(0, (d?.leaderboard ?? []).length - COLLAPSED)}
                      onToggle={() => setLbOpen((v) => !v)}
                      labelAll={t("an.showAll")}
                      labelLess={t("an.showLess")}
                    />
                  </>
                )}
              </div>
            </section>

            {/* よく見られている配信者ページ（サイト内の閲覧ランキング） */}
            <section className={COL_ALIGN}>
              <div>
                <h2 className="mb-2 text-sm font-black text-slate-700">{t("an.pageRank")}</h2>
                <p className="mb-2 text-[11px] text-slate-400">
                  {t("an.pageRankDesc")}
                  {prDelta ? ` ${t("an.rankDeltaNote")}` : ""}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {(d?.page_ranking ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">{t("an.pageRankEmpty")}</p>
                ) : (
                  <>
                    <ol className="space-y-2.5">
                      {(d?.page_ranking ?? [])
                        .slice(0, prOpen ? undefined : COLLAPSED)
                        .map((c, i) => (
                          <li
                            key={`${c.platform}-${c.channel_id}`}
                            className="flex items-center gap-2 text-sm"
                          >
                            <span className="w-6 shrink-0 text-center">
                              <span className="block text-xs font-bold leading-tight text-slate-400">
                                {c.rank ?? i + 1}
                              </span>
                              {prDelta && <RankDelta rank={c.rank ?? i + 1} prevRank={c.prev_rank} />}
                            </span>
                            <ChannelIcon
                              src={c.thumbnail_url}
                              name={c.channel_name}
                              platform={c.platform}
                              size={28}
                            />
                            <div className="min-w-0 flex-1">
                              <Link
                                href={streamerPath(c.platform, c.channel_id)}
                                className="block truncate text-slate-700 hover:text-brand hover:underline"
                              >
                                {c.channel_name}
                              </Link>
                              <div
                                className="mt-0.5 h-1 rounded-full bg-brand"
                                style={{ width: `${Math.round((c.uniques / maxPageUniq) * 100)}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-right font-bold tabular-nums text-slate-900">
                              {fmt(c.uniques)}
                              <span className="ml-0.5 text-[10px] font-normal text-slate-400">
                                {t("an.pageRankUnit")}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ol>
                    <ShowMore
                      open={prOpen}
                      hidden={Math.max(0, (d?.page_ranking ?? []).length - COLLAPSED)}
                      onToggle={() => setPrOpen((v) => !v)}
                      labelAll={t("an.showAll")}
                      labelLess={t("an.showLess")}
                    />
                  </>
                )}
              </div>
            </section>

          </div>

          {/* 下段：登録者の伸び／新規参入ch（説明文の行数差はsubgridで吸収して表の位置を揃える） */}
          <div className="mt-6 grid gap-6 sm:grid-cols-2 sm:grid-rows-[auto_1fr] sm:gap-y-0">
            {/* 登録者の伸び（エンリッチ有効時のみ） */}
            {hasGrowth && (
            <section className={COL_ALIGN}>
              <div>
                <h2 className="mb-2 text-sm font-black text-slate-700">{t("an.growth")}</h2>
                <p className="mb-2 text-[11px] text-slate-400">
                  {t("an.growthDesc")}
                  {grDelta ? ` ${t("an.rankDeltaNote")}` : ""}
                </p>
              </div>
              <div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                      <th className="px-3 py-2 font-medium">{t("an.thChannel")}</th>
                      <th className="px-3 py-2 font-medium tabular-nums">{t("an.thSubs")}</th>
                      <th className="px-3 py-2 font-medium tabular-nums">{t("an.thDelta")}</th>
                      <th className="px-3 py-2 font-medium tabular-nums">{t("an.thGrowth")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d?.growth ?? [])
                      .filter((g) => g.delta != null)
                      .slice(0, grOpen ? undefined : COLLAPSED)
                      .map((g) => (
                        <tr key={g.channel_id} className="border-b border-slate-50 last:border-0">
                          <td className="px-3 py-2 text-slate-700">
                            <span className="flex items-center gap-1.5">
                              {grDelta && (
                                <span className="w-6 shrink-0 text-center">
                                  <RankDelta rank={g.rank} prevRank={g.prev_rank} />
                                </span>
                              )}
                              <Link
                                href={streamerPath("youtube", g.channel_id)}
                                className="min-w-0 hover:text-brand hover:underline"
                              >
                                {g.channel_name}
                              </Link>
                            </span>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-700">{fmt(g.latest_subs)}</td>
                          <td className={`px-3 py-2 font-bold tabular-nums ${(g.delta ?? 0) > 0 ? "text-brand" : "text-slate-400"}`}>
                            {(g.delta ?? 0) > 0 ? "+" : ""}
                            {fmt(g.delta)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-500">
                            {g.growth_pct != null ? `${g.growth_pct > 0 ? "+" : ""}${g.growth_pct}%` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <ShowMore
                open={grOpen}
                hidden={Math.max(
                  0,
                  (d?.growth ?? []).filter((g) => g.delta != null).length - COLLAPSED,
                )}
                onToggle={() => setGrOpen((v) => !v)}
                labelAll={t("an.showAll")}
                labelLess={t("an.showLess")}
              />
              </div>
            </section>
            )}

            {/* 新規参入 */}
            <section className={COL_ALIGN}>
              <div>
                <h2 className="mb-2 text-sm font-black text-slate-700">{t("an.newcomers")}</h2>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {(d?.new_channels ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">{t("an.newcomersEmpty")}</p>
                ) : (
                  <>
                    {/* スマホ（フル幅）では2列・sm以上は半分の幅に収まるので1列に戻す */}
                    <ul className="grid grid-cols-1 gap-x-3 gap-y-2 min-[420px]:grid-cols-2 sm:grid-cols-1">
                      {(d?.new_channels ?? []).slice(0, ncOpen ? undefined : COLLAPSED).map((c) => (
                        <li key={c.channel_id} className="flex items-center gap-2 text-sm">
                          <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${pfDot(c.platform)}`}>
                            {c.channel_name.charAt(0)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <Link
                              href={streamerPath(c.platform, c.channel_id)}
                              className="block truncate text-xs text-slate-700 hover:text-brand hover:underline"
                            >
                              {c.channel_name}
                            </Link>
                            <div className="text-[10px] text-slate-400">
                              {t("an.firstSeen")} {dt(c.first_seen, lang)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <ShowMore
                      open={ncOpen}
                      hidden={Math.max(0, (d?.new_channels ?? []).length - COLLAPSED)}
                      onToggle={() => setNcOpen((v) => !v)}
                      labelAll={t("an.showAll")}
                      labelLess={t("an.showLess")}
                    />
                  </>
                )}
              </div>
            </section>
          </div>

          <p className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-400">
            {t("common.disclaimerShort")}
            {lang === "ja" ? "" : " "}
            {t("an.footer")}
          </p>
          <Link
            href="/about"
            className="mt-2 inline-block text-xs font-bold text-slate-500 underline underline-offset-2 transition-colors hover:text-brand"
          >
            {t("nav.about")}
          </Link>
        </>
      )}
    </main>
  );
}
