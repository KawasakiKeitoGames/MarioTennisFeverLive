// 公開サイトの軽量アクセス計測。個人情報は送らない。
// - trackView(): ページ表示時に1回だけ送る（1分ごとの自動更新では送らない）
// - trackClick(): 配信リンククリック時に sendBeacon で送る（遷移に強い）
// visitor は端末ローカルのランダムトークン（ユニーク数集計用・個人特定不可）。

import type { StreamSnapshot } from "@/lib/types";

const VID_KEY = "mtf_vid";

function getVisitor(): string {
  if (typeof window === "undefined") return "";
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v) {
      v =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch {
    return "";
  }
}

function referrerHost(): string | null {
  if (typeof document === "undefined" || !document.referrer) return null;
  try {
    const h = new URL(document.referrer).host;
    // 自サイトからの遷移（内部リンク）はリファラなし扱いにする
    if (h === location.host) return null;
    return h || null;
  } catch {
    return null;
  }
}

function send(payload: Record<string, unknown>, beacon = false): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify(payload);
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  // keepalive でページ遷移中でも送信を試みる
  fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function trackView(path: string): void {
  send({
    type: "view",
    path,
    referrer_host: referrerHost(),
    visitor: getVisitor(),
  });
}

export function trackClick(s: StreamSnapshot): void {
  send(
    {
      type: "click",
      path: typeof location !== "undefined" ? location.pathname : null,
      platform: s.platform,
      channel_id: s.channel_id,
      channel_name: s.channel_name,
      target_url: s.url,
      visitor: getVisitor(),
    },
    true,
  );
}

// 視聴リンク以外の外部リンク（アーカイブ/チャンネルページ等）のクリック計測。
// kind: 'vod'=アーカイブ・動画一覧 / 'channel'=チャンネルページ（'stream'相当は trackClick を使う）
export function trackOutbound(o: {
  platform: string;
  channelId: string | null;
  channelName: string | null;
  url: string;
  kind: "vod" | "channel";
}): void {
  send(
    {
      type: "click",
      kind: o.kind,
      path: typeof location !== "undefined" ? location.pathname : null,
      platform: o.platform,
      channel_id: o.channelId,
      channel_name: o.channelName,
      target_url: o.url,
      visitor: getVisitor(),
    },
    true,
  );
}
