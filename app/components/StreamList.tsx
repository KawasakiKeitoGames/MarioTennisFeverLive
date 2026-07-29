"use client";

import type { StreamSnapshot, Platform } from "@/lib/types";
import { trackClick } from "@/lib/track";

type SortKey = "viewers" | "name";

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("ja-JP");
}

// 配信サムネイル（各プラットフォームのCDNから直接配信＝Supabase egressはゼロ）
function thumbUrl(s: StreamSnapshot): string | null {
  if (s.platform === "youtube" && s.stream_id) {
    return `https://i.ytimg.com/vi/${s.stream_id}/mqdefault.jpg`;
  }
  if (s.platform === "twitch" && s.channel_id) {
    return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.channel_id}-440x248.jpg`;
  }
  return null;
}

const STYLES: Record<
  Platform,
  { label: string; text: string; dot: string; badge: string }
> = {
  youtube: {
    label: "YouTube",
    text: "text-youtube",
    dot: "bg-youtube",
    badge: "bg-youtube/10 text-youtube border-youtube/20",
  },
  twitch: {
    label: "Twitch",
    text: "text-twitch",
    dot: "bg-twitch",
    badge: "bg-twitch/10 text-twitch border-twitch/20",
  },
};

// 配信開始検知からの経過時間をざっくり表示（配信詳細APIは叩かない推定値）
function elapsedLabel(startedAt: string | null | undefined, nowIso: string | null): string | null {
  if (!startedAt) return null;
  const end = nowIso ? new Date(nowIso).getTime() : Date.now();
  const min = Math.floor((end - new Date(startedAt).getTime()) / 60000);
  if (min < 1) return "開始直後";
  if (min < 60) return `${min}分経過`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間経過` : `${h}時間${m}分経過`;
}

// 視聴者数トレンドの見た目（横ばいは表示しない＝上昇/下降のときだけバッジを出す）
const TREND: Record<string, { icon: string; label: string; cls: string }> = {
  up: { icon: "📈", label: "上昇", cls: "border-emerald-200 bg-emerald-50 text-emerald-600" },
  down: { icon: "📉", label: "下降", cls: "border-amber-200 bg-amber-50 text-amber-600" },
};

function Badges({ s, capturedAt }: { s: StreamSnapshot; capturedAt: string | null }) {
  const elapsed = elapsedLabel(s.started_at, capturedAt);
  const streak = s.streak_days ?? 0;
  const trend = s.trend ? TREND[s.trend] : null;
  if (!elapsed && streak < 2 && !trend) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {streak >= 2 && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
          🔥 {streak}日連続
        </span>
      )}
      {elapsed && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          ⏱ {elapsed}
        </span>
      )}
      {trend && (
        <span
          className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${trend.cls}`}
        >
          {trend.icon} {trend.label}
        </span>
      )}
    </div>
  );
}

export default function StreamList({
  streams,
  sortKey,
  capturedAt,
}: {
  streams: StreamSnapshot[];
  sortKey: SortKey;
  capturedAt: string | null;
}) {
  const sorted = [...streams].sort((a, b) => {
    if (sortKey === "name") {
      return (a.channel_name ?? "").localeCompare(b.channel_name ?? "", "ja");
    }
    return (b.viewers ?? 0) - (a.viewers ?? 0);
  });

  const ytCount = streams.filter((s) => s.platform === "youtube").length;
  const twCount = streams.filter((s) => s.platform === "twitch").length;

  return (
    <section className="mb-6">
      {/* 内訳（PFで分けない代わりに件数だけ小さく表示） */}
      <div className="mb-2 flex items-center gap-3 px-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-youtube" />
          YouTube <span className="font-bold text-slate-700">{ytCount}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-twitch" />
          Twitch <span className="font-bold text-slate-700">{twCount}</span>
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400 shadow-sm">
          いま配信中のチャンネルはありません。
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-sm">
          {sorted.map((s, i) => {
            const thumb = thumbUrl(s);
            const st = STYLES[s.platform];
            return (
              <li key={`${s.platform}-${s.channel_id}-${i}`}>
                <a
                  href={s.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackClick(s)}
                  className="group flex items-center gap-3 p-2.5 hover:bg-slate-50 transition-colors outline-none focus-visible:bg-slate-50"
                >
                  {/* サムネイル + PFチップ */}
                  <div className="relative w-28 sm:w-32 shrink-0 aspect-video rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    <span
                      className={`absolute left-1 top-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold shadow-sm backdrop-blur ${st.badge}`}
                    >
                      <span className={`h-1 w-1 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </div>

                  {/* チャンネル名 + タイトル + バッジ */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[15px] leading-tight text-slate-900 truncate group-hover:underline">
                        {s.channel_name ?? s.channel_id}
                      </span>
                      {s.orientation === "portrait" && (
                        <span
                          title="縦画面の配信"
                          className="shrink-0 inline-flex items-center gap-0.5 rounded border border-fuchsia-200 bg-fuchsia-50 px-1 py-0.5 text-[9px] font-bold text-fuchsia-600"
                        >
                          📱 縦
                        </span>
                      )}
                      {s.language && (
                        <span className="shrink-0 rounded border border-slate-200 px-1 py-0.5 text-[9px] font-medium uppercase text-slate-400">
                          {s.language}
                        </span>
                      )}
                    </div>
                    {/* タイトルは名前より小さく（情報密度アップ） */}
                    <div className="mt-0.5 text-xs leading-snug text-slate-500 line-clamp-2">
                      {s.title}
                    </div>
                    <Badges s={s} capturedAt={capturedAt} />
                  </div>

                  {/* 視聴者数 */}
                  <div className="shrink-0 pl-1 pr-1 text-right">
                    <div className={`text-lg font-black tabular-nums leading-none ${st.text}`}>
                      {fmt(s.viewers)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-slate-400">視聴者</div>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
