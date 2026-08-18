// 対応ゲームタイトルの定義。ここに1エントリ足すだけで
// 収集（YouTube判別キーワード・Twitchカテゴリ）と表示（タブ・バッジ配色）の
// 両方に反映される。DBの game 列にはこの id がそのまま入る。
// ※ badgeClass / dotClass はTailwindのJITが拾えるよう完全なクラス名の文字列で書くこと。

export type GameId = "fever" | "aces" | "mt64";

export interface GameDef {
  id: GameId;
  label: string; // タブ・バッジ用の短い表示名
  labelEn: string; // 英語UIでの短い表示名
  fullName: string; // 正式名（説明文用）
  fullNameEn: string; // 英語の正式名
  twitchCategory: string; // Twitchの配信カテゴリ名（完全一致）
  ytKeywords: string[]; // YouTubeタイトル判別キーワード（空白無視・小文字化して部分一致）
  badgeClass: string; // ゲームバッジの配色
  dotClass: string; // バッジ内のドット色
  chartColor: string; // グラフ等でこのタイトルを表す色
}

export const GAMES: GameDef[] = [
  {
    id: "fever",
    label: "フィーバー",
    labelEn: "Fever",
    fullName: "マリオテニスフィーバー",
    fullNameEn: "Mario Tennis Fever",
    twitchCategory: "Mario Tennis Fever",
    ytKeywords: ["マリオテニスフィーバー", "mario tennis fever"],
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotClass: "bg-emerald-500",
    chartColor: "#1f9d4d",
  },
  {
    id: "aces",
    label: "エース",
    labelEn: "Aces",
    fullName: "マリオテニス エース",
    fullNameEn: "Mario Tennis Aces",
    twitchCategory: "Mario Tennis Aces",
    ytKeywords: ["マリオテニスエース", "mario tennis aces"],
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    dotClass: "bg-rose-500",
    chartColor: "#e11d48",
  },
  {
    id: "mt64",
    label: "64",
    labelEn: "64",
    fullName: "マリオテニス64",
    fullNameEn: "Mario Tennis 64",
    // N64版の海外タイトルは「Mario Tennis」で、Twitchカテゴリ名もこれ
    twitchCategory: "Mario Tennis",
    ytKeywords: ["マリオテニス64", "mario tennis 64"],
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    dotClass: "bg-sky-500",
    chartColor: "#0284c7",
  },
];

export const GAME_BY_ID: ReadonlyMap<GameId, GameDef> = new Map(
  GAMES.map((g) => [g.id, g]),
);

export function isGameId(v: string | null | undefined): v is GameId {
  return v != null && GAMES.some((g) => g.id === v);
}

// 言語別の表示名（英語UIのときだけ labelEn / fullNameEn を使う）
export function gameLabel(g: GameDef, lang: "ja" | "en"): string {
  return lang === "en" ? g.labelEn : g.label;
}
export function gameFullName(g: GameDef, lang: "ja" | "en"): string {
  return lang === "en" ? g.fullNameEn : g.fullName;
}

// タイトルの空白（半角/全角）を無視して小文字で突き合わせる。
// 「マリオテニス エース」のように語間に空白を挟むタイトルを取りこぼさないため。
const normalize = (s: string): string => s.toLowerCase().replace(/[\s　]+/g, "");

const NORMALIZED: Array<{ id: GameId; keys: string[] }> = GAMES.map((g) => ({
  id: g.id,
  keys: g.ytKeywords.map(normalize),
}));

/**
 * 配信タイトルからゲームタイトルを判別する（YouTube用）。
 * どのゲームのキーワードにも一致しなければ null（＝対象外として除外）。
 * 複数一致した場合は GAMES の定義順で最初に一致したものを採用する。
 */
export function classifyTitle(title: string): GameId | null {
  const hay = normalize(title);
  for (const g of NORMALIZED) {
    if (g.keys.some((k) => hay.includes(k))) return g.id;
  }
  return null;
}
