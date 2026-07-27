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

interface Point {
  bucket: string;
  channel_name: string | null;
  viewers: number | null;
}

// 白背景で視認できる濃いめの配色
const PALETTE = [
  "#ef4444", "#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899",
  "#6366f1", "#14b8a6", "#f97316", "#84cc16", "#a855f7", "#0891b2",
];

const RANGES = [
  { label: "6時間", hours: 6 },
  { label: "24時間", hours: 24 },
  { label: "3日", hours: 72 },
  { label: "7日", hours: 168 },
  { label: "30日", hours: 720 },
];

function label(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function HistoryPage() {
  const [hours, setHours] = useState(24);
  const [platform, setPlatform] = useState<"youtube" | "twitch">("twitch");
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/history?hours=${hours}&platform=${platform}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPoints(d.points ?? []))
      .finally(() => setLoading(false));
  }, [hours, platform]);

  // points は DB側で platform 絞り込み・時間バケット集計・上位12チャンネルまで済み。
  // ここでは {time -> {channel -> viewers}} のワイド形式に整形するだけ。
  const { data, channels } = useMemo(() => {
    const peak = new Map<string, number>();
    for (const p of points) {
      const c = p.channel_name ?? "?";
      peak.set(c, Math.max(peak.get(c) ?? 0, p.viewers ?? 0));
    }
    const channels = [...peak.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);

    const byTime = new Map<string, Record<string, number | string>>();
    for (const p of points) {
      const c = p.channel_name ?? "?";
      const t = p.bucket;
      if (!byTime.has(t)) byTime.set(t, { t: label(t) });
      byTime.get(t)![c] = p.viewers ?? 0;
    }
    const rows = [...byTime.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
    return { data: rows, channels };
  }, [points]);

  const selText = platform === "twitch" ? "text-twitch" : "text-youtube";
  const selBorder = platform === "twitch" ? "border-twitch bg-twitch/10" : "border-youtube bg-youtube/10";

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
          {(["twitch", "youtube"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                platform === p
                  ? `${selBorder} ${selText}`
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
          <div className="flex h-[420px] items-center justify-center text-slate-400">
            読み込み中…
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[420px] items-center justify-center text-slate-400">
            この期間のデータはまだありません。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={40} stroke="#e2e8f0" />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} allowDecimals={false} stroke="#e2e8f0" />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  color: "#0f172a",
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#475569" }} />
              {channels.map((c, i) => (
                <Line
                  key={c}
                  type="monotone"
                  dataKey={c}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="mt-3 px-1 text-xs text-slate-400">
        ピーク視聴者数が多い上位12チャンネルを表示しています。
      </p>
      <p className="mt-2 px-1 text-xs text-slate-400">
        本サイトは非公式のファン制作サイトです。任天堂株式会社および各権利者とは一切関係ありません。
      </p>
    </main>
  );
}
