import { NextResponse } from "next/server";

// ログイン済みかどうかの判定用。middleware が /api/admin/* を保護しているため、
// 有効なセッションCookieが無ければ 401 になり、ここには到達しない。
// 公開サイトはこの結果が 200 のときだけ管理ページへのボタンを表示する。
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true });
}
