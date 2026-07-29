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
} from "recharts";

type Platform = "twitch" | "youtube";

interface Point {
  bucket: string;
  channel_name: string | null;
  viewers: number | null;
  is_portrait?: boolean | null;
}

interface Series {
  key: string; // channel_name（表示名と同じ・同一PF内で一意）
  name: string;
  color: string;
  peak: number;
  portrait: boolean; // 縦画面配信（YouTube Shortsライブ等）
}

// 白背景で視認できる濃いめの配色（チャンネルごとに固有色）
const PALETTE = [
  "#ef4444", "#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899",
  "#6366f1", "#14b8a6", "#f97316", "#84cc16", "#a855f7", "#0891b2",
];

const TWITCH = "#9146ff";
const YOUTUBE = "#e62117";

const RANGES = [
  { label: "6時間", hours: 6 },
  { label: "24時間", hours: 24 },
  { label: "3日", hours: 72 },
  { label: "7日", hours: 168 },
  { label: "30日", hours: 720 },
];

// 期間ごとの集計単位（サーバの bucketMinutesFor と対応）を人間向けに説明する。
function aggLabel(hours: number): string {
  if (hours <= 6) return "10分ごと";
  if (hours <= 24) return "20分ごと";
  if (hours <= 72) return "2時間ごと";
  if (hours <= 168) return "6時間ごと";
  return "1日ごと";
}

// バケット時刻のラベル。期間が長いほど日付主体にする。
function label(iso: string, hours: number): string {
  const d = new Date(iso);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (hours <= 24) return hm;
  if (hours <= 168) return `${md} ${hm}`;
  return md;
}

export default function HistoryPage() {
  const [hours, setHours] = useState(24);
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  // 凡例操作：hover=強調（他を淡く）、hidden=クリックで非表示トグル
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setHidden(new Set()); // プラットフォーム切替時は表示状態をリセット
    fetch(`/api/history?hours=${hours}&platform=${platform}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPoints(d.points ?? []))
      .finally(() => setLoading(false));
  }, [hours, platform]);

  // points（PF絞り込み・時間バケット集計・上位12ch 済み）を
  // {time -> {channel -> viewers}} のワイド形式へ整形し、系列メタも作る。
  const { data, series } = useMemo(() => {
    const peak = new Map<string, number>();
    const portrait = new Map<string, boolean>();
    for (const p of points) {
      const c = p.channel_name ?? "?";
      peak.set(c, Math.max(peak.get(c) ?? 0, p.viewers ?? 0));
      if (p.is_portrait) portrait.set(c, true);
    }
    const series: Series[] = [...peak.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c, pk], i) => ({
        key: c,
        name: c,
        color: PALETTE[i % PALETTE.length],
        peak: pk,
        portrait: portrait.get(c) ?? false,
      }));

    // iso をキーに時刻順で並べ、X軸ラベル(t)は表示用文字列にする（データがある時点のみ）。
    const byTime = new Map<string, Record<string, number | string>>();
    for (const p of points) {
      const c = p.channel_name ?? "?";
      const iso = p.bucket;
      if (!byTime.has(iso)) byTime.set(iso, { t: label(iso, hours) });
      byTime.get(iso)![c] = p.viewers ?? 0;
    }
    const data = [...byTime.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
    return { data, series };
  }, [points, hours]);

  const accent = platform === "twitch" ? TWITCH : YOUTUBE;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <Link href="/" className="text-xs font-bold text-brand hover:underline">
        ← ライブボードに戻る
      </Link>
      <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
        視聴者数の<span className="text-brand">推移</span>
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        同時視聴者数の時系列。線の途切れは、その時間に配信していなかったことを表します。
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">プラットフォーム</span>
          {(["youtube", "twitch"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                platform === p
                  ? p === "twitch"
                    ? "border-twitch bg-twitch/10 text-twitch"
                    : "border-youtube bg-youtube/10 text-youtube"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {p === "twitch" ? "Twitch" : "YouTube"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">期間</span>
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
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        {loading ? (
          <div className="flex h-[420px] items-center justify-center text-slate-400">読み込み中…</div>
        ) : series.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center text-slate-400">
            この期間のデータはまだありません。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                minTickGap={40}
                stroke="#e2e8f0"
              />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} stroke="#e2e8f0" />
              <Tooltip content={<ChartTooltip series={series} hidden={hidden} accent={accent} />} />
              {series.map((s) => {
                const dim = hover !== null && hover !== s.key;
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={hover === s.key ? 3.5 : 2}
                    strokeOpacity={dim ? 0.12 : 1}
                    dot={false}
                    activeDot={{ r: 3.5 }}
                    connectNulls={false}
                    hide={hidden.has(s.key)}
                    isAnimationActive={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* インタラクティブ凡例：ホバーで強調・クリックで表示/非表示 */}
      {series.length > 0 && (
        <ul className="mt-4 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {series.map((s) => {
            const off = hidden.has(s.key);
            const dim = hover !== null && hover !== s.key;
            return (
              <li key={s.key}>
                <button
                  onMouseEnter={() => setHover(s.key)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      next.has(s.key) ? next.delete(s.key) : next.add(s.key);
                      return next;
                    })
                  }
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-slate-50 ${
                    off ? "opacity-40" : dim ? "opacity-50" : ""
                  }`}
                >
                  <svg width="22" height="8" aria-hidden className="shrink-0">
                    <line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2.5" />
                  </svg>
                  <span className={`truncate ${off ? "line-through" : "font-semibold text-slate-600"}`}>
                    {s.name}
                  </span>
                  {s.portrait && (
                    <span
                      title="縦画面の配信"
                      className="shrink-0 rounded border border-fuchsia-200 bg-fuchsia-50 px-1 text-[9px] font-bold text-fuchsia-600"
                    >
                      📱縦
                    </span>
                  )}
                  <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                    {s.peak.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 px-1 text-xs text-slate-400">
        ピーク視聴者数が多い上位12チャンネルを、{aggLabel(hours)}のピークで表示しています。凡例をクリックで表示/非表示、ホバーで強調できます。
      </p>
      <p className="mt-2 px-1 text-xs text-slate-400">
        本サイトは非公式のファン制作サイトです。任天堂株式会社および各権利者とは一切関係ありません。
      </p>
    </main>
  );
}

function ChartTooltip({
  active,
  label,
  payload,
  series,
  hidden,
  accent,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; value?: number }[];
  series: Series[];
  hidden: Set<string>;
  accent: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const metaByKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .map((p) => ({ meta: metaByKey.get(String(p.dataKey)), value: p.value }))
    .filter((r) => r.meta && !hidden.has(r.meta.key) && typeof r.value === "number")
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-bold text-slate-500">{label ?? ""}</div>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.meta!.key} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.meta!.color }} />
            <span className="max-w-[160px] truncate text-slate-700">
              {r.meta!.portrait ? "📱 " : ""}
              {r.meta!.name}
            </span>
            <span className="ml-auto font-bold tabular-nums" style={{ color: accent }}>
              {(r.value as number).toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
