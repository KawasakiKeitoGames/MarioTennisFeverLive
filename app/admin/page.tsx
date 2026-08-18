import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import {
  YT_SCHEDULE,
  YT_DAILY_CAPTURES,
  YT_UNITS_PER_CAPTURE,
  YT_DAILY_QUOTA,
  TW_EXPECTED_MIN,
  currentJstHour,
  ytExpectedMin,
  jstTodayStartUtc,
} from "@/lib/schedule";
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

function dayMd(ymd: string): string {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 国コード(ISO 3166-1 alpha-2)→国旗絵文字。不明('??'等)は🌐。
function flagEmoji(cc: string): string {
  if (!/^[A-Z]{2}$/.test(cc)) return "🌐";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// countries jsonb（国コード→クリック数）を多い順の配列に。'??'（記録前・不明）は末尾。
function sortCountries(countries: Record<string, number> | null): [string, number][] {
  if (!countries) return [];
  return Object.entries(countries).sort((a, b) => {
    if (a[0] === "??") return 1;
    if (b[0] === "??") return -1;
    return b[1] - a[1];
  });
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

// --- 縦長になりがちなリストのコンパクト行（先頭N件＋<details>で残りを畳む） ---

function CapRows({ caps }: { caps: { captured_at: string; count: number }[] }) {
  return (
    <ul>
      {caps.map((c, i) => (
        <li
          key={`${c.captured_at}-${i}`}
          className="flex items-center justify-between border-b border-slate-50 py-[3px] text-xs last:border-0"
        >
          <span className="tabular-nums text-slate-600">{dt(c.captured_at)}</span>
          <span className="font-bold tabular-nums text-slate-900">{c.count}</span>
        </li>
      ))}
    </ul>
  );
}

function ChannelRows({
  rows,
}: {
  rows: { channel_name: string; platform: string; appearances: number; last_seen: string }[];
}) {
  return (
    <ul>
      {rows.map((c, i) => (
        <li
          key={i}
          className="flex items-center gap-2 border-b border-slate-50 py-1 text-xs last:border-0"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              c.platform === "twitch" ? "bg-twitch" : "bg-youtube"
            }`}
          />
          <span className="min-w-0 flex-1 truncate text-slate-700">{c.channel_name}</span>
          <span className="shrink-0 font-bold tabular-nums text-slate-900">
            {fmt(c.appearances)}
            <span className="ml-0.5 font-normal text-slate-400">h</span>
          </span>
          <span className="w-20 shrink-0 text-right tabular-nums text-slate-400">{dt(c.last_seen)}</span>
        </li>
      ))}
    </ul>
  );
}

function SnapRows({ rows }: { rows: SnapshotRow[] }) {
  return (
    <ul>
      {rows.map((s) => (
        <li
          key={s.id}
          className="flex items-center gap-2 border-b border-slate-50 py-[3px] text-xs last:border-0"
        >
          <span className="w-20 shrink-0 tabular-nums text-slate-400">{dt(s.captured_at)}</span>
          <span className="min-w-0 flex-1 truncate text-slate-700">
            {s.channel_name ?? s.channel_id}
          </span>
          <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(s.viewers)}</span>
          <span className="shrink-0">
            <DeleteSnapshotButton id={s.id} />
          </span>
        </li>
      ))}
    </ul>
  );
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
    ytCapsRes,
    twCapsRes,
    ytTodayRes,
    jobsRes,
    enrichDaysRes,
    snapCountRes,
    summaryRes,
    viewDailyRes,
    clickDailyRes,
    topClickedRes,
    clickCountriesRes,
    pathViewsRes,
    clicksByPathRes,
    referrersRes,
    channelsRes,
    recentSnapsRes,
  ] = await Promise.all([
    supabase
      .from("captures")
      .select("captured_at,platform,count")
      .eq("platform", "youtube")
      .order("captured_at", { ascending: false })
      .limit(20),
    supabase
      .from("captures")
      .select("captured_at,platform,count")
      .eq("platform", "twitch")
      .order("captured_at", { ascending: false })
      .limit(20),
    supabase
      .from("captures")
      .select("*", { count: "exact", head: true })
      .eq("platform", "youtube")
      .gte("captured_at", jstTodayStartUtc().toISOString()),
    supabase.rpc("admin_job_health"),
    supabase
      .from("channel_stats_daily")
      .select("day")
      .order("day", { ascending: false })
      .limit(300),
    supabase.from("stream_snapshots").select("*", { count: "exact", head: true }),
    supabase.rpc("analytics_summary", { p_days: days }),
    supabase.rpc("events_daily", { p_days: days, p_type: "view" }),
    supabase.rpc("events_daily", { p_days: days, p_type: "click" }),
    supabase.rpc("top_clicked", { p_days: days, p_limit: 20 }),
    supabase.rpc("click_countries", { p_days: days }),
    supabase.rpc("path_views", { p_days: days }),
    supabase.rpc("clicks_by_path", { p_days: days }),
    supabase.rpc("top_referrers", { p_days: days, p_limit: 15 }),
    supabase.rpc("channel_appearances", { p_limit: 30 }),
    supabase
      .from("stream_snapshots")
      .select("id,captured_at,platform,channel_name,channel_id,viewers")
      .order("captured_at", { ascending: false })
      .limit(20),
  ]);

  type CaptureRow = { captured_at: string; platform: string; count: number };
  const ytCaps = (ytCapsRes.data ?? []) as CaptureRow[];
  const twCaps = (twCapsRes.data ?? []) as CaptureRow[];
  const snapCount = snapCountRes.count ?? 0;

  // 本日(JST)のYouTube収集回数 → クォータ消費の目安
  const ytTodayCount = ytTodayRes.count ?? 0;
  const ytTodayUnits = ytTodayCount * YT_UNITS_PER_CAPTURE;

  // pg_cron ジョブ稼働状況（admin_job_health RPC）
  const jobs = (jobsRes.data ?? []) as {
    jobname: string;
    active: boolean;
    schedule: string;
    last_success: string | null;
    last_run: string | null;
    last_status: string | null;
    fails_24h: number;
  }[];

  // エンリッチの最新日とそのチャンネル数
  const enrichDays = (enrichDaysRes.data ?? []) as { day: string }[];
  const enrichLatestDay = enrichDays[0]?.day ?? null;
  const enrichLatestCount = enrichLatestDay
    ? enrichDays.filter((d) => d.day === enrichLatestDay).length
    : 0;

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
    countries: Record<string, number> | null;
  }[];
  const clickCountries = (clickCountriesRes.data ?? []) as { country: string; clicks: number }[];
  const pathViews = (pathViewsRes.data ?? []) as { path: string; count: number }[];
  const clicksByPath = (clicksByPathRes.data ?? []) as {
    path: string;
    clicks: number;
    kinds: Record<string, number> | null;
  }[];
  const clicksMap = new Map(clicksByPath.map((c) => [c.path, c]));
  const KIND_LABEL: Record<string, string> = {
    stream: "視聴",
    vod: "アーカイブ",
    channel: "チャンネル",
  };
  const referrers = (referrersRes.data ?? []) as { referrer_host: string; count: number }[];
  const channels = (channelsRes.data ?? []) as {
    channel_name: string;
    platform: string;
    appearances: number;
    last_seen: string;
  }[];
  const recentSnaps = (recentSnapsRes.data ?? []) as SnapshotRow[];

  // 現在のJST時刻（時）。YouTube の想定間隔は時間帯別（lib/schedule.ts が唯一の定義）。
  const jstHour = currentJstHour();
  const ytExpected = ytExpectedMin(jstHour);
  const twExpected = TW_EXPECTED_MIN;

  // PF別に「最新収集時刻・直近間隔・欠測判定」を計算する。
  // 欠測は想定間隔の約3倍（＝2回連続スキップ）を超えたら「停止の可能性」とする。
  function platformStatus(
    caps: { captured_at: string; count: number }[],
    expected: number,
  ) {
    const latest = caps[0] ?? null;
    const prev = caps[1] ?? null;
    const intervalMin =
      latest && prev
        ? Math.round(
            (new Date(latest.captured_at).getTime() - new Date(prev.captured_at).getTime()) / 60000,
          )
        : null;
    const sinceLastMin = latest
      ? Math.floor((Date.now() - new Date(latest.captured_at).getTime()) / 60000)
      : null;
    const stale = sinceLastMin != null && sinceLastMin > expected * 3;
    return { latest, intervalMin, sinceLastMin, stale, expected };
  }
  const ytStatus = platformStatus(ytCaps, ytExpected);
  const twStatus = platformStatus(twCaps, twExpected);

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
        <h2 className="mb-1 text-sm font-black text-slate-700">収集ステータス</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          「最終収集」は pg_cron ジョブが最後に動いた時刻です（配信0件の回も毎回記録されます）。
          YouTube と Twitch は別ジョブ・別間隔で収集しています。
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { key: "YouTube", st: ytStatus },
              { key: "Twitch", st: twStatus },
            ] as const
          ).map(({ key, st }) => (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-black text-slate-600">{key}</span>
                <span className="text-[10px] text-slate-400">想定間隔 {st.expected}分</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="最終収集" value={relative(st.latest?.captured_at ?? null)} sub={dt(st.latest?.captured_at ?? null)} />
                <Stat label="最新回の配信数" value={st.latest ? `${st.latest.count}` : "—"} />
                <Stat label="直近の間隔" value={st.intervalMin != null ? `${st.intervalMin}分` : "—"} />
              </div>
              {st.stale && (
                <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  ⚠️ 最終収集から{st.sinceLastMin}分経過（想定間隔{st.expected}分）。ジョブ停止の可能性があります。
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-3 gap-2.5">
          <Stat label="累計スナップショット" value={fmt(snapCount)} />
          <Stat
            label="本日のYTクォータ目安"
            value={`${fmt(ytTodayUnits)}`}
            sub={`/ ${fmt(YT_DAILY_QUOTA)} units（${ytTodayCount}回収集）`}
          />
          <Stat
            label="エンリッチ最新"
            value={enrichLatestDay ? dayMd(enrichLatestDay) : "—"}
            sub={enrichLatestDay ? `${enrichLatestCount}ch分` : "データなし"}
          />
        </div>
      </section>

      {/* pg_cron ジョブ稼働状況 */}
      <section className="mb-8">
        <h2 className="mb-1 text-sm font-black text-slate-700">ジョブ稼働状況（pg_cron）</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          収集・エンリッチ（登録者数など・毎日17:30）・掃除（毎日2:00）の全ジョブの実行結果です。
        </p>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">ジョブ</th>
                <th className="px-4 py-2 font-medium">最終成功</th>
                <th className="px-4 py-2 font-medium">直近の結果</th>
                <th className="px-4 py-2 font-medium tabular-nums">24h失敗</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => {
                const sinceSuccessH = j.last_success
                  ? (Date.now() - new Date(j.last_success).getTime()) / 3600000
                  : Infinity;
                // 最長間隔のジョブでも1日1回。26時間成功が無ければ停止扱い。
                const stale = sinceSuccessH > 26 || !j.active;
                const failed = j.last_status != null && j.last_status !== "succeeded";
                return (
                  <tr key={j.jobname} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-2 font-mono text-xs text-slate-700">
                      {j.jobname}
                      {!j.active && (
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                          無効
                        </span>
                      )}
                    </td>
                    <td className={`px-4 py-2 text-xs ${stale ? "font-bold text-amber-600" : "text-slate-600"}`}>
                      {relative(j.last_success)}
                      {stale && " ⚠️"}
                    </td>
                    <td className={`px-4 py-2 text-xs ${failed ? "font-bold text-red-600" : "text-slate-500"}`}>
                      {j.last_status === "succeeded" ? "成功" : (j.last_status ?? "—")}
                    </td>
                    <td className={`px-4 py-2 tabular-nums text-xs ${j.fails_24h > 0 ? "font-bold text-red-600" : "text-slate-500"}`}>
                      {j.fails_24h}
                    </td>
                  </tr>
                );
              })}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-slate-400">
                    ジョブ情報を取得できませんでした（admin_job_health RPC 未適用の可能性）。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
              <ol className="space-y-2">
                {topClicked.map((c, i) => {
                  const cc = sortCountries(c.countries);
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="w-5 shrink-0 pt-0.5 text-right text-xs font-bold text-slate-400">{i + 1}</span>
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          c.platform === "twitch" ? "bg-twitch" : "bg-youtube"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-slate-700">{c.channel_name}</span>
                        {cc.length > 0 && (
                          <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                            {cc.slice(0, 5).map(([code, n]) => (
                              <span key={code}>
                                {flagEmoji(code)} {code === "??" ? "不明" : code}
                                <span className="ml-0.5 tabular-nums">{n}</span>
                              </span>
                            ))}
                            {cc.length > 5 && <span>ほか{cc.length - 5}カ国</span>}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(c.clicks)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* 流入元・国別・パス別 */}
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-black text-slate-700">クリックの国別内訳</div>
              {clickCountries.length === 0 ? (
                <p className="text-xs text-slate-400">まだクリックがありません。</p>
              ) : (
                <ul className="space-y-1">
                  {clickCountries.map((r) => (
                    <li key={r.country} className="flex items-center justify-between text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-600">
                        {flagEmoji(r.country)} {r.country === "??" ? "不明（記録開始前など）" : r.country}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums text-slate-900">{fmt(r.clicks)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                国はVercelのIP推定ヘッダー由来（国コードのみ保存・IPは保存しません）。機能追加前のクリックは「不明」になります。
              </p>
            </div>
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
              <div className="mb-2 text-xs font-black text-slate-700">ページ別PV・クリック率</div>
              {pathViews.length === 0 ? (
                <p className="text-xs text-slate-400">データなし。</p>
              ) : (
                <ul className="space-y-1.5">
                  {pathViews.map((p, i) => {
                    const c = clicksMap.get(p.path);
                    const ctr = c && p.count > 0 ? (c.clicks / p.count) * 100 : null;
                    const kinds = c?.kinds
                      ? Object.entries(c.kinds)
                          .sort((a, b) => b[1] - a[1])
                          .map(([k, n]) => `${KIND_LABEL[k] ?? k}${n}`)
                          .join("・")
                      : null;
                    return (
                      <li key={i} className="text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-600">{p.path}</span>
                          <span className="shrink-0 tabular-nums text-xs text-slate-500">
                            PV <span className="font-bold text-slate-900">{fmt(p.count)}</span>
                          </span>
                          <span className="w-24 shrink-0 text-right tabular-nums text-xs text-slate-500">
                            {c ? (
                              <>
                                クリック <span className="font-bold text-slate-900">{fmt(c.clicks)}</span>
                                <span className="ml-1 text-brand">({ctr?.toFixed(0)}%)</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                        {kinds && <div className="text-[10px] text-slate-400">内訳: {kinds}</div>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                クリック率＝そのページからの外部リンククリック÷PV。内訳: 視聴=ライブ視聴リンク・アーカイブ=動画/VOD・チャンネル=チャンネルページ。/streamers/* は配信者ページ（全chまとめ）。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 直近captures（PF別。Twitchは2分間隔で流れが速いため混ぜると YouTube が埋もれる） */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-black text-slate-700">直近の取得履歴</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { key: "YouTube", caps: ytCaps },
              { key: "Twitch", caps: twCaps },
            ] as const
          ).map(({ key, caps }) => (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-black text-slate-600">{key}</span>
                <span>取得時刻・配信数</span>
              </div>
              {caps.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-400">まだ取得がありません。</p>
              ) : (
                <>
                  <CapRows caps={caps.slice(0, 6)} />
                  {caps.length > 6 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer list-none rounded-lg bg-slate-50 px-2 py-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600">
                        ほか{caps.length - 6}件を表示
                      </summary>
                      <CapRows caps={caps.slice(6)} />
                    </details>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* チャンネル登場ランキング */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-black text-slate-700">観測チャンネル（配信時間・h／PF公平）</h2>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {channels.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">まだデータがありません。</p>
          ) : (
            <>
              <ChannelRows rows={channels.slice(0, 10)} />
              {channels.length > 10 && (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none rounded-lg bg-slate-50 px-2 py-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600">
                    ほか{channels.length - 10}件を表示
                  </summary>
                  <ChannelRows rows={channels.slice(10)} />
                </details>
              )}
            </>
          )}
        </div>
      </section>

      {/* 直近スナップショット（個別削除） */}
      <section className="mb-10">
        <h2 className="mb-2 text-sm font-black text-slate-700">直近スナップショット（個別削除）</h2>
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {recentSnaps.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-400">まだスナップショットがありません。</p>
          ) : (
            <>
              <SnapRows rows={recentSnaps.slice(0, 8)} />
              {recentSnaps.length > 8 && (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none rounded-lg bg-slate-50 px-2 py-1 text-center text-[11px] font-bold text-slate-400 hover:text-slate-600">
                    ほか{recentSnaps.length - 8}件を表示
                  </summary>
                  <SnapRows rows={recentSnaps.slice(8)} />
                </details>
              )}
            </>
          )}
        </div>
      </section>

      {/* 収集スケジュール（時間帯別の取得間隔） */}
      <section className="mb-10">
        <h2 className="mb-1 text-sm font-black text-slate-700">収集スケジュール（時間帯別の取得間隔）</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          下表は <span className="font-bold">YouTube</span> の間隔です。
          <span className="font-bold">Twitch</span> は日次上限が無いため、時間帯によらず
          <span className="font-bold">終日2分ごと</span>（別ジョブ）で収集しています。
        </p>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-4 py-2 font-medium">時間帯（日本時間）</th>
                <th className="px-4 py-2 font-medium">取得間隔</th>
                <th className="px-4 py-2 font-medium tabular-nums">1日の回数</th>
              </tr>
            </thead>
            <tbody>
              {YT_SCHEDULE.map((b) => {
                // 「いまここ」は間隔ではなく現在の時間帯（JST時）で判定する。
                const active = b.hours.includes(jstHour);
                return (
                  <tr
                    key={b.range}
                    className={`border-b border-slate-50 last:border-0 ${active ? "bg-brand/10" : ""}`}
                  >
                    <td className="px-4 py-2 text-slate-700">
                      {b.range}
                      {active && (
                        <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold text-white">
                          いまここ
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-bold tabular-nums text-slate-900">{b.every}分ごと</td>
                    <td className="px-4 py-2 tabular-nums text-slate-500">{b.count}回</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-100 text-xs text-slate-500">
                <td className="px-4 py-2 font-bold">合計</td>
                <td className="px-4 py-2"></td>
                <td className="px-4 py-2 font-bold tabular-nums">{YT_DAILY_CAPTURES}回/日</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          間隔は YouTube Data API の1日あたりの上限（10,000ユニット。1回の収集は search 1ページのみで約100ユニット消費）に収まるよう、
          配信が多いゴールデンタイムほど短く配分しています（合計 約9,700ユニット/日）。実体は Supabase の
          pg_cron（収集4ジョブ ＋ 掃除 ＋ チャンネルエンリッチ）で、サーバー時刻(UTC)で登録・日本時間で運用しています。
          エンリッチは登録者数・開設日を1日1回だけ取得（クォータリセット直後・50chで1ユニット）します。
        </p>
      </section>

      <p className="mb-6 text-[11px] leading-relaxed text-slate-400">
        アクセス解析はIP・個人情報を保存していません（端末ローカルの匿名トークンと、IP推定の国コードのみで集計）。この画面は管理者専用です。
      </p>
    </main>
  );
}
