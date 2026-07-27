import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 現在配信中の一覧を返す（current_streams ビューから）。
// ユーザーのアクセスでは外部APIを一切叩かず、Supabaseのキャッシュ済みデータのみ返す。
export async function GET() {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("current_streams")
    .select("*");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 最新取得時刻は latest_capture から取る（0件の回でも正しい時刻を返すため）。
  const { data: lc } = await supabase
    .from("latest_capture")
    .select("captured_at")
    .maybeSingle();

  const capturedAt = lc?.captured_at ?? data?.[0]?.captured_at ?? null;
  const youtube = (data ?? []).filter((r) => r.platform === "youtube");
  const twitch = (data ?? []).filter((r) => r.platform === "twitch");

  return NextResponse.json({
    captured_at: capturedAt,
    youtube,
    twitch,
  });
}
