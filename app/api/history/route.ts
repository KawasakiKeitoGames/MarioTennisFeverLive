import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { isGameId } from "@/lib/games";

export const dynamic = "force-dynamic";

// 期間(hours)に応じてバケット幅を決め、返す行数とegressを抑える。
// 長期間は粗いバケットに“集計”して、線のノイズを減らし傾向を読みやすくする。
// 返す行数の目安 = (期間 / バケット幅) × 上位チャンネル数(12)。
function bucketMinutesFor(hours: number): number {
  if (hours <= 6) return 10; // 6時間 → 10分（取得間隔と同等）
  if (hours <= 24) return 20; // 24時間 → 20分
  if (hours <= 72) return 120; // 3日 → 2時間に集計
  if (hours <= 168) return 360; // 7日 → 6時間に集計
  return 1440; // 30日 → 1日に集計（日次ピーク）
}

// 直近N時間の視聴者数推移を返す。フロントのグラフ用。
// 生データ全取得ではなく、DB側(viewer_history)で時間バケット集計してから返す。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10) || 24, 24 * 30);
  const platform = searchParams.get("platform") === "twitch" ? "twitch" : "youtube";
  const gRaw = searchParams.get("game");
  const game = isGameId(gRaw) ? gRaw : null;
  const bucketMin = bucketMinutesFor(hours);

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("viewer_history", {
    p_platform: platform,
    p_hours: hours,
    p_bucket_min: bucketMin,
    p_top: 12,
    p_game: game,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    hours,
    platform,
    game,
    bucket_min: bucketMin,
    // クライアントが「今から直近N時間」の固定軸を描けるよう、サーバ時刻の窓を返す。
    now: Date.now(),
    points: data ?? [],
  });
}
