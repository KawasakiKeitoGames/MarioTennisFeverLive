import { NextResponse } from "next/server";
import { runCollect } from "@/lib/collect";

// 手動収集。middleware でセッション認証済みの管理者だけが到達する。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await runCollect();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "collect失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
