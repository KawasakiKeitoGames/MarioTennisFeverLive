"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import StreamList from "./components/StreamList";
import type { StreamSnapshot } from "@/lib/types";
import { GAMES, type GameId } from "@/lib/games";

type SortKey = "viewers" | "name" | "elapsed";
const SORT_LABELS: Record<SortKey, string> = {
  viewers: "視聴者数",
  name: "名前順",
  elapsed: "経過時間",
};
const REFRESH_MS = 60_000; // 1分ごとに自動更新（Supabaseを読むだけ。外部APIは叩かない）

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  return `${h}時間${min % 60}分前`;
}

// ピーク時刻などを JST の HH:mm で表示（閲覧者のタイムゾーンに依存しない）。
function jstTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function Home() {
  const [youtube, setYoutube] = useState<StreamSnapshot[]>([]);
  const [twitch, setTwitch] = useState<StreamSnapshot[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [capturedYouTube, setCapturedYouTube] = useState<string | null>(null);
  const [capturedTwitch, setCapturedTwitch] = useState<string | null>(null);
  const [previousTotal, setPreviousTotal] = useState<number | null>(null);
  const [peakViewers, setPeakViewers] = useState<number | null>(null);
  const [peakAt, setPeakAt] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("viewers");
  const [game, setGame] = useState<"all" | GameId>("all"); // タイトル切り替え（既定=全タイトル）
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const gq = game === "all" ? "" : `?game=${game}`;
      const res = await fetch(`/api/streams${gq}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`取得に失敗しました (${res.status})`);
      const data = await res.json();
      setYoutube(data.youtube ?? []);
      setTwitch(data.twitch ?? []);
      setCapturedAt(data.captured_at ?? null);
      setCapturedYouTube(data.captured_at_youtube ?? null);
      setCapturedTwitch(data.captured_at_twitch ?? null);
      setPreviousTotal(data.previous_total ?? null);
      setPeakViewers(data.peak_viewers ?? null);
      setPeakAt(data.peak_at ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [game]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  // ログイン済み（管理者）のときだけ、管理ページへのボタンを表示する。
  // 認証Cookieは httpOnly でJSから読めないため、保護APIの応答で判定する。
  useEffect(() => {
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => setIsAdmin(r.ok))
      .catch(() => setIsAdmin(false));
  }, []);

  const ytViewers = youtube.reduce((s, x) => s + (x.viewers ?? 0), 0);
  const twViewers = twitch.reduce((s, x) => s + (x.viewers ?? 0), 0);
  const grandTotal = ytViewers + twViewers;
  const streamCount = youtube.length + twitch.length;
  const ytPct = grandTotal > 0 ? (ytViewers / grandTotal) * 100 : 0;
  const twPct = grandTotal > 0 ? (twViewers / grandTotal) * 100 : 0;
  // 前回取得からの増減（前回値が取れているときだけ表示）
  const delta = previousTotal != null ? grandTotal - previousTotal : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      {/* ヘッダー */}
      <header className="mb-5">
        <div className="mb-3 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon-192.png"
            alt="FEVER LIVE ロゴ"
            width={48}
            height={48}
            className="h-12 w-12 rounded-xl shadow-sm"
          />
          <span className="text-xl font-black tracking-tight text-brand sm:text-2xl">
            FEVER LIVE
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* 更新状態のピル。配信中は赤いLIVE、0件なら控えめに更新時刻だけ表示 */}
            {streamCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
                </span>
                LIVE
                <span className="font-normal text-red-400">・{relativeTime(capturedAt)}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                更新 {relativeTime(capturedAt)}
              </span>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
              >
                ⚙️ 管理ページ
              </Link>
            )}
          </div>
        </div>
        <h1 className="text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-3xl">
          マリオテニス配信中ボード
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          YouTube と Twitch を横断して、いま配信中のマリオテニス シリーズ（
          {GAMES.map((g) => g.label).join("・")}）を集計。
        </p>
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-400">
          <li>
            <span className="font-bold text-youtube">YouTube</span>：タイトルに各ゲーム名（
            {GAMES.map((g) => `「${g.fullName}」`).join("")}
            ）を含むライブ配信（語間の空白や英語表記も対象）
          </li>
          <li>
            <span className="font-bold text-twitch">Twitch</span>：配信カテゴリ（ゲーム）が
            {GAMES.map((g) => `「${g.twitchCategory}」`).join("")}
            のライブ配信
          </li>
        </ul>
      </header>

      {/* タイトル切り替えタブ */}
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button
          onClick={() => setGame("all")}
          className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
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
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
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

      {/* スコアボード */}
      <div className="mb-5 space-y-2.5">
        {/* ヒーロー：いま配信中の合算視聴者＋前回比＋プラットフォーム内訳 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-baseline">
            <span className="text-xs text-slate-500">いま配信中</span>
            {delta !== null && (
              <span
                title="本日1つ前の収集時点（Twitchは約2分前・YouTubeは時間帯により6〜30分前）の総視聴者数との差"
                className={`ml-auto text-xs font-bold tabular-nums ${
                  delta > 0 ? "text-emerald-600" : delta < 0 ? "text-amber-600" : "text-slate-400"
                }`}
              >
                {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "→ ±0"}
                <span className="ml-1 font-normal text-slate-400">前回比</span>
              </span>
            )}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-3xl font-black tabular-nums leading-none text-slate-900 sm:text-4xl">
              {grandTotal.toLocaleString("ja-JP")}
            </span>
            <span className="text-sm text-slate-500">人が視聴中</span>
          </div>
          {/* プラットフォーム内訳バー */}
          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-youtube" style={{ width: `${ytPct}%` }} />
            <div className="bg-twitch" style={{ width: `${twPct}%` }} />
          </div>
          <div className="mt-1.5 flex gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1 text-youtube">
              <span className="h-1.5 w-1.5 rounded-full bg-youtube" />
              YouTube <span className="font-bold tabular-nums">{ytViewers.toLocaleString("ja-JP")}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-twitch">
              <span className="h-1.5 w-1.5 rounded-full bg-twitch" />
              Twitch <span className="font-bold tabular-nums">{twViewers.toLocaleString("ja-JP")}</span>
            </span>
          </div>
        </div>

        {/* 配信数 ・ 本日ピーク */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-xs text-slate-500">配信数</div>
            <div className="mt-0.5 text-2xl font-black tabular-nums text-slate-900">
              {streamCount}
              <span className="ml-1 text-xs font-normal text-slate-400">本</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              YouTube {youtube.length}・Twitch {twitch.length}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-xs text-slate-500">本日ピーク</div>
            <div className="mt-0.5 text-2xl font-black tabular-nums text-slate-900">
              {peakViewers != null ? peakViewers.toLocaleString("ja-JP") : "—"}
              <span className="ml-1 text-xs font-normal text-slate-400">人</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {peakAt ? `${jstTime(peakAt)} ごろ` : "集計中"}
            </div>
          </div>
        </div>
      </div>

      {/* コントロール */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-y-2 px-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">並び替え</span>
          {(["viewers", "name", "elapsed"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                sortKey === k
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {SORT_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/analytics"
            className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
          >
            📊 ランキング・記録 →
          </Link>
          <Link
            href="/history"
            className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
          >
            📈 推移 →
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400">読み込み中…</div>
      ) : (
        <StreamList
          streams={[...youtube, ...twitch]}
          sortKey={sortKey}
          capturedAt={capturedAt}
          showGameBadge={game === "all"}
        />
      )}

      <footer className="mt-8 space-y-3 border-t border-slate-200 pt-4">
        {/* 取得・更新タイミング（サーバーの収集と、この画面の再読込は別物） */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-500">
          <div className="mb-2 font-bold text-slate-600">取得と更新のタイミング</div>
          <ul className="space-y-1.5">
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-24 shrink-0 font-bold text-youtube">YouTube 取得</span>
              <span className="tabular-nums text-slate-600">最終 {relativeTime(capturedYouTube)}</span>
              <span className="text-slate-400">配信が集中する夜ほど短い間隔（20:00〜翌1:00 頃は約6分・夕方は約15分・日中は約30分）</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-24 shrink-0 font-bold text-twitch">Twitch 取得</span>
              <span className="tabular-nums text-slate-600">最終 {relativeTime(capturedTwitch)}</span>
              <span className="text-slate-400">終日ほぼ一定で約2分ごと</span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-24 shrink-0 font-bold text-slate-600">画面の更新</span>
              <span className="tabular-nums text-slate-600">1分ごと</span>
              <span className="text-slate-400">取得済みデータを自動で再読込（閲覧時に外部APIは呼び出しません）</span>
            </li>
          </ul>
          <p className="mt-2 text-slate-400">視聴者数は取得時点の同時視聴者数です。</p>
        </div>
        <p className="text-xs leading-relaxed text-slate-500">
          本サイトは非公式のファン制作サイトです。任天堂株式会社および「マリオテニス」シリーズ各作品の公式、YouTube・Twitch とは一切関係ありません。
          各名称・商標は各権利者に帰属します。
        </p>
      </footer>
    </main>
  );
}
