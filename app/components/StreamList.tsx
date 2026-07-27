"use client";

import type { StreamSnapshot, Platform } from "@/lib/types";

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
  { label: string; text: string; dot: string; badge: string; ring: string }
> = {
  youtube: {
    label: "YouTube",
    text: "text-youtube",
    dot: "bg-youtube",
    badge: "bg-youtube/10 text-youtube border-youtube/20",
    ring: "bg-youtube",
  },
  twitch: {
    label: "Twitch",
    text: "text-twitch",
    dot: "bg-twitch",
    badge: "bg-twitch/10 text-twitch border-twitch/20",
    ring: "bg-twitch",
  },
};

export default function StreamList({
  platform,
  streams,
  sortKey,
}: {
  platform: Platform;
  streams: StreamSnapshot[];
  sortKey: SortKey;
}) {
  const st = STYLES[platform];
  const sorted = [...streams].sort((a, b) => {
    if (sortKey === "name") {
      return (a.channel_name ?? "").localeCompare(b.channel_name ?? "", "ja");
    }
    return (b.viewers ?? 0) - (a.viewers ?? 0);
  });
  const total = sorted.reduce((s, x) => s + (x.viewers ?? 0), 0);

  return (
    <section className="mb-6">
      {/* セクション見出し */}
      <div className="flex items-baseline justify-between mb-2 px-1">
        <h2 className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold border rounded-full ${st.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        </h2>
        <div className="text-xs text-slate-500 tabular-nums">
          <span className="font-bold text-slate-700">{sorted.length}</span> 配信 ／ 計{" "}
          <span className="font-bold text-slate-700">{fmt(total)}</span> 人
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400 shadow-sm">
          いま配信中のチャンネルはありません。
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-sm">
          {sorted.map((s, i) => {
            const thumb = thumbUrl(s);
            return (
              <li key={`${s.channel_id}-${i}`}>
                <a
                  href={s.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 p-2.5 hover:bg-slate-50 transition-colors outline-none focus-visible:bg-slate-50"
                >
                  {/* サムネイル */}
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
                    {/* LIVE ピル */}
                    <span
                      className={`absolute left-1 top-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white ${st.ring}`}
                    >
                      <span className="live-dot h-1 w-1 rounded-full bg-white" />
                      Live
                    </span>
                  </div>

                  {/* チャンネル名 + タイトル */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[15px] leading-tight text-slate-900 truncate group-hover:underline">
                        {s.channel_name ?? s.channel_id}
                      </span>
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
