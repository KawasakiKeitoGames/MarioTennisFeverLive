// 管理画面のセッションCookie用 HMAC署名ユーティリティ。
// Edge(middleware) と Node(route) の両方で動く Web Crypto(subtle) を使用。
// 署名鍵は既存の CRON_SECRET を流用する（新しい環境変数を増やさない）。

export const ADMIN_COOKIE = "mtf_admin";
const SESSION_DAYS = 30;

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error("CRON_SECRET が未設定です（管理セッションの署名に使用）");
  return s;
}

async function hmac(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return b64url(new Uint8Array(sig));
}

// 有効期限付きの署名トークンを発行する。形式: "<expMs>.<sig>"
export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const sig = await hmac(`admin.${exp}`);
  return `${exp}.${sig}`;
}

// トークンの署名と有効期限を検証する。
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const expStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const expected = await hmac(`admin.${exp}`);
  // 定数時間比較
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
}

export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
