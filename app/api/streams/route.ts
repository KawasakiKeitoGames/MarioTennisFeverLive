import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { isGameId } from "@/lib/games";

export const dynamic = "force-dynamic";

// 現在配信中の一覧を返す（current_streams ビューから）。
// ?game=fever|aces|mt64 でタイトル絞り込み（未指定=全タイトル）。
// ユーザーのアクセスでは外部APIを一切叩かず、Supabaseのキャッシュ済みデータのみ返す。
export async function GET(request: Request) {
  const gRaw = new URL(request.url).searchParams.get("game");
  const game = isGameId(gRaw) ? gRaw : null;

  const supabase = createPublicClient();
  let query = supabase.from("current_streams").select("*");
  if (game) query = query.eq("game", game);
  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 最新取得時刻は latest_capture から取る（0件の回でも正しい時刻を返すため）。
  const { data: lc } = await supabase
    .from("latest_capture")
    .select("captured_at")
    .maybeSingle();

  // PF別の最新取得時刻。YouTube と Twitch は収集間隔が異なる（Twitchは短間隔）ため、
  // 画面で「いつ取得したか」を別々に表示できるよう個別に返す。
  const { data: lcp } = await supabase
    .from("latest_capture_by_platform")
    .select("platform, captured_at");
  const capByPf = new Map<string, string>(
    (lcp ?? []).map((r) => [r.platform as string, r.captured_at as string]),
  );

  // 本日ピーク・前回比（▲▼）用の集計。1行返るだけなので egress は極小。
  const { data: stats, error: statsErr } = await supabase.rpc("today_viewer_stats", {
    p_game: game,
  });
  if (statsErr) console.error("[streams] today_viewer_stats失敗:", statsErr.message);
  const st = Array.isArray(stats) ? stats[0] : stats;

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
    captured_at_youtube: capByPf.get("youtube") ?? null,
    captured_at_twitch: capByPf.get("twitch") ?? null,
    previous_total: st?.previous_total ?? null,
    peak_viewers: st?.peak ?? null,
    peak_at: st?.peak_at ?? null,
    youtube,
    twitch,
  });
}
