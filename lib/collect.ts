import { createServiceClient } from "@/lib/supabase";
import { fetchYouTubeLive } from "@/lib/youtube";
import { fetchTwitchLive } from "@/lib/twitch";
import type { LiveStream, StreamSnapshot } from "@/lib/types";

export interface CollectResult {
  ok: boolean;
  captured_at: string;
  youtube: number;
  twitch: number;
  error?: string;
}

// 配信中データを取得して Supabase に保存する本体処理。
// Vercel Cron（/api/cron/collect）と 管理画面の手動収集（/api/admin/collect）の
// 両方から呼ばれる。認証はそれぞれの呼び出し側で行う。
export async function runCollect(): Promise<CollectResult> {
  const ytKey = process.env.YT_API_KEY;
  const twId = process.env.TWITCH_CLIENT_ID;
  const twSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!ytKey || !twId || !twSecret) {
    throw new Error("APIキーが未設定です");
  }

  const capturedAt = new Date().toISOString();
  let yt: LiveStream[] = [];
  let tw: LiveStream[] = [];

  const results = await Promise.allSettled([
    fetchYouTubeLive(ytKey),
    fetchTwitchLive(twId, twSecret),
  ]);
  if (results[0].status === "fulfilled") yt = results[0].value;
  else console.error("[collect] YouTube失敗:", results[0].reason);
  if (results[1].status === "fulfilled") tw = results[1].value;
  else console.error("[collect] Twitch失敗:", results[1].reason);

  const all = [...yt, ...tw];
  const supabase = createServiceClient();

  // 取得を実行した事実を毎回1行記録（0件でも）。これが「最新取得時点」の基準になり、
  // 誰も配信していない回は current_streams が正しく空になる。
  const { error: capErr } = await supabase
    .from("captures")
    .insert({ captured_at: capturedAt, youtube: yt.length, twitch: tw.length });
  if (capErr) {
    console.error("[collect] captures insert失敗:", capErr);
    throw new Error(capErr.message);
  }

  // 配信が1件以上あるときだけ明細を保存
  if (all.length > 0) {
    const rows: StreamSnapshot[] = all.map((s) => ({
      captured_at: capturedAt,
      platform: s.platform,
      channel_id: s.channelId,
      channel_name: s.channelName,
      stream_id: s.streamId,
      title: s.title,
      viewers: s.viewers,
      language: s.language,
      url: s.url,
    }));

    const { error } = await supabase.from("stream_snapshots").insert(rows);
    if (error) {
      console.error("[collect] insert失敗:", error);
      throw new Error(error.message);
    }
  }

  return {
    ok: true,
    captured_at: capturedAt,
    youtube: yt.length,
    twitch: tw.length,
  };
}
