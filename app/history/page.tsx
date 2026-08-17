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
import { GAMES, type GameId } from "@/lib/games";

type Platform = "all" | "youtube" | "twitch";
interface TotalPoint {
  t: number; // epoch ms
  total: number;
}

const RANGES = [
  { label: "6時間", hours: 6 },
  { label: "24時間", hours: 24 },
  { label: "3日", hours: 72 },
  { label: "7日", hours: 168 },
  { label: "30日", hours: 720 },
];
const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "all", label: "合算" },
  { key: "youtube", label: "YouTube" },
  { key: "twitch", label: "Twitch" },
];
const BRAND = "#1f9d4d";
const YOUTUBE = "#e62117";
const TWITCH = "#9146ff";

// X軸ラベル（JST）。期間が長いほど日付主体に。
function jstAxis(t: number, hours: number): string {
  const d = new Date(t);
  const o: Intl.DateTimeFormatOptions = { timeZone: "Asia/Tokyo", hour12: false };
  if (hours <= 24) return d.toLocaleTimeString("ja-JP", { ...o, hour: "2-digit", minute: "2-digit" });
  if (hours <= 72) return d.toLocaleString("ja-JP", { ...o, month: "numeric", day: "numeric", hour: "2-digit" });
  return d.toLocaleDateString("ja-JP", { ...o, month: "numeric", day: "numeric" });
}

// ツールチップ用のフル日時（JST）。
function jstFull(t: number): string {
  return new Date(t).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function HistoryPage() {
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
          🏠 ライブボードに戻る
        </Link>
        <Link
          href="/analytics"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          📊 ランキング・記録 →
        </Link>
      </div>
      <h1 className="mt-3 text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
        視聴者数の<span className="text-brand">推移</span>
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        上：総同時視聴者数のうごき／下：どのチャンネルがいつ配信していたか。
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
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">対象</span>
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
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
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

      {/* 総同時視聴者数の推移 */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h2 className="text-sm font-bold text-slate-700">総同時視聴者数</h2>
          <span className="text-xs text-slate-400">
            ピーク{" "}
            <span className="font-bold tabular-nums" style={{ color: accent }}>
              {peak.toLocaleString()}
            </span>{" "}
            人
          </span>
        </div>
        {loading ? (
          <div className="flex h-[240px] items-center justify-center text-slate-400">読み込み中…</div>
        ) : points.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-slate-400">
            この期間のデータはまだありません。
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
                tickFormatter={(v) => jstAxis(v as number, hours)}
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
        <h2 className="mb-3 px-1 text-sm font-bold text-slate-700">配信タイムライン</h2>
        {loading ? (
          <div className="flex h-40 items-center justify-center text-slate-400">読み込み中…</div>
        ) : (
          <Timeline sessions={tlSessions} winStart={winStart} winEnd={winEnd} hours={hours} />
        )}
      </section>

      <p className="mt-4 px-1 text-xs text-slate-400">
        総同時視聴者数は各時点の YouTube＋Twitch の同時視聴合算です（配信のない時間帯は0）。
        タイムラインの帯は配信していた時間、濃さはピーク視聴者数を表します。
      </p>
      <p className="mt-2 px-1 text-xs text-slate-400">
        本サイトは非公式のファン制作サイトです。任天堂株式会社および各権利者とは一切関係ありません。
      </p>
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
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0]?.value ?? 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-0.5 font-bold text-slate-500">
        {typeof label === "number" ? jstFull(label) : ""}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-slate-600">同時視聴</span>
        <span className="ml-auto font-bold tabular-nums" style={{ color: accent }}>
          {(v as number).toLocaleString()}
        </span>
        <span className="text-slate-400">人</span>
      </div>
    </div>
  );
}
