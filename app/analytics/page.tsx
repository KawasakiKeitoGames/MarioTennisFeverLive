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
import { GAMES, type GameId } from "@/lib/games";

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
  channel_name: string;
  platform: string;
  peak_viewers: number;
  avg_viewers: number | null;
  hours: number;
  started_at: string | null;
  title: string | null;
  url: string | null;
}
interface HeatRow {
  dow: number;
  hour: number;
  avg_concurrent: number;
}
interface HourProfileRow {
  channel_id: string;
  channel_name: string;
  platform: string;
  hour: number;
  hours_count: number;
}
interface NewChannel {
  channel_id: string;
  channel_name: string;
  platform: string;
  first_seen: string;
  appearances: number;
}
interface LeaderRow {
  channel_name: string;
  platform: string;
  stream_hours: number;
  viewer_hours: number;
  peak_viewers: number;
  avg_viewers: number | null;
  last_seen: string;
}
interface Growth {
  channel_id: string;
  channel_name: string;
  latest_subs: number | null;
  first_subs: number | null;
  delta: number | null;
  growth_pct: number | null;
  published_at: string | null;
}

interface InsightsData {
  headline: Headline | null;
  activity: ActivityRow[];
  heatmap: HeatRow[];
  hour_profile: HourProfileRow[];
  new_channels: NewChannel[];
  leaderboard: LeaderRow[];
  growth: Growth[];
  top_streams: HighlightStream[];
}

const PERIODS = [
  { label: "7日", days: 7 },
  { label: "30日", days: 30 },
  { label: "90日", days: 90 },
];
const MIN_PERIOD = 7; // 常に選べる最小期間
const PLATFORMS: { key: PlatformSel; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "youtube", label: "YouTube" },
  { key: "twitch", label: "Twitch" },
];

// JST曜日: 0=日。表示は月始まりにする。
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABEL: Record<number, string> = { 0: "日", 1: "月", 2: "火", 3: "水", 4: "木", 5: "金", 6: "土" };

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("ja-JP");
}
function mdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}
function dt(iso: string | null): string {
  if (!iso) return "—";
  const p = new Intl.DateTimeFormat("ja-JP", {
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
// 時間帯マップのセル色（PF色の濃淡で表す）
function pfRgb(platform: string): string {
  return platform === "twitch" ? "145,70,255" : "230,33,23";
}

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

  const activityChart = useMemo(
    () =>
      (d?.activity ?? []).map((r) => ({
        t: mdLabel(r.day),
        ピーク同時視聴: r.peak_viewers,
        平均同時視聴: r.avg_viewers,
      })),
    [d],
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

  // ヒートマップ（曜日×時間の平均同時配信数）から「配信を見つけやすい時間帯」を導く。
  const primeTime = useMemo(() => {
    const rows = d?.heatmap ?? [];
    if (rows.length === 0) return null;
    const byHour = new Array(24).fill(0);
    let weekend = 0;
    let weekday = 0;
    for (const r of rows) {
      byHour[r.hour] += r.avg_concurrent;
      if (r.dow === 0 || r.dow === 6) weekend += r.avg_concurrent;
      else weekday += r.avg_concurrent;
    }
    const hourMax = Math.max(...byHour);
    if (hourMax <= 0) return null;
    // もっとも活発な連続3時間帯を探す
    let bestStart = 0;
    let bestSum = -1;
    for (let h = 0; h < 24; h++) {
      const sum = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24];
      if (sum > bestSum) {
        bestSum = sum;
        bestStart = h;
      }
    }
    const wePerDay = weekend / 2;
    const wdPerDay = weekday / 5;
    const dayType = wePerDay > wdPerDay * 1.25 ? "土日" : wdPerDay > wePerDay * 1.25 ? "平日" : "ほぼ毎日";
    const endHour = (bestStart + 3) % 24;
    const endLabel = bestStart + 3 <= 24 ? bestStart + 3 : bestStart + 3 - 24; // 21〜24時 のように読ませる
    return { start: bestStart, endHour, endLabel, dayType, byHour, hourMax };
  }, [d]);

  // 配信者ごとの時間帯プロファイル（JSTの時×配信時間h）。よく配信する連続3時間帯も導く。
  const channelHours = useMemo(() => {
    const byCh = new Map<
      string,
      { id: string; name: string; platform: string; hours: number[]; total: number }
    >();
    for (const r of d?.hour_profile ?? []) {
      const key = `${r.platform}:${r.channel_id}`;
      const c =
        byCh.get(key) ??
        { id: key, name: r.channel_name, platform: r.platform, hours: new Array(24).fill(0), total: 0 };
      c.hours[r.hour] += r.hours_count;
      c.total += r.hours_count;
      byCh.set(key, c);
    }
    return [...byCh.values()]
      .sort((a, b) => b.total - a.total)
      .map((c) => {
        const max = Math.max(...c.hours, 1);
        // もっとも配信が多い連続3時間帯（日またぎも考慮）
        let bestStart = 0;
        let bestSum = -1;
        for (let h = 0; h < 24; h++) {
          const sum = c.hours[h] + c.hours[(h + 1) % 24] + c.hours[(h + 2) % 24];
          if (sum > bestSum) {
            bestSum = sum;
            bestStart = h;
          }
        }
        const endLabel = bestStart + 3 <= 24 ? bestStart + 3 : bestStart + 3 - 24; // 21〜24時 のように読ませる
        return { ...c, max, bestStart, endLabel };
      });
  }, [d]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          🏠 ライブボードに戻る
        </Link>
        <Link
          href="/history"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          📈 推移 →
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
        配信<span className="text-brand">ランキング</span>・記録
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        誰が・どの配信が・いつ盛り上がっているか。収集済みデータだけから集計しています（閲覧時に外部APIは呼びません）。
      </p>

      {/* コントロール */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">タイトル</span>
          <button
            onClick={() => setGame("all")}
            className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
              game === "all"
                ? "border-brand bg-brand/10 text-brand"
                : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
            }`}
          >
            すべて
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
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">対象</span>
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
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">期間</span>
          {PERIODS.map((r) => {
            const enabled = periodEnabled(r.days);
            return (
              <button
                key={r.days}
                onClick={() => enabled && setDays(r.days)}
                disabled={!enabled}
                title={enabled ? undefined : `データが${r.days}日分たまると選べます`}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  days === r.days
                    ? "border-brand bg-brand/10 text-brand"
                    : enabled
                      ? "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                      : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        {d?.headline?.span_days != null && (
          <span className="text-[11px] text-slate-400">データ蓄積 {span}日</span>
        )}
      </div>

      {/* 低データ時の前向きな案内（30日ビューが未解放のあいだ） */}
      {d?.headline?.span_days != null && span < 30 && (
        <div className="mt-3 rounded-xl border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
          📈 データ蓄積 <span className="font-bold text-brand">{span}日目</span>。30日ビューまであと{" "}
          <span className="font-bold text-brand">{Math.max(1, 30 - span)}日</span>
          。いまは直近{days}日ぶんで集計しています（日々たまるほど傾向が安定します）。
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-slate-400">読み込み中…</div>
      ) : (
        <>
          {/* KPI（視聴者・人ベース） */}
          <div className="mt-5 grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-4 sm:p-4">
            <Stat
              label="ピーク同時視聴"
              value={fmt(kpi.peakViewers)}
              sub={kpi.peakAt ? `${dt(kpi.peakAt)} ごろ` : "期間中の最大"}
            />
            <Stat label="延べ配信時間" value={`${fmt(kpi.totalHours)}h`} sub="配信×時間" />
            <Stat label="配信したch" value={fmt(kpi.activeChannels)} sub="期間内" />
            <Stat
              label="最高視聴の配信"
              value={fmt(kpi.recordViewers)}
              sub={kpi.recordChannel ?? "—"}
            />
          </div>

          {/* 配信ハイライト（記録） */}
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-black text-slate-700">配信ハイライト（最高視聴）</h2>
            <p className="mb-2 text-[11px] text-slate-400">
              期間内でいちばん見られた配信の記録。ランクや大会の熱い瞬間が並びます。
            </p>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              {(d?.top_streams ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">この期間の配信記録はまだありません。</p>
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
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pfDot(s.platform)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold text-slate-700">{s.channel_name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {s.title ?? "（無題）"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-black tabular-nums text-slate-900">
                            {fmt(s.peak_viewers)}
                            <span className="ml-0.5 text-[10px] font-normal text-slate-400">人</span>
                          </div>
                          <div className="text-[10px] text-slate-400">{dt(s.started_at)}</div>
                        </div>
                      </>
                    );
                    return (
                      <li key={s.stream_id}>
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
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
            <h2 className="mb-1 text-sm font-black text-slate-700">コミュニティの盛り上がり（日別）</h2>
            <p className="mb-2 text-[11px] text-slate-400">
              同時視聴者数の推移（日別のピーク／平均）。アップデートや大会の日ほど跳ねます。
            </p>
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              {activityChart.length === 0 ? (
                <div className="flex h-[280px] items-center justify-center text-slate-400">
                  この期間のデータはまだありません。
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
                    <Line type="monotone" dataKey="ピーク同時視聴" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="平均同時視聴" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* ヒートマップ */}
          <section className="mt-6">
            <h2 className="mb-1 text-sm font-black text-slate-700">配信の時間帯ヒートマップ</h2>
            <p className="mb-2 text-[11px] text-slate-400">
              曜日 × 時間（日本時間）ごとの平均同時配信数。濃いほど配信が多い時間帯です。
            </p>
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
                    <div className="w-6 shrink-0 text-right pr-1 text-[10px] text-slate-500">{DOW_LABEL[dow]}</div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const v = heat.map.get(dow * 24 + h) ?? 0;
                      const intensity = heat.max > 0 ? v / heat.max : 0;
                      return (
                        <div key={h} className="flex-1 px-[1px]">
                          <div
                            className="h-4 rounded-[3px]"
                            title={`${DOW_LABEL[dow]} ${h}時: 平均${v}配信`}
                            style={{
                              background:
                                intensity === 0 ? "#f1f5f9" : `rgba(22,163,74,${0.12 + intensity * 0.88})`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
                  少
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,0.2)" }} />
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,0.55)" }} />
                  <span className="h-2.5 w-3.5 rounded-[2px]" style={{ background: "rgba(22,163,74,1)" }} />
                  多
                </div>
              </div>
            </div>
          </section>

          {/* 狙い目の時間帯（ヒートマップの要約インサイト・旧ハッシュタグ枠の差し替え） */}
          {primeTime && (
            <section className="mt-4">
              <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 shadow-sm">
                <div className="flex items-start gap-2.5">
                  <span className="text-lg leading-none">🎯</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-700">
                      配信を見つけやすいのは{" "}
                      <span className="text-brand">
                        {primeTime.dayType}の {primeTime.start}〜{primeTime.endLabel}時ごろ
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      いちばん配信が重なりやすい時間帯です（日本時間）。
                    </p>
                    {/* 24時間ミニバー（緑=狙い目の3時間） */}
                    <div className="mt-2 flex items-end gap-[2px]" style={{ height: 28 }}>
                      {primeTime.byHour.map((v, h) => {
                        const inBand =
                          primeTime.start < primeTime.endHour
                            ? h >= primeTime.start && h < primeTime.endHour
                            : h >= primeTime.start || h < primeTime.endHour;
                        const hgt = primeTime.hourMax > 0 ? Math.max(2, (v / primeTime.hourMax) * 28) : 2;
                        return (
                          <div
                            key={h}
                            title={`${h}時: 平均${Math.round(v * 10) / 10}配信`}
                            className="flex-1 rounded-[1px]"
                            style={{ height: hgt, background: inBand ? "#16a34a" : "#cbd5e1" }}
                          />
                        );
                      })}
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] text-slate-300">
                      <span>0時</span>
                      <span>6</span>
                      <span>12</span>
                      <span>18</span>
                      <span>23時</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 配信者の時間帯マップ（誰がどの時間帯に配信していることが多いか） */}
          {channelHours.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-1 text-sm font-black text-slate-700">配信者の時間帯マップ</h2>
              <p className="mb-2 text-[11px] text-slate-400">
                よく配信している上位chが、どの時間帯（日本時間）に配信していることが多いか。濃いほどその時間の配信時間が長め。右は特に多い連続3時間帯。
              </p>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="min-w-[560px]">
                  {/* 時間軸ヘッダ */}
                  <div className="mb-1 flex items-center">
                    <div className="w-24 shrink-0" />
                    <div className="flex flex-1">
                      {Array.from({ length: 24 }, (_, h) => (
                        <div key={h} className="flex-1 text-center text-[9px] text-slate-400">
                          {h % 3 === 0 ? h : ""}
                        </div>
                      ))}
                    </div>
                    <div className="w-16 shrink-0" />
                  </div>
                  {channelHours.map((c) => (
                    <div key={c.id} className="flex items-center py-[2px]">
                      <div className="flex w-24 shrink-0 items-center gap-1 pr-1">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pfDot(c.platform)}`} />
                        <span className="truncate text-[11px] text-slate-600" title={c.name}>
                          {c.name}
                        </span>
                      </div>
                      <div className="flex flex-1">
                        {c.hours.map((v, h) => (
                          <div key={h} className="flex-1 px-[1px]">
                            <div
                              className="h-4 rounded-[3px]"
                              title={`${c.name} ${h}時台: 配信${v}h`}
                              style={{
                                background:
                                  v === 0
                                    ? "#f1f5f9"
                                    : `rgba(${pfRgb(c.platform)},${0.15 + (v / c.max) * 0.85})`,
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div
                        className="w-16 shrink-0 pl-1.5 text-right text-[10px] tabular-nums text-slate-400"
                        title="期間内でもっとも配信が多い連続3時間帯"
                      >
                        {c.bestStart}〜{c.endLabel}時
                      </div>
                    </div>
                  ))}
                  <div className="mt-2 flex items-center justify-end gap-3 text-[10px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-youtube" /> YouTube
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-twitch" /> Twitch
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {/* 配信者ランキング（盛り上がり順＝延べ視聴時間） */}
            <section>
              <h2 className="mb-2 text-sm font-black text-slate-700">配信者ランキング（盛り上がり順）</h2>
              <p className="mb-2 text-[11px] text-slate-400">
                延べ視聴時間（同時視聴×時間の合計）で順位付け。YouTube / Twitch の収集頻度差はならして公平に比較しています。
              </p>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {(d?.leaderboard ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">まだデータがありません。</p>
                ) : (
                  <ol className="space-y-2.5">
                    {(d?.leaderboard ?? []).map((c, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${pfDot(c.platform)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-slate-700">{c.channel_name}</div>
                          <div
                            className="mt-0.5 h-1 rounded-full bg-brand"
                            style={{ width: `${Math.round((c.viewer_hours / maxLeader) * 100)}%` }}
                          />
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            配信{fmt(c.stream_hours)}h・ピーク{fmt(c.peak_viewers)}人
                          </div>
                        </div>
                        <span className="shrink-0 text-right font-bold tabular-nums text-slate-900">
                          {fmt(c.viewer_hours)}
                          <span className="ml-0.5 text-[10px] font-normal text-slate-400">視聴h</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            {/* 新規参入 */}
            <section>
              <h2 className="mb-2 text-sm font-black text-slate-700">新規参入ch（初観測が最近）</h2>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                {(d?.new_channels ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">直近の新規参入はありません。</p>
                ) : (
                  <ul className="space-y-2.5">
                    {(d?.new_channels ?? []).slice(0, 12).map((c) => (
                      <li key={c.channel_id} className="flex items-center gap-2.5 text-sm">
                        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${pfDot(c.platform)}`}>
                          {c.channel_name.charAt(0)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-slate-700">{c.channel_name}</div>
                          <div className="text-[11px] text-slate-400">初観測 {dt(c.first_seen)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          {/* 登録者の伸び（エンリッチ有効時のみ） */}
          {hasGrowth && (
            <section className="mt-6">
              <h2 className="mb-1 text-sm font-black text-slate-700">登録者の伸び（YouTube・期間内）</h2>
              <p className="mb-2 text-[11px] text-slate-400">
                期間の最古→最新の登録者数の差。登録者数は3桁単位に丸められています。
              </p>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                      <th className="px-4 py-2 font-medium">チャンネル</th>
                      <th className="px-4 py-2 font-medium tabular-nums">登録者</th>
                      <th className="px-4 py-2 font-medium tabular-nums">増加</th>
                      <th className="px-4 py-2 font-medium tabular-nums">伸び率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d?.growth ?? [])
                      .filter((g) => g.delta != null)
                      .map((g) => (
                        <tr key={g.channel_id} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-2 text-slate-700">{g.channel_name}</td>
                          <td className="px-4 py-2 tabular-nums text-slate-700">{fmt(g.latest_subs)}</td>
                          <td className={`px-4 py-2 font-bold tabular-nums ${(g.delta ?? 0) > 0 ? "text-brand" : "text-slate-400"}`}>
                            {(g.delta ?? 0) > 0 ? "+" : ""}
                            {fmt(g.delta)}
                          </td>
                          <td className="px-4 py-2 tabular-nums text-slate-500">
                            {g.growth_pct != null ? `${g.growth_pct > 0 ? "+" : ""}${g.growth_pct}%` : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="mt-8 border-t border-slate-200 pt-4 text-xs leading-relaxed text-slate-400">
            本サイトは非公式のファン制作サイトです。任天堂株式会社および各権利者とは一切関係ありません。
            集計は保存済みデータのみを用い、閲覧時に外部APIは呼び出しません。
          </p>
        </>
      )}
    </main>
  );
}
