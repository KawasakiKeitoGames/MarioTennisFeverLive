import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 配信者詳細ページ用。1chぶんの集計RPC＋エンリッチ情報（channels/channel_stats_daily）を
// サーバー側でまとめて返す。すべて保存済みデータ（外部APIは叩かない）。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const id = (searchParams.get("id") ?? "").slice(0, 200);
  const days = Math.min(parseInt(searchParams.get("days") ?? "30", 10) || 30, 90);

  if ((platform !== "youtube" && platform !== "twitch") || !id) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  const supabase = createPublicClient();

  const [stats, grid, recent, rank, channelRow, latestDaily] = await Promise.all([
    supabase.rpc("channel_stats", { p_platform: platform, p_channel_id: id, p_days: days }),
    supabase.rpc("channel_time_grid", { p_platform: platform, p_channel_id: id, p_days: days }),
    supabase.rpc("channel_recent_streams", { p_platform: platform, p_channel_id: id, p_limit: 10 }),
    // 延べ視聴順の順位（前の同じ長さの期間との比較つき）
    supabase.rpc("channel_rank", { p_channel_id: id, p_days: days }),
    // エンリッチ済みの基本情報（無ければnull。thumbnail/開設日など）
    supabase.from("channels").select("*").eq("channel_id", id).maybeSingle(),
    // 最新の登録者数（YouTubeのみ値が入る）
    supabase
      .from("channel_stats_daily")
      .select("day,subscriber_count,video_count")
      .eq("channel_id", id)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const firstError = stats.error || grid.error || recent.error;
  if (firstError) {
    console.error("[streamers/detail] rpc error:", firstError.message);
  }

  return NextResponse.json({
    platform,
    id,
    days,
    stats: stats.data?.[0] ?? null,
    grid: grid.data ?? [],
    recent: recent.data ?? [],
    rank: rank.data?.[0] ?? null,
    channel: channelRow.data ?? null,
    daily: latestDaily.data ?? null,
    error: firstError?.message ?? null,
  });
}
