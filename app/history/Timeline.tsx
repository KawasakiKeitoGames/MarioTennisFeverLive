"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useLang } from "../components/LocaleProvider";
import { GAME_BY_ID, gameLabel, type GameId } from "@/lib/games";
import { intlLocale, type Lang } from "@/lib/i18n";

export interface Session {
  platform: "youtube" | "twitch";
  channel_id: string;
  channel_name: string;
  game: GameId | null;
  start: number; // epoch ms
  end: number; // epoch ms
  peak: number;
  avg: number;
}

// 行頭のドット＝プラットフォーム（YouTube/Twitch）。帯の色＝ゲームタイトル。
const PF_COLOR = { youtube: "#e62117", twitch: "#9146ff" } as const;
const NO_GAME_COLOR = "#94a3b8"; // タイトル不明（判別前の古いデータ）用
const LABEL_W = 88; // チャンネル名カラムの幅(px)
const RLABEL_W = 72; // 右端の名前カラムの幅(px・sm以上のみ表示)。sm:right-[72px] と一致必須
const MIN_BAR = 6; // 帯の最小幅(px)。1点しか観測できなかった配信も見えるようにする
// ピーク人数ラベル(9px・tabular-nums)のおおよその幅。重なり判定に使う。
const labelWidth = (text: string): number => text.length * 5.6 + 5;

function gameColor(game: GameId | null): string {
  return (game && GAME_BY_ID.get(game)?.chartColor) || NO_GAME_COLOR;
}
function gameName(game: GameId | null, lang: Lang): string {
  const g = game ? GAME_BY_ID.get(game) : undefined;
  return g ? gameLabel(g, lang) : lang === "en" ? "Unknown" : "不明";
}

// JSTの時刻ラベル。期間が長いほど日付主体にする。
function jstLabel(t: number, hours: number, lang: Lang): string {
  const d = new Date(t);
  const loc = intlLocale(lang);
  const o: Intl.DateTimeFormatOptions = { timeZone: "Asia/Tokyo", hour12: false };
  if (hours <= 24) return d.toLocaleTimeString(loc, { ...o, hour: "2-digit", minute: "2-digit" });
  if (hours <= 72) return d.toLocaleString(loc, { ...o, month: "numeric", day: "numeric", hour: "2-digit" });
  return d.toLocaleDateString(loc, { ...o, month: "numeric", day: "numeric" });
}

// 目盛り位置（JSTのキリの良い時刻）を窓に対する%で返す。
function ticksFor(winStart: number, winEnd: number, hours: number, lang: Lang) {
  const stepH = hours <= 6 ? 1 : hours <= 24 ? 3 : hours <= 72 ? 12 : hours <= 168 ? 24 : 168;
  const stepMs = stepH * 3600e3;
  const JST = 9 * 3600e3;
  const first = Math.ceil((winStart + JST) / stepMs) * stepMs - JST;
  const span = Math.max(1, winEnd - winStart);
  const out: { pct: number; label: string }[] = [];
  for (let t = first; t <= winEnd; t += stepMs) {
    out.push({ pct: ((t - winStart) / span) * 100, label: jstLabel(t, hours, lang) });
  }
  return out;
}

// 断続的な配信を「行=チャンネル・帯=配信時間」のガント風に表示する。
// 帯の色＝ゲームタイトル、濃さ＝ピーク視聴者数。
// 折れ線が繋がらない問題を回避し、誰がいつ何を配信したかを直感的に見せる。
export default function Timeline({
  sessions,
  winStart,
  winEnd,
  hours,
  maxLanes = 10,
}: {
  sessions: Session[];
  winStart: number;
  winEnd: number;
  hours: number;
  maxLanes?: number;
}) {
  const { lang, t } = useLang();
  // 帯トラックの実幅(px)。ピーク人数ラベルが隣の帯やラベルと重ならないかの判定に使う。
  const trackRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(0);
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setTrackW(el.clientWidth);
    update();
    window.addEventListener("resize", update); // ResizeObserver非対応/未発火時の保険
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);

  const laneMap = new Map<
    string,
    {
      platform: "youtube" | "twitch";
      channelId: string;
      name: string;
      peak: number;
      bars: Session[];
    }
  >();
  for (const s of sessions) {
    const k = `${s.platform}|${s.channel_id}`;
    const l =
      laneMap.get(k) ??
      { platform: s.platform, channelId: s.channel_id, name: s.channel_name, peak: 0, bars: [] };
    l.peak = Math.max(l.peak, s.peak);
    l.bars.push(s);
    laneMap.set(k, l);
  }
  const lanes = [...laneMap.values()].sort((a, b) => b.peak - a.peak);
  const shown = lanes.slice(0, maxLanes);
  const hidden = lanes.length - shown.length;
  const maxPeak = Math.max(1, ...shown.map((l) => l.peak));
  const span = Math.max(1, winEnd - winStart);
  const ticks = ticksFor(winStart, winEnd, hours, lang);
  // 凡例は実際に表示されているタイトルだけ出す（GAMES の定義順）
  const shownGames = new Set(shown.flatMap((l) => l.bars.map((b) => b.game)));
  const legend = [...GAME_BY_ID.values()].filter((g) => shownGames.has(g.id));

  if (shown.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-400">
        {t("tl.empty")}
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        {/* 目盛りの縦線（トラック領域のみ）。この要素の幅＝帯トラックの幅として測る */}
        <div
          ref={trackRef}
          className="pointer-events-none absolute inset-y-0 right-0 sm:right-[72px]"
          style={{ left: LABEL_W }}
        >
          {ticks.map((t, i) => (
            <div
              key={i}
              className="absolute bottom-4 top-0 border-l border-slate-100"
              style={{ left: `${t.pct}%` }}
            />
          ))}
        </div>

        {/* レーン（縞模様＝行の追跡を助ける） */}
        <ul className="relative">
          {shown.map((l) => {
            // 帯を時系列に並べ直し、左から順にピーク人数ラベルの置き場所を決める。
            // 「すでに埋まっている右端(occupied)」を持ち回ることで、帯どうし・
            // ラベルどうしのどちらとも重ならない場所にだけラベルを出す。
            const geo = l.bars
              .slice()
              .sort((a, b) => a.start - b.start)
              .map((b) => {
                const leftPct = Math.max(0, ((b.start - winStart) / span) * 100);
                const widthPct = Math.max(0, ((b.end - b.start) / span) * 100);
                const leftPx = (leftPct / 100) * trackW;
                const widthPx = Math.max((widthPct / 100) * trackW, MIN_BAR);
                return { b, leftPct, widthPct, leftPx, rightPx: leftPx + widthPx };
              });
            let occupied = 0;
            const lay = geo.map((g, i) => {
              const text = String(g.b.peak);
              const lw = labelWidth(text);
              // 帯の中に数字が収まる幅か（実測できていないあいだは%で暫定判定）
              const fitsInside = trackW ? g.rightPx - g.leftPx >= lw + 8 : g.widthPct > 7;
              let side: "none" | "left" | "right" = "none";
              if (!fitsInside) {
                if (!trackW) {
                  side = g.leftPct + g.widthPct > 91 ? "left" : "right";
                } else {
                  const nextLeft = i + 1 < geo.length ? geo[i + 1].leftPx : trackW;
                  const roomLeft = g.leftPx - occupied;
                  const roomRight = nextLeft - g.rightPx;
                  const preferLeft = g.leftPct + g.widthPct > 91;
                  if (preferLeft && roomLeft >= lw) side = "left";
                  else if (roomRight >= lw) side = "right";
                  else if (roomLeft >= lw) side = "left";
                }
              }
              occupied = Math.max(occupied, side === "right" ? g.rightPx + lw : g.rightPx);
              return { ...g, text, fitsInside, side };
            });
            return (
              <li
                key={`${l.platform}-${l.channelId}`}
                className="flex items-center rounded odd:bg-slate-50/70 hover:bg-slate-100/70"
                style={{ height: 28 }}
              >
                <div className="flex shrink-0 items-center gap-1.5" style={{ width: LABEL_W }}>
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: PF_COLOR[l.platform] }} />
                  <Link
                    href={`/streamers/${l.platform}/${encodeURIComponent(l.channelId)}`}
                    className="truncate text-xs text-slate-600 hover:text-brand hover:underline"
                    title={l.name}
                  >
                    {l.name}
                  </Link>
                </div>
                <div className="relative h-full flex-1">
                  {lay.map((g, i) => {
                    const b = g.b;
                    const text = g.text;
                    const fitsInside = g.fitsInside;
                    const side = g.side;
                    const barStyle: CSSProperties = {
                      left: `${g.leftPct}%`,
                      width: `${g.widthPct}%`,
                      minWidth: MIN_BAR,
                      top: 7,
                      height: 14,
                      background: gameColor(b.game),
                      opacity: 0.4 + 0.5 * (b.peak / maxPeak),
                    };
                    const labelStyle: CSSProperties =
                      side === "left"
                        ? trackW
                          ? { right: trackW - g.leftPx, paddingRight: 3, top: 7, height: 14 }
                          : { right: `${Math.max(0, 100 - g.leftPct)}%`, paddingRight: 3, top: 7, height: 14 }
                        : trackW
                          ? { left: g.rightPx, paddingLeft: 3, top: 7, height: 14 }
                          : { left: `${g.leftPct + g.widthPct}%`, paddingLeft: 3, top: 7, height: 14 };
                    const tip =
                      lang === "en"
                        ? `${l.name} | ${gameName(b.game, lang)} | ${jstLabel(b.start, 24, lang)}–${jstLabel(b.end, 24, lang)} | peak ${b.peak}`
                        : `${l.name}｜${gameName(b.game, lang)}｜${jstLabel(b.start, 24, lang)}〜${jstLabel(b.end, 24, lang)}｜ピーク${b.peak}人`;
                    return (
                      <div key={i}>
                        <div
                          className="absolute flex items-center justify-end overflow-hidden rounded"
                          style={barStyle}
                          title={tip}
                        >
                          {fitsInside && (
                            <span className="px-1 text-[9px] font-bold tabular-nums text-white">{text}</span>
                          )}
                        </div>
                        {/* 幅が足りない帯はピーク人数を帯の外側に出す（置けるときだけ＝重なり防止） */}
                        {!fitsInside && side !== "none" && (
                          <span
                            title={tip}
                            className="absolute flex items-center text-[9px] font-bold tabular-nums text-slate-500"
                            style={labelStyle}
                          >
                            {text}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {/* 右端にも名前を出す（グラフ右側で行を見失わないため・sm以上） */}
                <div className="hidden shrink-0 items-center justify-end sm:flex" style={{ width: RLABEL_W }}>
                  <span className="truncate pl-1 text-right text-[10px] text-slate-400" title={l.name}>
                    {l.name}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* 時刻の目盛りラベル */}
        <div className="relative mt-1 h-4">
          <div className="absolute right-0 sm:right-[72px]" style={{ left: LABEL_W }}>
            {ticks.map((t, i) => (
              <span
                key={i}
                className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] text-slate-400"
                style={{ left: `${t.pct}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 凡例：帯の色＝ゲームタイトル */}
      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="text-slate-400">{t("tl.legend")}</span>
          {legend.map((g) => (
            <span key={g.id} className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-[2px]" style={{ background: g.chartColor }} />
              {gameLabel(g, lang)}
            </span>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        {lang === "en" ? (
          <>
            {hidden > 0 ? `Showing the top ${maxLanes} channels by peak (${hidden} more not shown). ` : ""}
            Bars = time live; color = game, opacity &amp; number = peak viewers (the number is hidden
            where there is no room — hover the bar). Tap a name for that streamer&apos;s page.
          </>
        ) : (
          <>
            {hidden > 0 ? `ピーク上位${maxLanes}chを表示（ほか${hidden}ch）。` : ""}
            帯＝配信していた時間、色＝ゲームタイトル、濃さ・数字＝ピーク視聴者数（数字は場所が足りないときは省略。帯にカーソルを合わせると出ます）。名前を押すと配信者ページへ。
          </>
        )}
      </p>
    </div>
  );
}
