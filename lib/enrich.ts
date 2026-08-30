import { createServiceClient } from "@/lib/supabase";
import { helixGet } from "@/lib/twitch";

// =====================================================================
// チャンネルのエンリッチ（1日1回）
//   - active_channels（直近観測 chの一覧）を引く
//   - YouTube: channels.list(part=snippet,statistics) を id 50件ずつ（=1ユニット/50ch）
//   - Twitch : Get Users を login 100件ずつ（Twitchはユニット概念なし）
//   - channels に upsert（静的属性）＋ channel_stats_daily に当日分を upsert（時系列）
//   search とは別ジョブ。channels.list は 50件で1ユニットなので数百chでも日次1桁ユニット。
// =====================================================================

const YT_BASE = "https://www.googleapis.com/youtube/v3";

export interface EnrichResult {
  ok: boolean;
  youtube: number;
  twitch: number;
  yt_details: number;
  tw_vods: number;
  units_est: number;
  error?: string;
}

// JST日付（YYYY-MM-DD）。channel_stats_daily.day の粒度に合わせる。
function jstDay(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA は YYYY-MM-DD 形式
}

interface ActiveChannel {
  channel_id: string;
  platform: "youtube" | "twitch";
  channel_name: string | null;
  first_seen: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function enrichYouTube(
  ids: ActiveChannel[],
  apiKey: string,
  day: string,
): Promise<{ count: number; units: number }> {
  const supabase = createServiceClient();
  const firstSeenMap = new Map(ids.map((c) => [c.channel_id, c.first_seen]));
  let count = 0;
  let units = 0;
  const now = new Date().toISOString();

  for (const group of chunk(ids.map((c) => c.channel_id), 50)) {
    const url =
      `${YT_BASE}/channels?part=snippet,statistics&id=${group.join(",")}` +
      `&maxResults=50&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    units += 1; // channels.list は 1リクエスト=1ユニット（最大50件）
    if (!res.ok) {
      console.error(`[enrich YT] ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          description?: string;
          publishedAt?: string;
          country?: string;
          thumbnails?: { default?: { url?: string } };
        };
        statistics?: {
          subscriberCount?: string;
          hiddenSubscriberCount?: boolean;
          viewCount?: string;
          videoCount?: string;
        };
      }>;
    };

    const channelRows = [];
    const statRows = [];
    for (const it of data.items ?? []) {
      const sn = it.snippet ?? {};
      const st = it.statistics ?? {};
      channelRows.push({
        channel_id: it.id,
        platform: "youtube",
        title: sn.title ?? null,
        description: sn.description ?? null,
        published_at: sn.publishedAt ?? null,
        country: sn.country ?? null,
        broadcaster_type: null,
        thumbnail_url: sn.thumbnails?.default?.url ?? null,
        first_seen: firstSeenMap.get(it.id) ?? null,
        last_enriched_at: now,
      });
      statRows.push({
        channel_id: it.id,
        platform: "youtube",
        day,
        // 登録者非公開のチャンネルは null（hiddenSubscriberCount=true）
        subscriber_count: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
        view_count: num(st.viewCount),
        video_count: num(st.videoCount),
      });
      count += 1;
    }

    if (channelRows.length) {
      const { error } = await supabase
        .from("channels")
        .upsert(channelRows, { onConflict: "channel_id" });
      if (error) console.error("[enrich YT] channels upsert:", error.message);
    }
    if (statRows.length) {
      const { error } = await supabase
        .from("channel_stats_daily")
        .upsert(statRows, { onConflict: "channel_id,day" });
      if (error) console.error("[enrich YT] stats upsert:", error.message);
    }
  }
  return { count, units };
}

async function enrichTwitch(
  ids: ActiveChannel[],
  clientId: string,
  secret: string,
): Promise<{ count: number }> {
  const supabase = createServiceClient();
  const firstSeenMap = new Map(ids.map((c) => [c.channel_id, c.first_seen]));
  const now = new Date().toISOString();
  let count = 0;

  // Twitch は登録者相当（フォロワー総数）が各ch認証なしでは取れないため、
  // 開設日・broadcaster_type などの静的属性のみを channels に保存する。
  for (const group of chunk(ids.map((c) => c.channel_id), 100)) {
    const qs = group.map((l) => `login=${encodeURIComponent(l)}`).join("&");
    const res = await helixGet(`https://api.twitch.tv/helix/users?${qs}`, clientId, secret);
    if (!res.ok) {
      console.error(`[enrich TW] ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as {
      data?: Array<{
        login?: string;
        display_name?: string;
        description?: string;
        broadcaster_type?: string;
        created_at?: string;
        profile_image_url?: string;
      }>;
    };
    const rows = (data.data ?? []).map((u) => ({
      channel_id: u.login ?? "",
      platform: "twitch",
      title: u.display_name ?? u.login ?? null,
      description: u.description ?? null,
      published_at: u.created_at ?? null,
      country: null,
      broadcaster_type: u.broadcaster_type ?? "",
      thumbnail_url: u.profile_image_url ?? null,
      first_seen: firstSeenMap.get(u.login ?? "") ?? null,
      last_enriched_at: now,
    }));
    if (rows.length) {
      const { error } = await supabase
        .from("channels")
        .upsert(rows, { onConflict: "channel_id" });
      if (error) console.error("[enrich TW] channels upsert:", error.message);
      else count += rows.length;
    }
  }
  return { count };
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// =====================================================================
// 配信の実測時間（stream_details）
//   YouTube: videos.list(liveStreamingDetails) = 1ユニット/50本。
//            actual_end が未確定（配信中に取得）の動画は翌日再取得される。
//   Twitch : Get Videos(type=archive) をアクティブch分（ユニット概念なし）。
// =====================================================================

async function enrichYouTubeStreamDetails(
  apiKey: string,
): Promise<{ count: number; units: number }> {
  const supabase = createServiceClient();
  // 30日分を対象にする（取得済み・終了確定分は除外されるので、2回目以降は差分のみ＝数ユニット）
  const { data, error } = await supabase.rpc("yt_streams_needing_details", { p_days: 30 });
  if (error) throw new Error(`yt_streams_needing_details: ${error.message}`);
  const targets = (data ?? []) as { stream_id: string; channel_id: string }[];
  if (targets.length === 0) return { count: 0, units: 0 };
  const chById = new Map(targets.map((t) => [t.stream_id, t.channel_id]));

  let count = 0;
  let units = 0;
  const now = new Date().toISOString();
  for (const group of chunk(targets.map((t) => t.stream_id), 50)) {
    const url =
      `${YT_BASE}/videos?part=liveStreamingDetails,snippet&id=${group.join(",")}` +
      `&maxResults=50&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    units += 1; // videos.list は 1リクエスト=1ユニット（最大50件）
    if (!res.ok) {
      console.error(`[enrich YT details] ${res.status} ${await res.text()}`);
      continue;
    }
    const data2 = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string };
        liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
      }>;
    };
    const rows = [];
    for (const it of data2.items ?? []) {
      const ld = it.liveStreamingDetails;
      if (!ld?.actualStartTime) continue; // ライブ由来でない動画は対象外
      const start = new Date(ld.actualStartTime).getTime();
      const end = ld.actualEndTime ? new Date(ld.actualEndTime).getTime() : null;
      rows.push({
        platform: "youtube",
        video_id: it.id,
        channel_id: chById.get(it.id) ?? null,
        actual_start: ld.actualStartTime,
        actual_end: ld.actualEndTime ?? null,
        duration_seconds: end != null ? Math.max(0, Math.round((end - start) / 1000)) : null,
        title: it.snippet?.title ?? null,
        fetched_at: now,
      });
    }
    if (rows.length) {
      const { error: e2 } = await supabase
        .from("stream_details")
        .upsert(rows, { onConflict: "platform,video_id" });
      if (e2) console.error("[enrich YT details] upsert:", e2.message);
      else count += rows.length;
    }
  }
  return { count, units };
}

// Twitch の duration 文字列（"1h2m3s" 等）→ 秒
function parseTwitchDuration(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) || null;
}

async function enrichTwitchVods(
  logins: string[],
  clientId: string,
  secret: string,
): Promise<{ count: number }> {
  const supabase = createServiceClient();
  const now = new Date().toISOString();

  // login → user_id（Get Videos は user_id 指定のため）
  const idByLogin = new Map<string, string>();
  for (const group of chunk(logins, 100)) {
    const qs = group.map((l) => `login=${encodeURIComponent(l)}`).join("&");
    const res = await helixGet(`https://api.twitch.tv/helix/users?${qs}`, clientId, secret);
    if (!res.ok) {
      console.error(`[enrich TW vods] users ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as { data?: Array<{ id?: string; login?: string }> };
    for (const u of data.data ?? []) {
      if (u.login && u.id) idByLogin.set(u.login, u.id);
    }
  }

  let count = 0;
  for (const [login, userId] of idByLogin) {
    const res = await helixGet(
      `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=10`,
      clientId,
      secret,
    );
    if (!res.ok) {
      console.error(`[enrich TW vods] videos(${login}) ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as {
      data?: Array<{ id?: string; title?: string; created_at?: string; duration?: string }>;
    };
    const rows = [];
    for (const v of data.data ?? []) {
      if (!v.id || !v.created_at) continue;
      const dur = parseTwitchDuration(v.duration);
      rows.push({
        platform: "twitch",
        video_id: v.id,
        channel_id: login,
        actual_start: v.created_at,
        actual_end:
          dur != null ? new Date(new Date(v.created_at).getTime() + dur * 1000).toISOString() : null,
        duration_seconds: dur,
        title: v.title ?? null,
        fetched_at: now,
      });
    }
    if (rows.length) {
      const { error } = await supabase
        .from("stream_details")
        .upsert(rows, { onConflict: "platform,video_id" });
      if (error) console.error("[enrich TW vods] upsert:", error.message);
      else count += rows.length;
    }
  }
  return { count };
}

// エンリッチ本体。cron ルートから呼ぶ。
export async function runEnrich(): Promise<EnrichResult> {
  const supabase = createServiceClient();
  const day = jstDay();

  const { data, error } = await supabase.rpc("active_channels", { p_days: 60 });
  if (error) throw new Error(`active_channels: ${error.message}`);
  const all = (data ?? []) as ActiveChannel[];
  const yt = all.filter((c) => c.platform === "youtube");
  const tw = all.filter((c) => c.platform === "twitch");

  let ytCount = 0;
  let ytUnits = 0;
  let twCount = 0;
  let ytDetails = 0;
  let twVods = 0;
  const errors: string[] = [];

  const ytKey = process.env.YT_API_KEY;
  if (ytKey && yt.length) {
    try {
      const r = await enrichYouTube(yt, ytKey, day);
      ytCount = r.count;
      ytUnits = r.units;
    } catch (e) {
      errors.push(`YouTube: ${e instanceof Error ? e.message : e}`);
    }
  }

  // 配信の実測時間（YouTube: videos.list=1ユニット/50本）
  if (ytKey) {
    try {
      const r = await enrichYouTubeStreamDetails(ytKey);
      ytDetails = r.count;
      ytUnits += r.units;
    } catch (e) {
      errors.push(`YT details: ${e instanceof Error ? e.message : e}`);
    }
  }

  const twId = process.env.TWITCH_CLIENT_ID;
  const twSecret = process.env.TWITCH_CLIENT_SECRET;
  if (twId && twSecret && tw.length) {
    try {
      const r = await enrichTwitch(tw, twId, twSecret);
      twCount = r.count;
    } catch (e) {
      errors.push(`Twitch: ${e instanceof Error ? e.message : e}`);
    }

    // VODの実測時間（直近7日にアクティブなchのみ・アーカイブ上位10本ずつ）
    try {
      const { data: recentData, error: recentErr } = await supabase.rpc("active_channels", {
        p_days: 7,
      });
      if (recentErr) throw new Error(recentErr.message);
      const targets = ((recentData ?? []) as ActiveChannel[])
        .filter((c) => c.platform === "twitch")
        .map((c) => c.channel_id);
      if (targets.length) {
        const r = await enrichTwitchVods(targets, twId, twSecret);
        twVods = r.count;
      }
    } catch (e) {
      errors.push(`TW vods: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    ok: errors.length === 0,
    youtube: ytCount,
    twitch: twCount,
    yt_details: ytDetails,
    tw_vods: twVods,
    units_est: ytUnits,
    error: errors.length ? errors.join(" / ") : undefined,
  };
}
