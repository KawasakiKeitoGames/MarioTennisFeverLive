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

const PALETTE = [
  "#c65f3f", "#3f7d5a", "#d8ef4a", "#4a9eff", "#e056a0", "#f2a63d",
  "#7ed957", "#c084fc", "#5ad1ff", "#ff6b9d", "#a3e635", "#fb923c",
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

  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <Link href="/" className="text-xs font-bold text-clay hover:underline">
        ← ライブボードに戻る
      </Link>
      <h1 className="mt-4 text-2xl sm:text-3xl font-black tracking-tight">
        視聴者数の<span className="text-court">推移</span>
      </h1>
      <p className="mt-2 text-sub text-sm">
        同時視聴者数の時系列。線の途切れは、その時間に配信していなかったことを表します。
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1">
          <span className="text-xs text-sub mr-2">プラットフォーム</span>
          {(["twitch", "youtube"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`px-3 py-1 rounded border text-xs font-bold transition-colors ${
                platform === p
                  ? "border-court bg-court/15 text-court"
                  : "border-line text-sub hover:text-chalk"
              }`}
            >
              {p === "twitch" ? "Twitch" : "YouTube"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-sub mr-2">期間</span>
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`px-3 py-1 rounded border text-xs font-bold transition-colors ${
                hours === r.hours
                  ? "border-clay bg-clay/15 text-clay"
                  : "border-line text-sub hover:text-chalk"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-line bg-panel p-4">
        {loading ? (
          <div className="h-[420px] flex items-center justify-center text-sub">
            読み込み中…
          </div>
        ) : data.length === 0 ? (
          <div className="h-[420px] flex items-center justify-center text-sub">
            この期間のデータはまだありません。
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: -8 }}>
              <CartesianGrid stroke="#33403a" strokeDasharray="3 3" />
              <XAxis dataKey="t" tick={{ fill: "#8fa197", fontSize: 11 }} minTickGap={40} />
              <YAxis tick={{ fill: "#8fa197", fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "#1e2620",
                  border: "1px solid #33403a",
                  borderRadius: 8,
                  color: "#f4f1e8",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e6" }} />
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
      <p className="mt-4 text-xs text-sub">
        ピーク視聴者数が多い上位12チャンネルを表示しています。
      </p>
    </main>
  );
}
