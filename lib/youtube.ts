import type { LiveStream } from "./types";

// クォータ節約のため検索は日本語1本に集約（配信の大半が日本語タイトル）。
// 英語タイトル単独の配信は取りこぼす可能性があるが、消費を約半分に抑える。
const YT_QUERIES = ["マリオテニスフィーバー"];
const BASE = "https://www.googleapis.com/youtube/v3";

// YouTube検索はキーワードが緩く、無関係な配信も拾う（例: 別ゲーム配信や、
// 概要欄にゲーム名を列挙しているだけの雑談配信）。実際にプレイ中の配信は
// タイトルにゲーム名を入れているため、タイトルにキーワードを含むものだけ残す。
const YT_KEYWORDS = ["マリオテニスフィーバー", "mario tennis fever"];
function matchesGame(title: string): boolean {
  const hay = title.toLowerCase();
  return YT_KEYWORDS.some((k) => hay.includes(k));
}

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { channelId?: string; channelTitle?: string; title?: string };
}

/**
 * 今ライブ配信中のマリテニ動画を横断検索して返す。
 * search(eventType=live) は 1回100ユニット。videos は 50件で1ユニット。
 */
export async function fetchYouTubeLive(apiKey: string): Promise<LiveStream[]> {
  const found = new Map<string, { channelId: string; channel: string; title: string }>();

  for (const q of YT_QUERIES) {
    let pageToken = "";
    for (let page = 0; page < 2; page++) {
      const url =
        `${BASE}/search?part=snippet&type=video&eventType=live` +
        `&q=${encodeURIComponent(q)}&maxResults=50&key=${apiKey}` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error(`[YT search] ${q}: ${res.status} ${await res.text()}`);
        break;
      }
      const data = (await res.json()) as { items?: SearchItem[]; nextPageToken?: string };
      for (const it of data.items ?? []) {
        const vid = it.id?.videoId;
        if (vid) {
          found.set(vid, {
            channelId: it.snippet?.channelId ?? "",
            channel: it.snippet?.channelTitle ?? "",
            title: it.snippet?.title ?? "",
          });
        }
      }
      pageToken = data.nextPageToken ?? "";
      if (!pageToken) break;
    }
  }

  const ids = [...found.keys()];
  const out: LiveStream[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      `${BASE}/videos?part=liveStreamingDetails,snippet&id=${chunk.join(",")}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[YT videos] ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        liveStreamingDetails?: { concurrentViewers?: string };
        snippet?: { channelId?: string; channelTitle?: string; title?: string; description?: string };
      }>;
    };
    for (const it of data.items ?? []) {
      const cv = it.liveStreamingDetails?.concurrentViewers;
      if (cv == null) continue; // 実際に配信中のものだけ
      const meta = found.get(it.id);
      const title = it.snippet?.title ?? meta?.title ?? "";
      // タイトルにキーワードを含まない配信は除外（別ゲーム等の誤検出対策）
      if (!matchesGame(title)) continue;
      out.push({
        platform: "youtube",
        channelId: it.snippet?.channelId ?? meta?.channelId ?? "",
        channelName: it.snippet?.channelTitle ?? meta?.channel ?? "",
        streamId: it.id,
        title,
        viewers: parseInt(cv, 10),
        language: "",
        url: `https://www.youtube.com/watch?v=${it.id}`,
      });
    }
  }

  return out;
}
