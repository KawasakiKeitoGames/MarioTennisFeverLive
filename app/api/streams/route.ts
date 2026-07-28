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

  // バッジ用の集計（連続配信日数・配信開始検知時刻・視聴者トレンド）を合流させる。
  // 集計に失敗してもバッジ無しで一覧は返す（badges を null 扱いにするだけ）。
  const { data: badges, error: badgeErr } = await supabase.rpc("current_stream_badges");
  if (badgeErr) console.error("[streams] current_stream_badges失敗:", badgeErr.message);
  const badgeMap = new Map<
    string,
    { started_at: string | null; streak_days: number | null; trend: string | null }
  >();
  for (const b of badges ?? []) {
    badgeMap.set(`${b.platform}:${b.channel_id}`, {
      started_at: b.started_at ?? null,
      streak_days: b.streak_days ?? null,
      trend: b.trend ?? null,
    });
  }
  const withBadges = (rows: typeof data) =>
    (rows ?? []).map((r) => ({ ...r, ...(badgeMap.get(`${r.platform}:${r.channel_id}`) ?? {}) }));

  const capturedAt = lc?.captured_at ?? data?.[0]?.captured_at ?? null;
  const youtube = withBadges((data ?? []).filter((r) => r.platform === "youtube"));
  const twitch = withBadges((data ?? []).filter((r) => r.platform === "twitch"));

  return NextResponse.json({
    captured_at: capturedAt,
    youtube,
    twitch,
  });
}
