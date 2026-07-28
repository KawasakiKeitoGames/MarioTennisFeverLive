import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// 90日より古いデータ（スナップショット・取得履歴）を削除（prune_old_snapshots() を実行）。
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("prune_old_snapshots");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "prune失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
