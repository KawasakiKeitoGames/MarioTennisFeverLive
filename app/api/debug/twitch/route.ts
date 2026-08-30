import { NextResponse } from "next/server";
import { GAMES } from "@/lib/games";

// 一時的な調査用エンドポイント（原因特定後に削除する）。
// 同一のアプリアクセストークンで helix の各エンドポイントを叩き比べ、
// どの層で 401 が出ているのかを切り分ける。秘密情報は一切返さない。
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface Probe {
  label: string;
  status: number;
  body: string;
}

async function mintToken(
  clientId: string,
  secret: string,
): Promise<{ status: number; token: string | null; len: number; expiresIn: number | null }> {
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
  if (!res.ok) {
    return { status: res.status, token: null, len: 0, expiresIn: null };
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  return {
    status: res.status,
    token: data.access_token ?? null,
    len: data.access_token?.length ?? 0,
    expiresIn: data.expires_in ?? null,
  };
}

async function probe(label: string, url: string, headers: Record<string, string>): Promise<Probe> {
  try {
    const res = await fetch(url, { headers, cache: "no-store", redirect: "manual" });
    return { label, status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { label, status: -1, body: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret) {
    return NextResponse.json({ error: "env未設定", hasId: !!clientId, hasSecret: !!secret });
  }

  const t1 = await mintToken(clientId, secret);
  const t2 = await mintToken(clientId, secret);
  if (!t1.token) {
    return NextResponse.json({ token: { ...t1, token: undefined }, note: "トークン取得に失敗" });
  }

  const headers = { "Client-ID": clientId, Authorization: `Bearer ${t1.token}` };
  const nameParams = GAMES.map((g) => `name=${encodeURIComponent(g.twitchCategory)}`).join("&");

  const probes = await Promise.all([
    // 収集が落ちている当該リクエスト（3カテゴリまとめ）
    probe("games-multi", `https://api.twitch.tv/helix/games?${nameParams}`, headers),
    // 1カテゴリだけ
    probe(
      "games-single",
      `https://api.twitch.tv/helix/games?name=${encodeURIComponent("Mario Tennis Fever")}`,
      headers,
    ),
    // enrich 側で成功しているエンドポイント（同一トークン）
    probe("users", "https://api.twitch.tv/helix/users?login=twitch", headers),
    // トークンそのものの有効性
    probe("validate", "https://id.twitch.tv/oauth2/validate", {
      Authorization: `Bearer ${t1.token}`,
    }),
    // ヘッダー名の綴りを Twitch のドキュメント通りにした場合
    probe("games-clientid-canonical", `https://api.twitch.tv/helix/games?${nameParams}`, {
      "Client-Id": clientId,
      Authorization: `Bearer ${t1.token}`,
    }),
  ]);

  // 2本目のトークン（=1本目が直後に無効化されていないかの確認）
  const second = t2.token
    ? await probe("games-with-2nd-token", `https://api.twitch.tv/helix/games?${nameParams}`, {
        "Client-ID": clientId,
        Authorization: `Bearer ${t2.token}`,
      })
    : null;
  const firstAfterSecond = await probe(
    "games-1st-token-after-2nd",
    `https://api.twitch.tv/helix/games?${nameParams}`,
    headers,
  );

  return NextResponse.json({
    token1: { status: t1.status, len: t1.len, expiresIn: t1.expiresIn },
    token2: { status: t2.status, len: t2.len, expiresIn: t2.expiresIn },
    sameToken: t1.token === t2.token,
    clientIdLen: clientId.length,
    secretLen: secret.length,
    probes,
    second,
    firstAfterSecond,
  });
}
