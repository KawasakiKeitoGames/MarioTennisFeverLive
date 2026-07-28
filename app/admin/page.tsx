import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { Toolbar, DeleteSnapshotButton } from "./Actions";
import AnalyticsChart, { type DailyRow } from "./AnalyticsChart";

export const dynamic = "force-dynamic";

const PERIODS = [
  { label: "今日", days: 1 },
  { label: "7日間", days: 7 },
  { label: "30日間", days: 30 },
];

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("ja-JP");
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "たった今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  return `${h}時間${min % 60}分前`;
}

// サーバー(Vercel)はUTCで動くため、日本時間(JST)へ明示的に変換して表示する。
function dt(iso: string | null): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("month")}/${p("day")} ${p("hour")}:${p("minute")}`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
      <div className="text-2xl font-black tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

interface SnapshotRow {
  id: number;
  captured_at: string;
  platform: string;
  channel_name: string | null;
  channel_id: string;
  viewers: number | null;
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const days = [1, 7, 30].includes(Number(sp.days)) ? Number(sp.days) : 7;

  const supabase = createServiceClient();

  const [
    capturesRes,
    snapCountRes,
    summaryRes,
    viewDailyRes,
    clickDailyRes,
    topClickedRes,
    pathViewsRes,
    referrersRes,
    channelsRes,
    recentSnapsRes,
  ] = await Promise.all([
    supabase.from("captures").select("*").order("captured_at", { ascending: false }).limit(12),
    supabase.from("stream_snapshots").select("*", { count: "exact", head: true }),
    supabase.rpc("analytics_summary", { p_days: days }),
    supabase.rpc("events_daily", { p_days: days, p_type: "view" }),
    supabase.rpc("events_daily", { p_days: days, p_type: "click" }),
    supabase.rpc("top_clicked", { p_days: days, p_limit: 20 }),
    supabase.rpc("path_views", { p_days: days }),
    supabase.rpc("top_referrers", { p_days: days, p_limit: 15 }),
    supabase.rpc("channel_appearances", { p_limit: 30 }),
    supabase
      .from("stream_snapshots")
      .select("id,captured_at,platform,channel_name,channel_id,viewers")
      .order("captured_at", { ascending: false })
      .limit(20),
  ]);

  const captures = (capturesRes.data ?? []) as {
    captured_at: string;
    youtube: number;
    twitch: number;
  }[];
  const latest = captures[0] ?? null;
  const snapCount = snapCountRes.count ?? 0;

  const summary = (summaryRes.data?.[0] ?? { views: 0, clicks: 0, uniques: 0 }) as {
    views: number;
    clicks: number;
    uniques: number;
  };
  const ctr = summary.views > 0 ? (summary.clicks / summary.views) * 100 : 0;

  // 日別 view/click をマージしてグラフ用に整形
  const viewDaily = (viewDailyRes.data ?? []) as { day: string; count: number }[];
  const clickDaily = (clickDailyRes.data ?? []) as { day: string; count: number }[];
  // events_daily は既にJST日付("YYYY-MM-DD")を返すので、時刻変換せず文字列を整形する。
  const dayLabel = (ymd: string) => {
    const [, m, d] = ymd.split("-");
    return `${Number(m)}/${Number(d)}`;
  };
  const dailyMap = new Map<string, DailyRow>();
  for (const r of viewDaily) {
    dailyMap.set(r.day, { day: dayLabel(r.day), PV: r.count, クリック: 0 });
  }
  for (const r of clickDaily) {
    const existing = dailyMap.get(r.day);
    if (existing) existing.クリック = r.count;
    else dailyMap.set(r.day, { day: dayLabel(r.day), PV: 0, クリック: r.count });
  }
  const daily = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);

  const topClicked = (topClickedRes.data ?? []) as {
    channel_name: string;
    platform: string;
    clicks: number;
  }[];
  const pathViews = (pathViewsRes.data ?? []) as { path: string; count: number }[];
  const referrers = (referrersRes.data ?? []) as { referrer_host: string; count: number }[];
  const channels = (channelsRes.data ?? []) as {
    channel_name: string;
    platform: string;
    appearances: number;
    last_seen: string;
  }[];
  const recentSnaps = (recentSnapsRes.data ?? []) as SnapshotRow[];

  // 取得間隔（直近2件の差）と欠測の目安
  let intervalMin: number | null = null;
  if (captures.length >= 2) {
    intervalMin = Math.round(
      (new Date(captures[0].captured_at).getTime() - new Date(captures[1].captured_at).getTime()) /
        60000,
    );
  }
  const sinceLastMin = latest
    ? Math.floor((Date.now() - new Date(latest.captured_at).getTime()) / 60000)
    : null;
  // 時間帯ごとの想定取得間隔（JST 20:00〜翌1:00 のゴールデンは10分、他は20分）。
  const jstHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  ) % 24;
  const isGolden = jstHour >= 20 || jstHour < 1;
  const expectedInterval = isGolden ? 10 : 20;
  // 想定間隔の約3倍（＝2回連続で欠測）を超えたら「停止の可能性」と判断する。
  // これ以内の単発の遅延・スキップでは警告を出さない（誤検知防止）。
  const staleThreshold = expectedInterval * 3;
  const stale = sinceLastMin != null && sinceLastMin > staleThreshold;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">FEVER LIVE 管理</h1>
          <Link href="/" className="text-xs font-bold text-brand hover:underline">
            公開サイトを見る →
          </Link>
        </div>
      </div>

      <div className="mb-6">
        <Toolbar />
      </div>

      {/* 収集ステータス */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-black text-slate-700">収集ステータス</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="最終取得" value={relative(latest?.captured_at ?? null)} sub={dt(latest?.captured_at ?? null)} />
          <Stat
            label="最新回の配信数"
            value={latest ? `${latest.youtube + latest.twitch}` : "—"}
            sub={latest ? `YT ${latest.youtube} / Tw ${latest.twitch}` : undefined}
          />
          <Stat label="直近の取得間隔" value={intervalMin != null ? `${intervalMin}分` : "—"} />
          <Stat label="累計スナップショット" value={fmt(snapCount)} />
        </div>
        {stale && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
            ⚠️ 最終取得から{sinceLastMin}分経過しています。pg_cron が停止している可能性があります。
          </div>
        )}
      </section>

      {/* アクセス解析 */}
      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-700">アクセス解析</h2>
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <Link
                key={p.days}
                href={`/admin?days=${p.days}`}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                  days === p.days
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="ページ閲覧 (PV)" value={fmt(summary.views)} />
          <Stat label="ユニークビジター" value={fmt(summary.uniques)} />
          <Stat label="リンククリック" value={fmt(summary.clicks)} />
          <Stat label="クリック率" value={`${ctr.toFixed(1)}%`} />
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
          <div className="mb-1 px-1 text-xs font-bold text-slate-500">日別の推移</div>
          <AnalyticsChart data={daily} />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {/* 人気リンク */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 text-xs font-black text-slate-700">人気の配信リンク（クリック数）</div>
            {topClicked.length === 0 ? (
              <p className="text-xs text-slate-400">まだクリックがありません。</p>
            ) : (
              <ol className="space-y-1.5">
                {topClicked.map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-5 shrink-0 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        c.platform === "twitch" ? "bg-twitch" : "bg-youtube"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-slate-700">{c.channel_name}</span>
                    <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(c.clicks)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 流入元・パス別 */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-black text-slate-700">流入元（リファラ）</div>
              {referrers.length === 0 ? (
                <p className="text-xs text-slate-400">データなし。</p>
              ) : (
                <ul className="space-y-1">
                  {referrers.map((r, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-600">{r.referrer_host}</span>
                      <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(r.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-black text-slate-700">ページ別PV</div>
              {pathViews.length === 0 ? (
                <p className="text-xs text-slate-400">データなし。</p>
              ) : (
                <ul className="space-y-1">
                  {pathViews.map((p, i) => (
                    <li key={i} className="flex items-center justify-between text-sm">
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">{p.path}</span>
                      <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(p.count)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 直近captures */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-black text-slate-700">直近の取得履歴</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">取得時刻</th>
                <th className="px-4 py-2 font-medium tabular-nums">YouTube</th>
                <th className="px-4 py-2 font-medium tabular-nums">Twitch</th>
                <th className="px-4 py-2 font-medium tabular-nums">計</th>
              </tr>
            </thead>
            <tbody>
              {captures.map((c) => (
                <tr key={c.captured_at} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-slate-600">{dt(c.captured_at)}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-700">{c.youtube}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-700">{c.twitch}</td>
                  <td className="px-4 py-2 font-bold tabular-nums text-slate-900">{c.youtube + c.twitch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* チャンネル登場ランキング */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-black text-slate-700">観測チャンネル（登場回数）</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">チャンネル</th>
                <th className="px-4 py-2 font-medium">Pf</th>
                <th className="px-4 py-2 font-medium tabular-nums">登場</th>
                <th className="px-4 py-2 font-medium">最終観測</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-slate-700">{c.channel_name}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {c.platform === "twitch" ? "Twitch" : "YouTube"}
                  </td>
                  <td className="px-4 py-2 font-bold tabular-nums text-slate-900">{fmt(c.appearances)}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">{dt(c.last_seen)}</td>
                </tr>
              ))}
              {channels.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-slate-400">
                    まだデータがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 直近スナップショット（個別削除） */}
      <section className="mb-10">
        <h2 className="mb-2 text-sm font-black text-slate-700">直近スナップショット（個別削除）</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">取得時刻</th>
                <th className="px-4 py-2 font-medium">チャンネル</th>
                <th className="px-4 py-2 font-medium tabular-nums">視聴者</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {recentSnaps.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-xs text-slate-500">{dt(s.captured_at)}</td>
                  <td className="px-4 py-2 text-slate-700">{s.channel_name ?? s.channel_id}</td>
                  <td className="px-4 py-2 tabular-nums text-slate-700">{fmt(s.viewers)}</td>
                  <td className="px-4 py-2 text-right">
                    <DeleteSnapshotButton id={s.id} />
                  </td>
                </tr>
              ))}
              {recentSnaps.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-slate-400">
                    まだスナップショットがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mb-6 text-[11px] leading-relaxed text-slate-400">
        アクセス解析はIP・個人情報を保存していません（端末ローカルの匿名トークンで集計）。この画面は管理者専用です。
      </p>
    </main>
  );
}
