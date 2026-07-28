import { createServiceClient } from "@/lib/supabase";

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

async function twitchToken(clientId: string, secret: string): Promise<string> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function enrichTwitch(
  ids: ActiveChannel[],
  clientId: string,
  secret: string,
): Promise<{ count: number }> {
  const supabase = createServiceClient();
  const firstSeenMap = new Map(ids.map((c) => [c.channel_id, c.first_seen]));
  const token = await twitchToken(clientId, secret);
  const headers = { "Client-ID": clientId, Authorization: `Bearer ${token}` };
  const now = new Date().toISOString();
  let count = 0;

  // Twitch は登録者相当（フォロワー総数）が各ch認証なしでは取れないため、
  // 開設日・broadcaster_type などの静的属性のみを channels に保存する。
  for (const group of chunk(ids.map((c) => c.channel_id), 100)) {
    const qs = group.map((l) => `login=${encodeURIComponent(l)}`).join("&");
    const res = await fetch(`https://api.twitch.tv/helix/users?${qs}`, {
      headers,
      cache: "no-store",
    });
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

  const twId = process.env.TWITCH_CLIENT_ID;
  const twSecret = process.env.TWITCH_CLIENT_SECRET;
  if (twId && twSecret && tw.length) {
    try {
      const r = await enrichTwitch(tw, twId, twSecret);
      twCount = r.count;
    } catch (e) {
      errors.push(`Twitch: ${e instanceof Error ? e.message : e}`);
    }
  }

  return {
    ok: errors.length === 0,
    youtube: ytCount,
    twitch: twCount,
    units_est: ytUnits,
    error: errors.length ? errors.join(" / ") : undefined,
  };
}
