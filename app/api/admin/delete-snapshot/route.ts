import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// スナップショットを個別削除（不正/重複データの手動除去用）。
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let id: unknown;
  try {
    const body = await request.json();
    id = body?.id;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("stream_snapshots").delete().eq("id", numId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "削除失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
