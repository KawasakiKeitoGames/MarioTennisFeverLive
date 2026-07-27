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

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      {/* ヘッダー：スコアボードを thesis に */}
      <header className="mb-8">
        <div className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] text-ball uppercase mb-3">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-ball" />
          Now Serving
        </div>
        <h1 className="text-3xl sm:text-4xl font-black leading-tight tracking-tight">
          マリオテニスフィーバー
          <br />
          <span className="text-court">配信中</span>
          <span className="text-clay"> LIVE</span> ボード
        </h1>
        <p className="mt-3 text-sub text-sm leading-relaxed">
          YouTube と Twitch を横断して、いま配信中のマリオテニスフィーバーを集計。
          全言語対応・視聴者数順。
        </p>

        {/* 総視聴者スコア */}
        <div className="mt-6 flex items-end gap-6 border-y border-line py-4">
          <div>
            <div className="text-4xl font-black tabular-nums text-ball">
              {grandTotal.toLocaleString("ja-JP")}
            </div>
            <div className="text-xs uppercase tracking-wider text-sub mt-1">
              いま観られている総人数
            </div>
          </div>
          <div className="text-sm text-sub ml-auto text-right">
            <div>
              配信数{" "}
              <span className="font-bold text-chalk tabular-nums">
                {youtube.length + twitch.length}
              </span>
            </div>
            <div className="mt-1">更新 {relativeTime(capturedAt)}</div>
          </div>
        </div>
      </header>

      {/* コントロール */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-1 text-sm">
          <span className="text-sub mr-2">並び替え</span>
          <button
            onClick={() => setSortKey("viewers")}
            className={`px-3 py-1 rounded border text-xs font-bold transition-colors ${
              sortKey === "viewers"
                ? "border-court bg-court/15 text-court"
                : "border-line text-sub hover:text-chalk"
            }`}
          >
            視聴者数
          </button>
          <button
            onClick={() => setSortKey("name")}
            className={`px-3 py-1 rounded border text-xs font-bold transition-colors ${
              sortKey === "name"
                ? "border-court bg-court/15 text-court"
                : "border-line text-sub hover:text-chalk"
            }`}
          >
            名前順
          </button>
        </div>
        <Link
          href="/history"
          className="text-xs font-bold text-clay hover:underline"
        >
          視聴者数の推移を見る →
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-clay/40 bg-clay/10 px-4 py-3 text-sm text-clay">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sub text-center py-16">読み込み中…</div>
      ) : (
        <>
          <StreamList title="配信中" platform="youtube" streams={youtube} sortKey={sortKey} />
          <StreamList title="配信中" platform="twitch" streams={twitch} sortKey={sortKey} />
        </>
      )}

      <footer className="mt-12 court-rule" />
      <p className="mt-4 text-xs text-sub leading-relaxed">
        データは定期取得のキャッシュを表示しています（1分ごとに自動更新）。
        視聴者数は取得時点の同時視聴者数です。
      </p>
    </main>
  );
}
