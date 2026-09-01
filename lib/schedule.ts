// YouTube収集の時間帯別スケジュール（JST）。アプリ内の唯一の定義。
// 注意: Supabase pg_cron の6ジョブ（mtf-collect-golden/evening/prime/noon/daytime/latenight）と一致必須。
// 時間帯を変更するときは cron.schedule 側も同時に更新すること。
// 2026-08-19 直近3週間の実測（時間帯別の平均配信数）に基づき再配分:
//   ピークは21〜23時(3.7〜4.5配信)・深夜1〜4時(0.7〜1.6)は18〜19時(0.4〜0.6)より多い・
//   日中は0.26以下 → ピーク5分・深夜20分に強化、日中60分・20時台10分・お昼15分に緩和。
//   ※日中60分化に伴い、セッション分割のギャップ閾値はYouTubeのみ70分
//     （channel_recent_streams / channel_kpi_ranks / stream_sessions。20260819_schedule_tuning.sql）
export interface ScheduleBand {
  range: string; // 表示用の時間帯ラベル
  every: number; // 取得間隔（分）
  count: number; // この帯の1日の収集回数
  hours: number[]; // この帯に属するJSTの時（0〜23）
}

export const YT_SCHEDULE: ScheduleBand[] = [
  { range: "21:00〜翌1:00（ピーク）", every: 5, count: 48, hours: [21, 22, 23, 0] },
  { range: "20:00〜21:00", every: 10, count: 6, hours: [20] },
  { range: "18:00〜20:00", every: 15, count: 8, hours: [18, 19] },
  { range: "13:00〜18:00", every: 60, count: 5, hours: [13, 14, 15, 16, 17] },
  { range: "12:00〜13:00（お昼）", every: 15, count: 4, hours: [12] },
  { range: "5:00〜12:00", every: 60, count: 7, hours: [5, 6, 7, 8, 9, 10, 11] },
  { range: "1:00〜5:00（深夜）", every: 20, count: 12, hours: [1, 2, 3, 4] },
];

export const YT_DAILY_CAPTURES = YT_SCHEDULE.reduce((s, b) => s + b.count, 0);
export const YT_UNITS_PER_CAPTURE = 102; // search.list 1ページ(100) + videos.list(1) + 取りこぼし補完のvideos.list(0〜2)
export const YT_DAILY_QUOTA = 10000; // YouTube Data API の1日上限
export const TW_EXPECTED_MIN = 2; // Twitch は終日2分間隔（mtf-collect-twitch）

export function currentJstHour(): number {
  return (
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        hour12: false,
      }).format(new Date()),
    ) % 24
  );
}

export function ytExpectedMin(jstHour: number): number {
  return YT_SCHEDULE.find((b) => b.hours.includes(jstHour))?.every ?? 30;
}

// JSTの「今日0:00」をUTCのDateで返す（当日分の集計用）
export function jstTodayStartUtc(): Date {
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(
    Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - 9 * 3600 * 1000,
  );
}
