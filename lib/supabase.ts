import { createClient } from "@supabase/supabase-js";

// 公開読み取り用（匿名キー）。ブラウザ・サーバー両方で使用可。
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    // Next.js の fetch Data Cache による GET のキャッシュを無効化。
    // これが無いと current_streams などの読み取りが古い値のまま固定される。
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

// 書き込み用（service_role キー）。サーバー側（Cron）でのみ使用。絶対にクライアントへ出さない。
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}
