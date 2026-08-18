// UI文言の日英辞書。公開3ページ（トップ・推移・ランキング）が対象で、admin配下は日本語のみ。
// キーは <画面>.<用途>。値の埋め込みが必要な文は各コンポーネント側で lang 分岐する。
// ロケールの保持・切替は app/components/LocaleProvider.tsx（localStorage "fl-lang"＋?lang=クエリ）。

export type Lang = "ja" | "en";

type Entry = { ja: string; en: string };

const DICT = {
  // 共通
  "common.loading": { ja: "読み込み中…", en: "Loading…" },
  "common.fetchError": { ja: "取得に失敗しました", en: "Failed to load" },
  "common.disclaimer": {
    ja: "本サイトは非公式のファン制作サイトです。任天堂株式会社および「マリオテニス」シリーズ各作品の公式、YouTube・Twitch とは一切関係ありません。各名称・商標は各権利者に帰属します。",
    en: "This is an unofficial fan-made site. It is not affiliated with Nintendo Co., Ltd., the Mario Tennis series, YouTube, or Twitch. All names and trademarks belong to their respective owners.",
  },
  "common.disclaimerShort": {
    ja: "本サイトは非公式のファン制作サイトです。任天堂株式会社および各権利者とは一切関係ありません。",
    en: "This is an unofficial fan-made site, not affiliated with Nintendo Co., Ltd. or any rights holders.",
  },
  "common.all": { ja: "すべて", en: "All" },
  "nav.home": { ja: "🏠 ライブボードに戻る", en: "🏠 Back to Live Board" },
  "nav.analytics": { ja: "📊 ランキング・記録 →", en: "📊 Rankings & Records →" },
  "nav.history": { ja: "📈 推移 →", en: "📈 Trends →" },
  "nav.streamers": { ja: "🔍 配信者検索 →", en: "🔍 Find streamers →" },

  // 配信者検索・詳細
  "st.title": { ja: "配信者検索", en: "Streamer Search" },
  "st.subtitle": {
    ja: "これまでに観測した配信者を名前で検索できます。名前を押すと配信傾向などの詳細が見られます。",
    en: "Search the streamers we have tracked. Tap a name to see their streaming patterns and details.",
  },
  "st.placeholder": { ja: "配信者名で検索…", en: "Search by streamer name…" },
  "st.recentHeader": { ja: "最近配信したチャンネル", en: "Recently active channels" },
  "st.resultsHeader": { ja: "検索結果", en: "Results" },
  "st.noResults": { ja: "見つかりませんでした。", en: "No streamers found." },
  "st.lastStreamed": { ja: "最終配信", en: "Last streamed" },
  "st.open": { ja: "チャンネルを開く ↗", en: "Open channel ↗" },
  "st.subs": { ja: "登録者", en: "Subscribers" },
  "st.since": { ja: "チャンネル開設", en: "Channel since" },
  "st.kpiHours": { ja: "配信時間", en: "Stream hours" },
  "st.kpiViewerHours": { ja: "延べ視聴", en: "Viewer-hours" },
  "st.kpiAvg": { ja: "平均同時視聴", en: "Avg viewers" },
  "st.hourTitle": { ja: "時間帯の傾向（日本時間）", en: "Hours of day (JST)" },
  "st.dowTitle": { ja: "曜日の傾向", en: "Days of week" },
  "st.recent": { ja: "直近の配信", en: "Recent streams" },
  "st.notFound": {
    ja: "このチャンネルのデータが見つかりませんでした。",
    en: "No data found for this channel.",
  },
  "st.rankTitle": {
    ja: "延べ視聴時間（同時視聴×時間）順の順位。全タイトル・YouTube/Twitch合算、比較は直前の同じ長さの期間。",
    en: "Rank by viewer-hours (concurrent viewers × hours), all games and platforms combined. Change vs the preceding period of the same length.",
  },
  "st.rankNew": { ja: "前期間データなし", en: "no data in prev. period" },
  "st.dataNote": {
    ja: "数値は本サイトが収集したスナップショットに基づく推定値です（収集間隔の粒度）。",
    en: "Figures are estimates based on snapshots collected by this site.",
  },

  // トップ（ライブボード）
  "home.title": { ja: "マリオテニス配信中ボード", en: "Mario Tennis Live Board" },
  "home.updated": { ja: "更新", en: "Updated" },
  "home.admin": { ja: "⚙️ 管理ページ", en: "⚙️ Admin" },
  "home.liveNow": { ja: "いま配信中", en: "Live now" },
  "home.vsLast": { ja: "前回比", en: "vs last" },
  "home.vsLastTitle": {
    ja: "本日1つ前の収集時点（Twitchは約2分前・YouTubeは時間帯により6〜30分前）の総視聴者数との差",
    en: "Change from the previous collection today (Twitch: ~2 min ago; YouTube: 6–30 min ago depending on time of day)",
  },
  "home.watching": { ja: "人が視聴中", en: "watching now" },
  "home.streams": { ja: "配信数", en: "Live streams" },
  "home.todayPeak": { ja: "本日ピーク", en: "Today's peak" },
  "home.counting": { ja: "集計中", en: "Counting…" },
  "home.sort": { ja: "並び替え", en: "Sort" },
  "sort.viewers": { ja: "視聴者数", en: "Viewers" },
  "sort.name": { ja: "名前順", en: "Name" },
  "sort.elapsed": { ja: "経過時間", en: "Uptime" },
  "home.timingTitle": { ja: "取得と更新のタイミング", en: "Data collection & refresh" },
  "home.ytFetch": { ja: "YouTube 取得", en: "YouTube" },
  "home.twFetch": { ja: "Twitch 取得", en: "Twitch" },
  "home.screenRefresh": { ja: "画面の更新", en: "Page refresh" },
  "home.last": { ja: "最終", en: "Last" },
  "home.every1min": { ja: "1分ごと", en: "Every minute" },
  "home.ytFetchDesc": {
    ja: "配信が集中する夜ほど短い間隔（20:00〜翌1:00 頃は約6分・夕方は約15分・日中は約30分）",
    en: "Fetched more often at night when streams peak (~6 min around 20:00–1:00 JST, ~15 min in the evening, ~30 min in the daytime)",
  },
  "home.twFetchDesc": {
    ja: "終日ほぼ一定で約2分ごと",
    en: "Roughly every 2 minutes, all day",
  },
  "home.refreshDesc": {
    ja: "取得済みデータを自動で再読込（閲覧時に外部APIは呼び出しません）",
    en: "Auto-reloads stored data (no external API calls while viewing)",
  },
  "home.viewersNote": {
    ja: "視聴者数は取得時点の同時視聴者数です。",
    en: "Viewer counts are concurrent viewers at collection time.",
  },

  // 配信リスト
  "list.empty": {
    ja: "いま配信中のチャンネルはありません。",
    en: "No channels are live right now.",
  },
  "list.viewers": { ja: "視聴者", en: "viewers" },
  "list.justStarted": { ja: "開始直後", en: "Just started" },
  "list.trendUp": { ja: "上昇", en: "Rising" },
  "list.trendDown": { ja: "下降", en: "Falling" },
  "list.trendTitle": {
    ja: "約20分前と比べた同時視聴者数の増減（±3人以上かつ±5%以上で表示）",
    en: "Change in concurrent viewers vs ~20 min ago (shown at ±3+ viewers and ±5%+)",
  },

  // 推移
  "hist.subtitle": {
    ja: "上：総同時視聴者数のうごき／下：どのチャンネルがいつ配信していたか。",
    en: "Top: total concurrent viewers over time. Bottom: who was streaming, and when.",
  },
  "hist.game": { ja: "タイトル", en: "Game" },
  "hist.platform": { ja: "対象", en: "Platform" },
  "hist.range": { ja: "期間", en: "Range" },
  "hist.combined": { ja: "合算", en: "All" },
  "hist.total": { ja: "総同時視聴者数", en: "Total concurrent viewers" },
  "hist.peak": { ja: "ピーク", en: "Peak" },
  "hist.noData": {
    ja: "この期間のデータはまだありません。",
    en: "No data for this period yet.",
  },
  "hist.timeline": { ja: "配信タイムライン", en: "Stream timeline" },
  "hist.note": {
    ja: "総同時視聴者数は各時点の YouTube＋Twitch の同時視聴合算です（配信のない時間帯は0）。タイムラインの帯は配信していた時間、濃さはピーク視聴者数を表します。",
    en: "Total concurrent viewers = YouTube + Twitch combined at each point (0 when nothing is live). Timeline bars show when each channel was live; darker bars mean higher peak viewers.",
  },
  "hist.tipViewers": { ja: "同時視聴", en: "Viewers" },
  "tl.empty": { ja: "この期間に配信はありません。", en: "No streams in this period." },

  // ランキング・記録
  "an.subtitle": {
    ja: "誰が・どの配信が・いつ盛り上がっているか。収集済みデータだけから集計しています（閲覧時に外部APIは呼びません）。",
    en: "Who and which streams are hot, and when. Aggregated from stored data only (no external API calls while viewing).",
  },
  "an.daysOfData": { ja: "データ蓄積", en: "days of data" },
  "an.kpiPeak": { ja: "ピーク同時視聴", en: "Peak viewers" },
  "an.kpiPeakSub": { ja: "期間中の最大", en: "Max in period" },
  "an.kpiHours": { ja: "延べ配信時間", en: "Stream hours" },
  "an.kpiHoursSub": { ja: "配信×時間", en: "streams × hours" },
  "an.kpiChannels": { ja: "配信したch", en: "Active channels" },
  "an.kpiChannelsSub": { ja: "期間内", en: "in period" },
  "an.kpiRecord": { ja: "最高視聴の配信", en: "Top stream" },
  "an.highlights": { ja: "配信ハイライト（最高視聴）", en: "Stream highlights (most watched)" },
  "an.highlightsDesc": {
    ja: "期間内でいちばん見られた配信の記録。ランクや大会の熱い瞬間が並びます。",
    en: "The most-watched streams in the period — ranked play and tournament moments.",
  },
  "an.highlightsEmpty": {
    ja: "この期間の配信記録はまだありません。",
    en: "No stream records for this period yet.",
  },
  "an.highlightsLinkNote": {
    ja: "リンク先：YouTubeは配信アーカイブ動画、Twitchはチャンネルの動画一覧（アーカイブは配信者の設定・保存期間により無い場合があります）。",
    en: "Links: YouTube opens the stream video; Twitch opens the channel's videos tab (VODs may be unavailable depending on the streamer's settings).",
  },
  "an.showAll": { ja: "すべて表示", en: "Show all" },
  "an.showLess": { ja: "閉じる", en: "Show less" },
  "an.untitled": { ja: "（無題）", en: "(untitled)" },
  "an.activity": { ja: "コミュニティの盛り上がり（日別）", en: "Community activity (daily)" },
  "an.activityDesc": {
    ja: "同時視聴者数の推移（日別のピーク／平均）。アップデートや大会の日ほど跳ねます。",
    en: "Daily peak / average concurrent viewers. Spikes on update and tournament days.",
  },
  "an.chartPeak": { ja: "ピーク同時視聴", en: "Peak viewers" },
  "an.chartAvg": { ja: "平均同時視聴", en: "Avg viewers" },
  "an.heatmap": { ja: "配信の時間帯ヒートマップ", en: "Streaming hours heatmap" },
  "an.heatmapDesc": {
    ja: "曜日 × 時間（日本時間）ごとの平均同時配信数。濃いほど配信が多い時間帯です。",
    en: "Average number of concurrent streams by day of week × hour (JST). Darker = more streams.",
  },
  "an.less": { ja: "少", en: "Less" },
  "an.more": { ja: "多", en: "More" },
  "an.primeSub": {
    ja: "いちばん配信が重なりやすい時間帯です（日本時間）。",
    en: "The hours when the most streams overlap (Japan time).",
  },
  "an.chMap": { ja: "配信者の時間帯マップ", en: "Streamer schedule map" },
  "an.chMapDesc": {
    ja: "よく配信している上位chが、どの時間帯（日本時間）に配信していることが多いか。濃いほどその時間の配信時間が長め。右は曜日ごとの配信量と、特に多い連続3時間帯。",
    en: "When the most active channels usually stream (JST). Darker = more hours streamed in that slot. Right: hours by day of week, and their busiest 3-hour window.",
  },
  "an.dowHeader": { ja: "曜日", en: "Day" },
  "an.chMapBestTitle": {
    ja: "期間内でもっとも配信が多い連続3時間帯",
    en: "Busiest consecutive 3-hour window in the period",
  },
  "an.leaderboard": { ja: "配信者ランキング（盛り上がり順）", en: "Streamer leaderboard (by watch time)" },
  "an.leaderboardDesc": {
    ja: "延べ視聴時間（同時視聴×時間の合計）で順位付け。YouTube / Twitch の収集頻度差はならして公平に比較しています。",
    en: "Ranked by viewer-hours (concurrent viewers × hours). YouTube / Twitch sampling differences are normalized for fairness.",
  },
  "an.viewerHours": { ja: "視聴h", en: "viewer-h" },
  "an.noDataYet": { ja: "まだデータがありません。", en: "No data yet." },
  "an.newcomers": { ja: "新規参入ch（初観測が最近）", en: "New channels (first seen recently)" },
  "an.newcomersEmpty": { ja: "直近の新規参入はありません。", en: "No new channels recently." },
  "an.firstSeen": { ja: "初観測", en: "First seen" },
  "an.growth": { ja: "登録者の伸び（YouTube・期間内）", en: "Subscriber growth (YouTube, in period)" },
  "an.growthDesc": {
    ja: "期間の最古→最新の登録者数の差。登録者数は3桁単位に丸められています。",
    en: "Change from the oldest to the latest subscriber count in the period. Counts are rounded to 3 significant digits.",
  },
  "an.thChannel": { ja: "チャンネル", en: "Channel" },
  "an.thSubs": { ja: "登録者", en: "Subscribers" },
  "an.thDelta": { ja: "増加", en: "Gain" },
  "an.thGrowth": { ja: "伸び率", en: "Growth" },
  "an.footer": {
    ja: "集計は保存済みデータのみを用い、閲覧時に外部APIは呼び出しません。",
    en: "Aggregations use stored data only; no external APIs are called while viewing.",
  },

  // テーマ切替
  "theme.toLight": { ja: "ライトテーマに切り替え", en: "Switch to light theme" },
  "theme.toDark": { ja: "ダークテーマに切り替え", en: "Switch to dark theme" },
} satisfies Record<string, Entry>;

export type DictKey = keyof typeof DICT;

export function tr(lang: Lang, key: DictKey): string {
  return DICT[key][lang];
}

// 日時系フォーマットで使うIntlロケール
export function intlLocale(lang: Lang): string {
  return lang === "en" ? "en-US" : "ja-JP";
}
