"use client";

import type { CSSProperties } from "react";
import { useLang } from "../components/LocaleProvider";
import { intlLocale, type Lang } from "@/lib/i18n";

export interface Session {
  platform: "youtube" | "twitch";
  channel_name: string;
  start: number; // epoch ms
  end: number; // epoch ms
  peak: number;
  avg: number;
}

const COLOR = { youtube: "#e62117", twitch: "#9146ff" } as const;
const LABEL_W = 88; // チャンネル名カラムの幅(px)
const RLABEL_W = 72; // 右端の名前カラムの幅(px・sm以上のみ表示)。sm:right-[72px] と一致必須

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
// 帯の濃さ＝ピーク視聴者数。折れ線が繋がらない問題を回避し、誰がいつ配信したかを直感的に見せる。
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
  const laneMap = new Map<
    string,
    { platform: "youtube" | "twitch"; name: string; peak: number; bars: Session[] }
  >();
  for (const s of sessions) {
    const k = `${s.platform}|${s.channel_name}`;
    const l = laneMap.get(k) ?? { platform: s.platform, name: s.channel_name, peak: 0, bars: [] };
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
        {/* 目盛りの縦線（トラック領域のみ） */}
        <div
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
          {shown.map((l) => (
            <li
              key={`${l.platform}-${l.name}`}
              className="flex items-center rounded odd:bg-slate-50/70 hover:bg-slate-100/70"
              style={{ height: 28 }}
            >
              <div className="flex shrink-0 items-center gap-1.5" style={{ width: LABEL_W }}>
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: COLOR[l.platform] }} />
                <span className="truncate text-xs text-slate-600" title={l.name}>
                  {l.name}
                </span>
              </div>
              <div className="relative h-full flex-1">
                {l.bars.map((b, i) => {
                  const leftPct = Math.max(0, ((b.start - winStart) / span) * 100);
                  const widthPct = ((b.end - b.start) / span) * 100;
                  const endPct = leftPct + widthPct;
                  const fitsInside = widthPct > 7; // 帯の中に数字が収まる幅か
                  const style: CSSProperties = {
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    minWidth: 6,
                    top: 7,
                    height: 14,
                    background: COLOR[l.platform],
                    opacity: 0.4 + 0.5 * (b.peak / maxPeak),
                  };
                  return (
                    <div key={i}>
                      <div
                        className="absolute flex items-center justify-end overflow-hidden rounded"
                        style={style}
                        title={
                          lang === "en"
                            ? `${l.name} | ${jstLabel(b.start, 24, lang)}–${jstLabel(b.end, 24, lang)} | peak ${b.peak}`
                            : `${l.name}｜${jstLabel(b.start, 24, lang)}〜${jstLabel(b.end, 24, lang)}｜ピーク${b.peak}人`
                        }
                      >
                        {fitsInside && (
                          <span className="px-1 text-[9px] font-bold tabular-nums text-white">{b.peak}</span>
                        )}
                      </div>
                      {/* 幅が足りない帯はピーク人数を帯の外側に出す（常に全帯で表示） */}
                      {!fitsInside && (
                        <span
                          className="pointer-events-none absolute flex items-center text-[9px] font-bold tabular-nums text-slate-500"
                          style={
                            endPct > 91
                              ? { right: `${Math.max(0, 100 - leftPct)}%`, paddingRight: 3, top: 7, height: 14 }
                              : { left: `${endPct}%`, paddingLeft: 3, top: 7, height: 14 }
                          }
                        >
                          {b.peak}
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
          ))}
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

      <p className="mt-2 text-xs text-slate-400">
        {lang === "en" ? (
          <>
            {hidden > 0 ? `Showing the top ${maxLanes} channels by peak (${hidden} more not shown). ` : ""}
            Bars = time live; opacity &amp; number = peak viewers.
          </>
        ) : (
          <>
            {hidden > 0 ? `ピーク上位${maxLanes}chを表示（ほか${hidden}ch）。` : ""}
            帯＝配信していた時間、濃さ・数字＝ピーク視聴者数。
          </>
        )}
      </p>
    </div>
  );
}
