import type { LiveStream } from "./types";

const YT_QUERIES = ["マリオテニスフィーバー", "Mario Tennis Fever"];
const BASE = "https://www.googleapis.com/youtube/v3";

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
      const res = await fetch(url);
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
        snippet?: { channelId?: string; channelTitle?: string; title?: string };
      }>;
    };
    for (const it of data.items ?? []) {
      const cv = it.liveStreamingDetails?.concurrentViewers;
      if (cv == null) continue; // 実際に配信中のものだけ
      const meta = found.get(it.id);
      out.push({
        platform: "youtube",
        channelId: it.snippet?.channelId ?? meta?.channelId ?? "",
        channelName: it.snippet?.channelTitle ?? meta?.channel ?? "",
        streamId: it.id,
        title: it.snippet?.title ?? meta?.title ?? "",
        viewers: parseInt(cv, 10),
        language: "",
        url: `https://www.youtube.com/watch?v=${it.id}`,
      });
    }
  }

  return out;
}
