"use client";

import type { StreamSnapshot, Platform } from "@/lib/types";
import { GAME_BY_ID, gameLabel } from "@/lib/games";
import { trackClick } from "@/lib/track";
import { useLang } from "./LocaleProvider";
import type { Lang } from "@/lib/i18n";

type SortKey = "viewers" | "name" | "elapsed";

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
function elapsedLabel(
  startedAt: string | null | undefined,
  nowIso: string | null,
  lang: Lang,
): string | null {
  if (!startedAt) return null;
  const end = nowIso ? new Date(nowIso).getTime() : Date.now();
  const min = Math.floor((end - new Date(startedAt).getTime()) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (lang === "en") {
    if (min < 1) return "just started";
    if (min < 60) return `${min}m live`;
    return m === 0 ? `${h}h live` : `${h}h ${m}m live`;
  }
  if (min < 1) return "開始直後";
  if (min < 60) return `${min}分経過`;
  return m === 0 ? `${h}時間経過` : `${h}時間${m}分経過`;
}

// 経過時間順の並び替え用。started_at からの経過ミリ秒。開始不明(-1)は末尾に沈める。
function elapsedMs(s: StreamSnapshot, nowIso: string | null): number {
  if (!s.started_at) return -1;
  const end = nowIso ? new Date(nowIso).getTime() : Date.now();
  return end - new Date(s.started_at).getTime();
}

// 視聴者数トレンドの見た目（横ばいは表示しない＝上昇/下降のときだけバッジを出す）
const TREND: Record<string, { icon: string; labelKey: "list.trendUp" | "list.trendDown"; cls: string }> = {
  up: { icon: "📈", labelKey: "list.trendUp", cls: "border-emerald-200 bg-emerald-50 text-emerald-600" },
  down: { icon: "📉", labelKey: "list.trendDown", cls: "border-amber-200 bg-amber-50 text-amber-600" },
};

function Badges({ s, capturedAt }: { s: StreamSnapshot; capturedAt: string | null }) {
  const { lang, t } = useLang();
  const elapsed = elapsedLabel(s.started_at, capturedAt, lang);
  const streak = s.streak_days ?? 0;
  const trend = s.trend ? TREND[s.trend] : null;
  if (!elapsed && streak < 2 && !trend) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {streak >= 2 && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">
          🔥 {lang === "en" ? `${streak}-day streak` : `${streak}日連続`}
        </span>
      )}
      {elapsed && (
        <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          ⏱ {elapsed}
        </span>
      )}
      {trend && (
        <span
          title={t("list.trendTitle")}
          className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${trend.cls}`}
        >
          {trend.icon} {t(trend.labelKey)}
        </span>
      )}
    </div>
  );
}

export default function StreamList({
  streams,
  sortKey,
  capturedAt,
  showGameBadge = false,
}: {
  streams: StreamSnapshot[];
  sortKey: SortKey;
  capturedAt: string | null;
  // 「すべて」表示のとき、どのタイトルの配信か一目で分かるようゲームバッジを出す
  showGameBadge?: boolean;
}) {
  const { lang, t } = useLang();
  const sorted = [...streams].sort((a, b) => {
    if (sortKey === "name") {
      return (a.channel_name ?? "").localeCompare(b.channel_name ?? "", "ja");
    }
    if (sortKey === "elapsed") {
      // 経過が長い順（開始不明は末尾）
      return elapsedMs(b, capturedAt) - elapsedMs(a, capturedAt);
    }
    return (b.viewers ?? 0) - (a.viewers ?? 0);
  });

  return (
    <section className="mb-6">
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400 shadow-sm">
          {t("list.empty")}
        </div>
      ) : (
        <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden shadow-sm">
          {sorted.map((s, i) => {
            const thumb = thumbUrl(s);
            const st = STYLES[s.platform];
            const game = showGameBadge ? GAME_BY_ID.get(s.game) : undefined;
            return (
              <li key={`${s.platform}-${s.channel_id}-${i}`}>
                <a
                  href={s.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackClick(s)}
                  className="group flex items-center gap-3 p-2.5 hover:bg-slate-50 transition-colors outline-none focus-visible:bg-slate-50"
                >
                  {/* サムネイル（バッジは名前の右隣へ移動＝サムネを隠さない） */}
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
                  </div>

                  {/* チャンネル名 + タイトル + バッジ */}
                  <div className="min-w-0 flex-1">
                    {/* スマホは名前を1行占有させ、バッジ類は下の行に折り返す（名前が見切れないように） */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap">
                      <span className="w-full truncate font-bold text-[15px] leading-tight text-slate-900 group-hover:underline sm:w-auto">
                        {s.channel_name ?? s.channel_id}
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${st.badge}`}
                      >
                        <span className={`h-1 w-1 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                      {game && (
                        <span
                          title={lang === "en" ? game.fullNameEn : game.fullName}
                          className={`shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${game.badgeClass}`}
                        >
                          <span className={`h-1 w-1 rounded-full ${game.dotClass}`} />
                          {gameLabel(game, lang)}
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
                    <div className="mt-0.5 text-[10px] text-slate-400">{t("list.viewers")}</div>
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
