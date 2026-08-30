// 一時的な調査スクリプト（原因特定後に削除する）。
// ビルド時に Twitch API を叩き、収集が 401 になる層を切り分けてログに出す。
// 出力するのはステータスコードと Twitch のレスポンス本文だけで、
// client_id / client_secret / トークンそのものは一切出さない。
const clientId = process.env.TWITCH_CLIENT_ID;
const secret = process.env.TWITCH_CLIENT_SECRET;

const log = (...a) => console.log("[TWITCH-PROBE]", ...a);

async function mint(label) {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    log(`mint(${label}) status=${res.status} body=${text.slice(0, 200)}`);
    return null;
  }
  const data = JSON.parse(text);
  log(
    `mint(${label}) status=${res.status} tokenLen=${data.access_token?.length ?? 0}` +
      ` expiresIn=${data.expires_in} tokenType=${data.token_type}`,
  );
  return data.access_token ?? null;
}

async function probe(label, url, headers) {
  try {
    const res = await fetch(url, { headers, redirect: "manual" });
    const body = await res.text();
    log(`${label} -> ${res.status} ${body.slice(0, 240)}`);
    return res.status;
  } catch (e) {
    log(`${label} -> EXCEPTION ${e?.message ?? e}`);
    return -1;
  }
}

async function main() {
  if (!clientId || !secret) {
    log(`env未設定 hasId=${!!clientId} hasSecret=${!!secret}`);
    return;
  }
  log(`clientIdLen=${clientId.length} secretLen=${secret.length}`);

  const t1 = await mint("1st");
  if (!t1) return;

  const h = { "Client-ID": clientId, Authorization: `Bearer ${t1}` };

  // 1) トークン自体が Twitch 的に有効か
  await probe("validate", "https://id.twitch.tv/oauth2/validate", {
    Authorization: `Bearer ${t1}`,
  });
  // 2) enrich で成功しているエンドポイント（同一トークン）
  await probe("users", "https://api.twitch.tv/helix/users?login=twitch", h);
  // 3) 収集が落ちている当該リクエスト
  const names = ["Mario Tennis Fever", "Mario Tennis Aces", "Mario Tennis"]
    .map((n) => `name=${encodeURIComponent(n)}`)
    .join("&");
  await probe("games-multi", `https://api.twitch.tv/helix/games?${names}`, h);
  // 4) 1カテゴリだけ
  await probe(
    "games-single",
    `https://api.twitch.tv/helix/games?name=${encodeURIComponent("Mario Tennis Fever")}`,
    h,
  );
  // 5) ヘッダー綴りを Twitch ドキュメント通りに
  await probe("games-Client-Id", `https://api.twitch.tv/helix/games?${names}`, {
    "Client-Id": clientId,
    Authorization: `Bearer ${t1}`,
  });
  // 6) game_id 指定の streams（IDが分かれば games を経由せずに済むかの確認）
  await probe("streams-by-lang", "https://api.twitch.tv/helix/streams?first=1", h);
  // 7) カテゴリ検索（games の代替候補）
  await probe(
    "search-categories",
    `https://api.twitch.tv/helix/search/categories?query=${encodeURIComponent("Mario Tennis")}`,
    h,
  );

  // 8) 2本目のトークンを発行し、1本目が無効化されるかを確認
  const t2 = await mint("2nd");
  if (t2) {
    log(`sameToken=${t1 === t2}`);
    await probe("games-with-2nd-token", `https://api.twitch.tv/helix/games?${names}`, {
      "Client-ID": clientId,
      Authorization: `Bearer ${t2}`,
    });
    await probe("games-with-1st-token-after-2nd", `https://api.twitch.tv/helix/games?${names}`, h);
  }
}

await main();
