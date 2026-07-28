import { NextResponse } from "next/server";
import { runEnrich } from "@/lib/enrich";

// pg_cron から1日1回叩かれる（YouTubeクォータのリセット直後 = UTC 08:30 想定）。
// 監視チャンネルが多いとバッチが増えるため長めに。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // collect と同じ CRON_SECRET で認証。
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runEnrich();
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "enrich失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
