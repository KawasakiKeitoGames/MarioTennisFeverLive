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

// 1プラットフォーム分の収集結果を Supabase に保存する。
//   - captures に「そのPFで収集した事実」を1行記録（0件でも必ず入れる）。これが
//     current_streams（PF別の最新収集時点）の基準になる。
//   - 配信が1件以上あるときだけ stream_snapshots に明細を保存する。
async function saveCapture(
  platform: "youtube" | "twitch",
  streams: LiveStream[],
): Promise<string> {
  const capturedAt = new Date().toISOString();
  const supabase = createServiceClient();

  const { error: capErr } = await supabase
    .from("captures")
    .insert({ captured_at: capturedAt, platform, count: streams.length });
  if (capErr) {
    console.error(`[collect] captures insert失敗(${platform}):`, capErr);
    throw new Error(capErr.message);
  }

  if (streams.length > 0) {
    const rows: StreamSnapshot[] = streams.map((s) => ({
      captured_at: capturedAt,
      platform: s.platform,
      channel_id: s.channelId,
      channel_name: s.channelName,
      stream_id: s.streamId,
      title: s.title,
      viewers: s.viewers,
      language: s.language,
      url: s.url,
      orientation: s.orientation,
    }));
    const { error } = await supabase.from("stream_snapshots").insert(rows);
    if (error) {
      console.error(`[collect] snapshot insert失敗(${platform}):`, error);
      throw new Error(error.message);
    }
  }

  return capturedAt;
}

// YouTube だけを収集して保存する（YouTube API のクォータに合わせた時間帯別スケジュールで実行）。
export async function runCollectYouTube(): Promise<CollectResult> {
  const ytKey = process.env.YT_API_KEY;
  if (!ytKey) throw new Error("APIキーが未設定です");

  const yt = await fetchYouTubeLive(ytKey);
  const capturedAt = await saveCapture("youtube", yt);
  return { ok: true, captured_at: capturedAt, youtube: yt.length, twitch: 0 };
}

// Twitch だけを収集して保存する（Twitch はクォータが緩いため短間隔で実行できる）。
export async function runCollectTwitch(): Promise<CollectResult> {
  const twId = process.env.TWITCH_CLIENT_ID;
  const twSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!twId || !twSecret) throw new Error("APIキーが未設定です");

  const tw = await fetchTwitchLive(twId, twSecret);
  const capturedAt = await saveCapture("twitch", tw);
  return { ok: true, captured_at: capturedAt, youtube: 0, twitch: tw.length };
}

// 両プラットフォームをまとめて収集する（管理画面の手動収集ボタン用）。
// PFごとに独立した captures 行を書くため、各PFの captured_at は数ミリ秒ずれる。
export async function runCollect(): Promise<CollectResult> {
  const results = await Promise.allSettled([runCollectYouTube(), runCollectTwitch()]);

  let youtube = 0;
  let twitch = 0;
  let capturedAt = new Date().toISOString();
  const errors: string[] = [];

  if (results[0].status === "fulfilled") {
    youtube = results[0].value.youtube;
    capturedAt = results[0].value.captured_at;
  } else {
    console.error("[collect] YouTube失敗:", results[0].reason);
    errors.push("YouTube");
  }
  if (results[1].status === "fulfilled") {
    twitch = results[1].value.twitch;
    capturedAt = results[1].value.captured_at;
  } else {
    console.error("[collect] Twitch失敗:", results[1].reason);
    errors.push("Twitch");
  }

  return {
    ok: errors.length < 2,
    captured_at: capturedAt,
    youtube,
    twitch,
    error: errors.length ? `${errors.join("/")}の取得に失敗` : undefined,
  };
}
