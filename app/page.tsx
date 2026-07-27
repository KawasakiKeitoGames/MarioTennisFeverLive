"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import StreamList from "./components/StreamList";
import type { StreamSnapshot } from "@/lib/types";

type SortKey = "viewers" | "name";
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

export default function Home() {
  const [youtube, setYoutube] = useState<StreamSnapshot[]>([]);
  const [twitch, setTwitch] = useState<StreamSnapshot[]>([]);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("viewers");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { cache: "no-store" });
      if (!res.ok) throw new Error(`取得に失敗しました (${res.status})`);
      const data = await res.json();
      setYoutube(data.youtube ?? []);
      setTwitch(data.twitch ?? []);
      setCapturedAt(data.captured_at ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const grandTotal =
    youtube.reduce((s, x) => s + (x.viewers ?? 0), 0) +
    twitch.reduce((s, x) => s + (x.viewers ?? 0), 0);
  const streamCount = youtube.length + twitch.length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      {/* ヘッダー */}
      <header className="mb-5">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.18em] text-brand">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-brand" />
          Now Streaming
        </div>
        <h1 className="text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-3xl">
          マリオテニスフィーバー
          <br />
          配信中 <span className="text-brand">LIVE</span> ボード
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          YouTube と Twitch を横断して、いま配信中のマリオテニスフィーバーを集計。
        </p>
      </header>

      {/* スコアボード */}
      <div className="mb-5 grid grid-cols-3 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <div className="text-2xl font-black tabular-nums text-slate-900 sm:text-3xl">
            {grandTotal.toLocaleString("ja-JP")}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">総視聴者数</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-center">
          <div className="text-2xl font-black tabular-nums text-slate-900 sm:text-3xl">
            {streamCount}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">配信数</div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl bg-slate-50 p-3 text-center">
          <div className="text-sm font-bold text-slate-700">{relativeTime(capturedAt)}</div>
          <div className="mt-1 text-[11px] text-slate-500">更新</div>
        </div>
      </div>

      {/* コントロール */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-slate-400">並び替え</span>
          {(["viewers", "name"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                sortKey === k
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {k === "viewers" ? "視聴者数" : "名前順"}
            </button>
          ))}
        </div>
        <Link href="/history" className="text-xs font-bold text-brand hover:underline">
          推移を見る →
        </Link>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400">読み込み中…</div>
      ) : (
        <>
          <StreamList platform="youtube" streams={youtube} sortKey={sortKey} />
          <StreamList platform="twitch" streams={twitch} sortKey={sortKey} />
        </>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4">
        <p className="text-xs leading-relaxed text-slate-400">
          データは定期取得のキャッシュを表示しています（1分ごとに自動更新）。
          視聴者数は取得時点の同時視聴者数です。
        </p>
      </footer>
    </main>
  );
}
