import type { LiveStream } from "./types";

const TWITCH_CATEGORY = "Mario Tennis Fever";

async function getToken(clientId: string, secret: string): Promise<string> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * カテゴリ「Mario Tennis Fever」で配信中のストリームを全件取得。
 * Twitch はユニット概念がなくレート制限も緩い。
 */
export async function fetchTwitchLive(
  clientId: string,
  secret: string
): Promise<LiveStream[]> {
  const token = await getToken(clientId, secret);
  const headers = { "Client-ID": clientId, Authorization: `Bearer ${token}` };

  const g = await fetch(
    `https://api.twitch.tv/helix/games?name=${encodeURIComponent(TWITCH_CATEGORY)}`,
    { headers, cache: "no-store" }
  );
  if (!g.ok) throw new Error(`Twitch games: ${g.status} ${await g.text()}`);
  const gData = (await g.json()) as { data?: Array<{ id: string }> };
  const gameId = gData.data?.[0]?.id;
  if (!gameId) {
    console.error(`[Twitch] カテゴリ '${TWITCH_CATEGORY}' が見つかりません`);
    return [];
  }

  const out: LiveStream[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url =
      `https://api.twitch.tv/helix/streams?game_id=${gameId}&first=100` +
      (cursor ? `&after=${cursor}` : "");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Twitch streams: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data?: Array<{
        user_name?: string;
        user_login?: string;
        title?: string;
        viewer_count?: number;
        language?: string;
      }>;
      pagination?: { cursor?: string };
    };
    for (const s of data.data ?? []) {
      const login = s.user_login ?? "";
      out.push({
        platform: "twitch",
        channelId: login,
        channelName: s.user_name ?? login,
        streamId: login,
        title: s.title ?? "",
        viewers: s.viewer_count ?? 0,
        language: s.language ?? "",
        url: `https://www.twitch.tv/${login}`,
      });
    }
    cursor = data.pagination?.cursor ?? "";
    if (!cursor) break;
  }

  return out;
}
