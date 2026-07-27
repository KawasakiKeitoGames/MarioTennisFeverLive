import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 直近N時間の視聴者数推移を返す。フロントのグラフ用。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10) || 24, 24 * 14);

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("stream_snapshots")
    .select("captured_at, platform, channel_name, viewers")
    .gte("captured_at", since)
    .order("captured_at", { ascending: true })
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hours, points: data ?? [] });
}
