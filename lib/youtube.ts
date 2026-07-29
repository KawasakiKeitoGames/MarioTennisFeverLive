import type { LiveStream, Orientation } from "./types";

// 埋め込みプレイヤーの寸法から縦横を判定する。part=player&maxWidth 指定時に
// embedWidth/embedHeight が動画の実アスペクト比で返るため、高さ>幅 なら縦動画。
// 寸法が取れない場合（埋め込み無効など）は null（未判定）。
function orientationFrom(player?: {
  embedWidth?: number | string;
  embedHeight?: number | string;
}): Orientation | null {
  // APIは maxWidth/maxHeight 指定時のみ寸法を返し、数値/文字列どちらの場合もある。
  const w = Number(player?.embedWidth);
  const h = Number(player?.embedHeight);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return h > w ? "portrait" : "landscape";
  }
  return null;
}

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
    // 1ページ(最大50件)のみ取得する安全弁。実測では同時配信は最大10件程度で、
    // 2ページ目(nextPageToken)はそもそも発火しない。仮に大会等で瞬間的に50件を
    // 超えても、ここで打ち切ることで1回あたりのsearch消費が100ユニットで固定され、
    // ゴールデンの連続実行でも日次上限(10,000)を突き破って収集が全停止する事故を防ぐ。
    for (let page = 0; page < 1; page++) {
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
    // player パートはクォータ加算なし。maxWidth を付けると embedWidth/embedHeight が返る。
    const url =
      `${BASE}/videos?part=liveStreamingDetails,snippet,player&maxWidth=640&id=${chunk.join(",")}&key=${apiKey}`;
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
        player?: { embedWidth?: number | string; embedHeight?: number | string };
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
        orientation: orientationFrom(it.player),
      });
    }
  }

  return out;
}
