import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 文字列を安全な長さに丸める（想定外の巨大入力を弾く）
function clamp(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

// 公開エンドポイント。匿名から呼ばれ、service_role で events に1行だけ記録する。
// 受理フィールドは限定し、IP/User-Agent など個人情報は保存しない。
// 国はVercelが付与する x-vercel-ip-country ヘッダー（2文字コード）のみ保存し、IPは保存しない。
export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type = payload.type === "click" ? "click" : payload.type === "view" ? "view" : null;
  if (!type) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }

  const row = {
    type,
    path: clamp(payload.path, 200),
    referrer_host: clamp(payload.referrer_host, 200),
    platform:
      payload.platform === "youtube" || payload.platform === "twitch"
        ? payload.platform
        : null,
    channel_id: type === "click" ? clamp(payload.channel_id, 200) : null,
    channel_name: type === "click" ? clamp(payload.channel_name, 300) : null,
    target_url: type === "click" ? clamp(payload.target_url, 500) : null,
    visitor: clamp(payload.visitor, 64),
    country: clamp(request.headers.get("x-vercel-ip-country"), 2)?.toUpperCase() ?? null,
  };

  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("events").insert(row);
    if (error) {
      console.error("[track] insert失敗:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } catch (e) {
    console.error("[track] 例外:", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
