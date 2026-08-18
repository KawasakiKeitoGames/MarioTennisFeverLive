import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 配信者検索。q が空のときは「最近配信したch」を返す（既定表示用）。
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("channel_search", {
    p_q: q || null,
    p_limit: 30,
  });

  if (error) {
    console.error("[streamers/search] rpc error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ q, results: data ?? [] });
}
