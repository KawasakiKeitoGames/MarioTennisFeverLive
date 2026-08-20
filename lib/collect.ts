import { createServiceClient } from "@/lib/supabase";
import {
  fetchYouTubeLive,
  fetchYouTubeLiveByIds,
  fetchChannelFeedEntries,
} from "@/lib/youtube";
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
      game: s.game,
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
      console.error(`[collect] snapshot insert失敗(${platform}):`, error);
      throw new Error(error.message);
    }
  }

  return capturedAt;
}

// --- 検索の取りこぼし補完 -------------------------------------------------
// YouTubeの search(eventType=live) は、配信が検索インデックスに載らないと
// 配信中ずっと1件も返さないことがある（2026-08-18 ゆあん / 2026-08-20 キリンで実例。
// 同時刻に他chは正常に取れているのでアプリ側の障害ではなくAPIの弱点）。
// そこで、過去に配信実績のあるチャンネルのRSSフィード（APIキー不要・クォータ消費0）
// から最近の動画IDを集め、検索で拾えなかったものだけ videos.list で
// ライブ判定して合流させる。判定が確定した動画（通常動画/終了済み/消滅）は
// yt_video_status に覚えておき、次回以降は問い合わせない＝定常状態では
// 追加消費はほぼ0〜1ユニット/回に収まる。
const FALLBACK_CHANNEL_DAYS = 30; // RSSを見に行くチャンネルの母集団（直近の配信実績）
const FALLBACK_FEED_DAYS = 7; // フィード内で候補にする動画の新しさ
const FALLBACK_MAX_CANDIDATES = 100; // videos.list 2ユニットぶんが上限（クォータ暴発の安全弁）

async function collectYouTubeFallback(
  apiKey: string,
  foundIds: Set<string>,
): Promise<LiveStream[]> {
  const supabase = createServiceClient();

  const { data: channels, error: chErr } = await supabase.rpc("active_channels", {
    p_days: FALLBACK_CHANNEL_DAYS,
  });
  if (chErr) {
    console.error("[collect] active_channels取得失敗:", chErr);
    return [];
  }
  const channelIds = ((channels ?? []) as Array<{ channel_id: string; platform: string }>)
    .filter((c) => c.platform === "youtube" && c.channel_id?.startsWith("UC"))
    .map((c) => c.channel_id);
  if (channelIds.length === 0) return [];

  const since = Date.now() - FALLBACK_FEED_DAYS * 86400_000;
  const entries = (await fetchChannelFeedEntries(channelIds))
    .filter((e) => !foundIds.has(e.videoId) && Date.parse(e.published) >= since)
    .sort((a, b) => b.published.localeCompare(a.published));
  if (entries.length === 0) return [];

  const byId = new Map(entries.map((e) => [e.videoId, e]));
  const ids = [...byId.keys()].slice(0, 300); // .in() のURL長が膨らみすぎない範囲
  const { data: known, error: knownErr } = await supabase
    .from("yt_video_status")
    .select("video_id,status")
    .in("video_id", ids);
  if (knownErr) {
    console.error("[collect] yt_video_status取得失敗:", knownErr);
    return [];
  }
  // live/upcoming は状況が変わりうるので毎回見る。それ以外は確定として除外。
  const settled = new Set(
    ((known ?? []) as Array<{ video_id: string; status: string }>)
      .filter((r) => r.status !== "live" && r.status !== "upcoming")
      .map((r) => r.video_id),
  );
  const candidates = ids.filter((id) => !settled.has(id)).slice(0, FALLBACK_MAX_CANDIDATES);
  if (candidates.length === 0) return [];

  const { live, statuses } = await fetchYouTubeLiveByIds(apiKey, candidates);

  const rows = [...statuses.entries()].map(([videoId, status]) => ({
    video_id: videoId,
    channel_id: byId.get(videoId)?.channelId ?? null,
    status,
    title: byId.get(videoId)?.title ?? null,
    checked_at: new Date().toISOString(),
  }));
  const { error: upErr } = await supabase.from("yt_video_status").upsert(rows);
  if (upErr) console.error("[collect] yt_video_status保存失敗:", upErr);

  if (live.length > 0) {
    console.warn(
      `[collect] 検索が取りこぼした配信を補完: ${live
        .map((s) => `${s.channelName}(${s.streamId})`)
        .join(", ")}`,
    );
  }
  return live;
}

// YouTube だけを収集して保存する（YouTube API のクォータに合わせた時間帯別スケジュールで実行）。
export async function runCollectYouTube(): Promise<CollectResult> {
  const ytKey = process.env.YT_API_KEY;
  if (!ytKey) throw new Error("APIキーが未設定です");

  const yt = await fetchYouTubeLive(ytKey);

  // 補完は best-effort。ここで落ちても検索ぶんの収集は必ず保存する。
  let extra: LiveStream[] = [];
  try {
    extra = await collectYouTubeFallback(ytKey, new Set(yt.map((s) => s.streamId)));
  } catch (e) {
    console.error("[collect] 取りこぼし補完に失敗:", e);
  }

  const all = [...yt, ...extra];
  const capturedAt = await saveCapture("youtube", all);
  return { ok: true, captured_at: capturedAt, youtube: all.length, twitch: 0 };
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
