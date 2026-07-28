import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

// 30日より古いスナップショットを削除（schema.sql の prune_old_snapshots() を実行）。
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
