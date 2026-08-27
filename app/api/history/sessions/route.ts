import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { isGameId } from "@/lib/games";

export const dynamic = "force-dynamic";

// 配信タイムライン用の配信セッション（開始/終了/ピーク）を返す。DB側(stream_sessions)で集約済み。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hours = Math.min(parseInt(searchParams.get("hours") ?? "24", 10) || 24, 24 * 30);
  const gRaw = searchParams.get("game");
  const game = isGameId(gRaw) ? gRaw : null;

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("stream_sessions", { p_hours: hours, p_game: game });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sessions = (
    (data ?? []) as {
      platform: "youtube" | "twitch";
      channel_id: string;
      channel_name: string;
      game: string | null;
      session_start: string;
      session_end: string;
      peak: number;
      avg_viewers: number;
    }[]
  ).map((r) => ({
    platform: r.platform,
    channel_id: r.channel_id,
    channel_name: r.channel_name,
    // タイムラインの帯をタイトル別に色分けするため（判別前の古い行は null）
    game: isGameId(r.game) ? r.game : null,
    start: new Date(r.session_start).getTime(),
    end: new Date(r.session_end).getTime(),
    peak: r.peak,
    avg: r.avg_viewers,
  }));
  return NextResponse.json({ hours, now: Date.now(), sessions });
}
