"use client";

import type { StreamSnapshot, Platform } from "@/lib/types";

type SortKey = "viewers" | "name";

function fmt(n: number | null): string {
  return n == null ? "—" : n.toLocaleString("ja-JP");
}

export default function StreamList({
  title,
  platform,
  streams,
  sortKey,
}: {
  title: string;
  platform: Platform;
  streams: StreamSnapshot[];
  sortKey: SortKey;
}) {
  const sorted = [...streams].sort((a, b) => {
    if (sortKey === "name") {
      return (a.channel_name ?? "").localeCompare(b.channel_name ?? "", "ja");
    }
    return (b.viewers ?? 0) - (a.viewers ?? 0);
  });

  const total = sorted.reduce((s, x) => s + (x.viewers ?? 0), 0);
  const accent = platform === "youtube" ? "text-clay" : "text-court";
  const badge =
    platform === "youtube"
      ? "bg-clay/15 text-clay border-clay/30"
      : "bg-court/15 text-court border-court/30";

  return (
    <section className="mb-10">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className={`inline-block px-2 py-0.5 text-xs font-bold border rounded ${badge}`}>
            {platform === "youtube" ? "YouTube" : "Twitch"}
          </span>
          <span>{title}</span>
        </h2>
        <div className="text-sm text-sub tabular-nums">
          <span className="font-bold text-chalk">{sorted.length}</span> 配信 ／ 計{" "}
          <span className="font-bold text-chalk">{fmt(total)}</span> 人
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel px-5 py-8 text-center text-sub">
          いま配信中のチャンネルはありません。次のゲームを待ちましょう。
        </div>
      ) : (
        <ul className="rounded-lg border border-line bg-panel divide-y divide-line overflow-hidden">
          {sorted.map((s, i) => (
            <li key={`${s.channel_id}-${i}`}>
              <a
                href={s.url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 px-4 py-3 hover:bg-white/[0.03] focus-visible:bg-white/[0.05] outline-none"
              >
                {/* 視聴者数（スコアボード風） */}
                <div className="w-20 shrink-0 text-right">
                  <div className={`text-xl font-black tabular-nums ${accent}`}>
                    {fmt(s.viewers)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-sub">viewers</div>
                </div>

                <div className="w-px self-stretch bg-line" />

                {/* チャンネル & タイトル */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="live-dot inline-block h-2 w-2 rounded-full bg-ball shrink-0" />
                    <span className="font-bold truncate group-hover:underline">
                      {s.channel_name ?? s.channel_id}
                    </span>
                    {s.language && (
                      <span className="text-[10px] uppercase text-sub border border-line rounded px-1 py-0.5 shrink-0">
                        {s.language}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-sub truncate mt-0.5">{s.title}</div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
