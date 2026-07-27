export type Platform = "youtube" | "twitch";

export interface StreamSnapshot {
  id?: number;
  captured_at: string;
  platform: Platform;
  channel_id: string;
  channel_name: string | null;
  stream_id: string | null;
  title: string | null;
  viewers: number | null;
  language: string | null;
  url: string | null;
}

/** 取得処理が返す、DBに入れる前の1配信ぶんのデータ */
export interface LiveStream {
  platform: Platform;
  channelId: string;
  channelName: string;
  streamId: string;
  title: string;
  viewers: number;
  language: string;
  url: string;
}
