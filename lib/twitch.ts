import type { LiveStream } from "./types";
import { GAMES, type GameId } from "./games";

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
 * 対応タイトルの各カテゴリで配信中のストリームを全件取得。
 * games / streams とも複数指定を1リクエストにまとめられるため、
 * タイトルを増やしてもAPI呼び出し回数は増えない（Twitchはレート制限も緩い）。
 */
export async function fetchTwitchLive(
  clientId: string,
  secret: string
): Promise<LiveStream[]> {
  const token = await getToken(clientId, secret);
  const headers = { "Client-ID": clientId, Authorization: `Bearer ${token}` };

  // カテゴリ名 → game_id をまとめて解決し、game_id → GameId の対応表を作る
  const nameParams = GAMES.map((g) => `name=${encodeURIComponent(g.twitchCategory)}`).join("&");
  const g = await fetch(`https://api.twitch.tv/helix/games?${nameParams}`, {
    headers,
    cache: "no-store",
  });
  if (!g.ok) throw new Error(`Twitch games: ${g.status} ${await g.text()}`);
  const gData = (await g.json()) as { data?: Array<{ id: string; name: string }> };
  const gameByTwitchId = new Map<string, GameId>();
  for (const cat of gData.data ?? []) {
    const def = GAMES.find(
      (x) => x.twitchCategory.toLowerCase() === (cat.name ?? "").toLowerCase(),
    );
    if (def) gameByTwitchId.set(cat.id, def.id);
  }
  // 見つからなかったカテゴリはログに残す（カテゴリ名変更の検知用）。他タイトルの収集は続行。
  for (const def of GAMES) {
    if (![...gameByTwitchId.values()].includes(def.id)) {
      console.error(`[Twitch] カテゴリ '${def.twitchCategory}' が見つかりません`);
    }
  }
  if (gameByTwitchId.size === 0) return [];

  const idParams = [...gameByTwitchId.keys()].map((id) => `game_id=${id}`).join("&");
  const out: LiveStream[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url =
      `https://api.twitch.tv/helix/streams?${idParams}&first=100` +
      (cursor ? `&after=${cursor}` : "");
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) throw new Error(`Twitch streams: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data?: Array<{
        user_name?: string;
        user_login?: string;
        game_id?: string;
        title?: string;
        viewer_count?: number;
        language?: string;
      }>;
      pagination?: { cursor?: string };
    };
    for (const s of data.data ?? []) {
      const login = s.user_login ?? "";
      const game = gameByTwitchId.get(s.game_id ?? "");
      if (!game) continue; // 想定外のカテゴリ（通常は起きない）
      out.push({
        platform: "twitch",
        game,
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
