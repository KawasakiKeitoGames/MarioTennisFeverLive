import type { LiveStream } from "./types";
import { GAMES, type GameId } from "./games";
import { createServiceClient } from "./supabase";

// =====================================================================
// アプリアクセストークンの扱い
//
// 以前は収集・エンリッチのたびに client_credentials で新しいトークンを発行して
// いた（Twitchは2分間隔なので1日720本）。2026-08-29 08:30(UTC) から、その発行分が
// すべて helix で 401 Invalid OAuth token になり、収集が9時間以上止まった。
// 同じ認証情報でも発行頻度の低いエンリッチ（1日1回）は通っていたため、
// 発行しすぎがトークンを無効化させていたと考えられる。
//
// Twitch のアプリアクセストークンは約60日有効で、公式にも「キャッシュして
// 使い回すこと」が求められている。ここではモジュールスコープ（＝ウォームな
// 実行インスタンス内）で使い回し、401 を受けたときだけ取り直して1回だけ
// 再試行する。これで通常時の発行は激減し、失効しても自動で復帰する。
// =====================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

// 期限ぎりぎりのトークンを掴まないための安全マージン
const TOKEN_SAFETY_MS = 5 * 60_000;

async function mintToken(clientId: string, secret: string): Promise<{ token: string; ttlMs: number }> {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Twitch token: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    // 2xx でもトークンが入っていないことがあり得る。Bearer undefined を
    // 投げて 401 になるより、ここで落として原因を明示する。
    throw new Error("Twitch token: access_token がレスポンスに含まれていません");
  }
  // expires_in が無い場合は控えめに1時間だけ使い回す
  return { token: data.access_token, ttlMs: (data.expires_in ?? 3600) * 1000 };
}

async function getToken(clientId: string, secret: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }
  const { token, ttlMs } = await mintToken(clientId, secret);
  cachedToken = { token, expiresAt: Date.now() + Math.max(ttlMs - TOKEN_SAFETY_MS, 60_000) };
  return token;
}

/**
 * helix への GET。キャッシュ済みトークンで叩き、401 のときだけ
 * トークンを取り直して1回だけ再試行する（失効の自動復帰）。
 */
export async function helixGet(
  url: string,
  clientId: string,
  secret: string,
): Promise<Response> {
  const call = async (token: string) =>
    fetch(url, {
      headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

  let res = await call(await getToken(clientId, secret));
  if (res.status === 401) {
    console.warn("[Twitch] 401のためトークンを再発行して再試行します");
    cachedToken = null;
    res = await call(await getToken(clientId, secret, true));
  }
  return res;
}

// =====================================================================
// カテゴリ（game_id）の解決
//
// game_id はタイトルごとに不変なので、毎回 helix/games を叩く必要はない。
// 一度解決したら twitch_game_ids に保存し、以後はそこから読む。
// helix/games が落ちている間も保存済みIDで収集を続けられるようにするため
// （実際 2026-08-29 の停止時は、この1本の失敗で収集全体が止まっていた）。
// =====================================================================

interface GameIdRow {
  game: string;
  twitch_id: string;
  name: string;
}

let cachedGameIds: { map: Map<string, GameId>; fetchedAt: number } | null = null;
const GAME_ID_TTL_MS = 6 * 60 * 60_000;

async function loadStoredGameIds(): Promise<Map<string, GameId>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("twitch_game_ids").select("game,twitch_id,name");
  if (error) {
    console.error("[Twitch] twitch_game_ids取得失敗:", error.message);
    return new Map();
  }
  const map = new Map<string, GameId>();
  for (const row of (data ?? []) as GameIdRow[]) {
    const def = GAMES.find((g) => g.id === row.game);
    if (def) map.set(row.twitch_id, def.id);
  }
  return map;
}

async function storeGameIds(rows: GameIdRow[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("twitch_game_ids")
    .upsert(rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })), {
      onConflict: "game",
    });
  if (error) console.error("[Twitch] twitch_game_ids保存失敗:", error.message);
}

// カテゴリ名 → 定義 の突き合わせ（大文字小文字は無視）
function matchGame(name: string | undefined): GameId | null {
  const def = GAMES.find((x) => x.twitchCategory.toLowerCase() === (name ?? "").toLowerCase());
  return def ? def.id : null;
}

async function fetchGameIdsFromApi(
  clientId: string,
  secret: string,
): Promise<{ map: Map<string, GameId>; rows: GameIdRow[] }> {
  const nameParams = GAMES.map((g) => `name=${encodeURIComponent(g.twitchCategory)}`).join("&");
  const res = await helixGet(`https://api.twitch.tv/helix/games?${nameParams}`, clientId, secret);
  if (!res.ok) throw new Error(`Twitch games: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data?: Array<{ id: string; name: string }> };

  const map = new Map<string, GameId>();
  const rows: GameIdRow[] = [];
  for (const cat of data.data ?? []) {
    const game = matchGame(cat.name);
    if (game) {
      map.set(cat.id, game);
      rows.push({ game, twitch_id: cat.id, name: cat.name });
    }
  }
  return { map, rows };
}

// helix/games が使えないときの代替。カテゴリ検索から同名のものを拾う。
// 名前の完全一致（大文字小文字のみ無視）に限定して、別カテゴリを誤って
// 拾わないようにする。
async function fetchGameIdsBySearch(
  clientId: string,
  secret: string,
): Promise<{ map: Map<string, GameId>; rows: GameIdRow[] }> {
  const map = new Map<string, GameId>();
  const rows: GameIdRow[] = [];
  for (const def of GAMES) {
    const res = await helixGet(
      `https://api.twitch.tv/helix/search/categories?first=100&query=${encodeURIComponent(def.twitchCategory)}`,
      clientId,
      secret,
    );
    if (!res.ok) {
      console.error(`[Twitch] search/categories ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const hit = (data.data ?? []).find((c) => matchGame(c.name) === def.id);
    if (hit?.id && hit.name) {
      map.set(hit.id, def.id);
      rows.push({ game: def.id, twitch_id: hit.id, name: hit.name });
    }
  }
  return { map, rows };
}

/**
 * 対応タイトルの game_id を解決する。
 * 保存済み → （足りなければ）API → API失敗時は保存済みで代替、の順に粘る。
 */
async function resolveGameIds(clientId: string, secret: string): Promise<Map<string, GameId>> {
  if (cachedGameIds && Date.now() - cachedGameIds.fetchedAt < GAME_ID_TTL_MS) {
    return cachedGameIds.map;
  }

  const stored = await loadStoredGameIds();
  // 全タイトルぶん揃っていれば API を叩かない（game_id は不変）
  if (new Set(stored.values()).size === GAMES.length) {
    cachedGameIds = { map: stored, fetchedAt: Date.now() };
    return stored;
  }

  let resolved: { map: Map<string, GameId>; rows: GameIdRow[] } | null = null;
  let firstError: unknown = null;
  try {
    resolved = await fetchGameIdsFromApi(clientId, secret);
  } catch (e) {
    firstError = e;
    console.error("[Twitch] helix/games での解決に失敗。カテゴリ検索で再試行します:", e);
    try {
      resolved = await fetchGameIdsBySearch(clientId, secret);
    } catch (e2) {
      console.error("[Twitch] カテゴリ検索でも解決できませんでした:", e2);
    }
  }

  if (!resolved || resolved.map.size === 0) {
    // APIで引けなくても、保存済みIDがあれば収集は続けられる
    if (stored.size > 0) {
      console.error("[Twitch] 保存済みのgame_idで継続します");
      cachedGameIds = { map: stored, fetchedAt: Date.now() };
      return stored;
    }
    throw firstError instanceof Error
      ? firstError
      : new Error("Twitch games: game_id を解決できませんでした");
  }

  await storeGameIds(resolved.rows);
  const map = resolved.map;
  // 解決できなかったカテゴリはログに残す（カテゴリ名変更の検知用）
  for (const def of GAMES) {
    if (![...map.values()].includes(def.id)) {
      console.error(`[Twitch] カテゴリ '${def.twitchCategory}' が見つかりません`);
    }
  }
  // 今回引けなかったぶんは保存済みで補う
  for (const [id, game] of stored) if (!map.has(id)) map.set(id, game);
  cachedGameIds = { map, fetchedAt: Date.now() };
  return map;
}

/**
 * 対応タイトルの各カテゴリで配信中のストリームを全件取得。
 * games / streams とも複数指定を1リクエストにまとめられるため、
 * タイトルを増やしてもAPI呼び出し回数は増えない（Twitchはレート制限も緩い）。
 */
export async function fetchTwitchLive(
  clientId: string,
  secret: string,
): Promise<LiveStream[]> {
  const gameByTwitchId = await resolveGameIds(clientId, secret);
  if (gameByTwitchId.size === 0) return [];

  const idParams = [...gameByTwitchId.keys()].map((id) => `game_id=${id}`).join("&");
  const out: LiveStream[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const url =
      `https://api.twitch.tv/helix/streams?${idParams}&first=100` +
      (cursor ? `&after=${cursor}` : "");
    const res = await helixGet(url, clientId, secret);
    if (!res.ok) throw new Error(`Twitch streams: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        started_at?: string;
        user_name?: string;
        user_login?: string;
        game_id?: string;
        game_name?: string;
        title?: string;
        viewer_count?: number;
        language?: string;
      }>;
      pagination?: { cursor?: string };
    };
    for (const s of data.data ?? []) {
      const login = s.user_login ?? "";
      // カテゴリ名で判定し、取れないときだけ game_id の対応表で補う。
      // 保存済みの game_id が古い・誤っていても、別タイトルを取り込まない。
      const game = matchGame(s.game_name) ?? gameByTwitchId.get(s.game_id ?? "");
      if (!game) continue; // 想定外のカテゴリ（通常は起きない）
      out.push({
        platform: "twitch",
        game,
        channelId: login,
        channelName: s.user_name ?? login,
        // Twitchの配信ごとのユニークID。以前は login を入れていたため同一chの別配信が
        // 1本に潰れ、配信本数が数えられなかった（2026-08-24修正）。取れない場合のみ login。
        streamId: s.id ?? login,
        startedAt: s.started_at ?? null,
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
