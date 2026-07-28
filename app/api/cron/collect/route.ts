import { NextResponse } from "next/server";
import { runCollect } from "@/lib/collect";

// Vercel Cron / pg_cron から叩かれる。実行時間がかかるため長めに。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Cron 認証（CRON_SECRET を Authorization ヘッダで検証）
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runCollect();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "collect失敗";
    const status = msg === "APIキーが未設定です" ? 500 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
