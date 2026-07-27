import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 期間(hours)に応じてバケット幅を決め、返す行数とegressを抑える。
// 返す行数の目安 = (期間 / バケット幅) × 上位チャンネル数(12)。
function bucketMinutesFor(hours: number): number {
  if (hours <= 6) return 10; // 6時間 → 10分（取得間隔と同等）
  if (hours <= 24) return 20; // 24時間 → 20分
  if (hours <= 72) return 60; // 3日 → 1時間
  if (hours <= 168) return 120; // 7日 → 2時間
  return 360; // 30日 → 6時間
}

// 直近N時間の視聴者数推移を返す。フロントのグラフ用。
// 生データ全取得ではなく、DB側(viewer_history)で時間バケット集計してから返す。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10) || 24, 24 * 30);
  const platform = searchParams.get("platform") === "youtube" ? "youtube" : "twitch";
  const bucketMin = bucketMinutesFor(hours);

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("viewer_history", {
    p_platform: platform,
    p_hours: hours,
    p_bucket_min: bucketMin,
    p_top: 12,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    hours,
    platform,
    bucket_min: bucketMin,
    points: data ?? [],
  });
}
