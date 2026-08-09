import { NextResponse } from "next/server";
import { createPublicClient } from "@/lib/supabase";
import { currentJstHour, ytExpectedMin, TW_EXPECTED_MIN } from "@/lib/schedule";

// 外形監視（UptimeRobot等）用のヘルスチェック。認証不要・匿名キーの読み取りのみ。
// 収集(YouTube/Twitch)とエンリッチが止まっていたら 503 を返す。
export const dynamic = "force-dynamic";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function GET() {
  const supabase = createPublicClient();

  const [ytRes, twRes, enrichRes] = await Promise.all([
    supabase
      .from("captures")
      .select("captured_at")
      .eq("platform", "youtube")
      .order("captured_at", { ascending: false })
      .limit(1),
    supabase
      .from("captures")
      .select("captured_at")
      .eq("platform", "twitch")
      .order("captured_at", { ascending: false })
      .limit(1),
    supabase
      .from("channel_stats_daily")
      .select("day")
      .order("day", { ascending: false })
      .limit(1),
  ]);

  const checks: Check[] = [];

  // 収集: 最終収集からの経過が想定間隔×3（=2回連続スキップ相当）を超えたら異常。
  // 管理画面の停止警告と同じしきい値。
  function captureCheck(name: string, iso: string | undefined, expectedMin: number) {
    if (!iso) {
      checks.push({ name, ok: false, detail: "収集データがありません" });
      return;
    }
    const ageMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    checks.push({
      name,
      ok: ageMin <= expectedMin * 3,
      detail: `最終収集 ${ageMin}分前（想定間隔 ${expectedMin}分）`,
    });
  }
  captureCheck("collect-youtube", ytRes.data?.[0]?.captured_at, ytExpectedMin(currentJstHour()));
  captureCheck("collect-twitch", twRes.data?.[0]?.captured_at, TW_EXPECTED_MIN);

  // エンリッチ: 1日1回（JST17:30）。最新日がJSTの前日より古ければ1回以上飛んでいる。
  const latestDay = enrichRes.data?.[0]?.day as string | undefined;
  if (!latestDay) {
    checks.push({ name: "enrich", ok: false, detail: "エンリッチデータがありません" });
  } else {
    const jstToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
      new Date(),
    ); // "YYYY-MM-DD"
    const diffDays = Math.round(
      (new Date(jstToday).getTime() - new Date(latestDay).getTime()) / 86400000,
    );
    checks.push({
      name: "enrich",
      ok: diffDays <= 1,
      detail: `最新データ ${latestDay}（${diffDays}日前）`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
