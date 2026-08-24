import type { GameId } from "./games";

export type Platform = "youtube" | "twitch";

export type ViewerTrend = "up" | "flat" | "down";

export interface StreamSnapshot {
  id?: number;
  captured_at: string;
  platform: Platform;
  game: GameId;
  channel_id: string;
  channel_name: string | null;
  stream_id: string | null;
  title: string | null;
  viewers: number | null;
  language: string | null;
  url: string | null;
  // 配信の開始時刻（Twitch APIの started_at をそのまま保存。YouTubeは未取得のためnull）。
  // 下の started_at（検知ベースの推定値）と違い、こちらは配信者側の実際の開始時刻。
  stream_started_at?: string | null;
  // バッジ用（current_stream_badges から /api/streams で合流させる。任意）
  started_at?: string | null; // 現在の配信セッションを最初に検知した時刻
  streak_days?: number | null; // 連続配信日数（JST）
  trend?: ViewerTrend | null; // 直近の同時視聴者数の傾向
}

/** 取得処理が返す、DBに入れる前の1配信ぶんのデータ */
export interface LiveStream {
  platform: Platform;
  game: GameId;
  channelId: string;
  channelName: string;
  streamId: string;
  startedAt?: string | null; // 配信開始時刻（Twitchのみ取得できる）
  title: string;
  viewers: number;
  language: string;
  url: string;
}
