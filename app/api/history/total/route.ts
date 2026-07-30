import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 期間に応じてバケット幅を決め、返す行数(=egress)を一定に抑える。
function bucketMinutesFor(hours: number): number {
  if (hours <= 6) return 10;
  if (hours <= 24) return 20;
  if (hours <= 72) return 60;
  if (hours <= 168) return 180;
  return 720;
}

// 総同時視聴者数の推移（合算/PF別）を返す。DB側(viewer_total_series)で as-of 集計済み。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10) || 24, 24 * 30);
  const pf = searchParams.get("platform");
  const platform = pf === "youtube" || pf === "twitch" ? pf : null; // null=合算
  const bucketMin = bucketMinutesFor(hours);

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("viewer_total_series", {
    p_hours: hours,
    p_bucket_min: bucketMin,
    p_platform: platform,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const points = ((data ?? []) as { t: string; total: number }[]).map((r) => ({
    t: new Date(r.t).getTime(),
    total: r.total,
  }));
  return NextResponse.json({ hours, platform, bucket_min: bucketMin, now: Date.now(), points });
}
