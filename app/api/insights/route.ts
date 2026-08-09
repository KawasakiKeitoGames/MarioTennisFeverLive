import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 公開分析ページ用。複数の集計RPCをサーバー側でまとめて呼び、1レスポンスで返す。
// すべて DB 側で集計済み（追加の外部APIは叩かない）。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(parseInt(searchParams.get("days") ?? "30", 10) || 30, 90);
  const pRaw = searchParams.get("platform");
  const platform = pRaw === "youtube" || pRaw === "twitch" ? pRaw : null; // null=両PF合算

  const supabase = createPublicClient();

  const [headline, activity, heatmap, newCh, leaderboard, growth, topStreams, hourProfile] =
    await Promise.all([
      supabase.rpc("analytics_headline", { p_days: days, p_platform: platform }),
      supabase.rpc("daily_activity", { p_days: days, p_platform: platform }),
      supabase.rpc("hour_heatmap", { p_days: days, p_platform: platform }),
      supabase.rpc("new_channels", { p_days: Math.min(days, 30), p_limit: 30 }),
      supabase.rpc("channel_leaderboard", { p_days: days, p_limit: 20, p_platform: platform }),
      supabase.rpc("channel_growth", { p_days: days, p_limit: 20 }),
      supabase.rpc("top_streams", { p_days: days, p_limit: 6, p_platform: platform }),
      supabase.rpc("channel_hour_profile", { p_days: days, p_limit: 10, p_platform: platform }),
    ]);

  const firstError =
    headline.error ||
    activity.error ||
    heatmap.error ||
    newCh.error ||
    leaderboard.error ||
    growth.error ||
    topStreams.error ||
    hourProfile.error;
  if (firstError) {
    // エンリッチ系テーブル未作成でも、他パネルは返せるよう握りつぶさず明示する。
    console.error("[insights] rpc error:", firstError.message);
  }

  return NextResponse.json({
    days,
    platform,
    headline: headline.data?.[0] ?? null,
    activity: activity.data ?? [],
    heatmap: heatmap.data ?? [],
    new_channels: newCh.data ?? [],
    leaderboard: leaderboard.data ?? [],
    growth: growth.data ?? [],
    top_streams: topStreams.data ?? [],
    hour_profile: hourProfile.data ?? [],
    error: firstError?.message ?? null,
  });
}
