import type { LiveStream } from "./types";
import { classifyTitle } from "./games";

// クォータ節約のため検索は「マリオテニス」1本に集約。YouTube検索は曖昧一致で
// フィーバー/エース/64 いずれのライブ配信もこの1クエリで拾えるため、
// 対応タイトルを増やしても search の消費は従来と同じ（1回100ユニット）で済む。
// どのタイトルの配信かは、下の classifyTitle でタイトル文字列から判別する。
const YT_QUERIES = ["マリオテニス"];
const BASE = "https://www.googleapis.com/youtube/v3";
// チャンネルのRSSフィード（APIキー不要・クォータ消費0・最新15件）
const FEED_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";

// YouTube検索はキーワードが緩く、無関係な配信も拾う（例: 別ゲーム配信や、
// 概要欄にゲーム名を列挙しているだけの雑談配信）。実際にプレイ中の配信は
// タイトルにゲーム名を入れているため、いずれかの対応タイトルのキーワードに
// 一致するものだけ残す（判別ロジックは lib/games.ts に集約）。

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { channelId?: string; channelTitle?: string; title?: string };
}

interface VideoItem {
  id: string;
  liveStreamingDetails?: {
    scheduledStartTime?: string;
    actualStartTime?: string;
    actualEndTime?: string;
    concurrentViewers?: string;
  };
  snippet?: { channelId?: string; channelTitle?: string; title?: string };
}

/** videos.list から見た動画の状態。live/upcoming 以外は確定（もう問い合わせ直さない）。 */
export type VideoStatus = "live" | "upcoming" | "ended" | "vod" | "gone";

export interface FeedEntry {
  videoId: string;
  channelId: string;
  title: string;
  published: string;
}

interface VideoMeta {
  channelId: string;
  channel: string;
  title: string;
}

/** videos.list（50件で1ユニット）。ライブ判定に必要な項目だけ取る。 */
async function fetchVideos(apiKey: string, ids: string[]): Promise<VideoItem[]> {
  const out: VideoItem[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      `${BASE}/videos?part=liveStreamingDetails,snippet&id=${chunk.join(",")}&key=${apiKey}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.error(`[YT videos] ${res.status} ${await res.text()}`);
      continue;
    }
    const data = (await res.json()) as { items?: VideoItem[] };
    out.push(...(data.items ?? []));
  }
  return out;
}

function statusOf(it: VideoItem): VideoStatus {
  const d = it.liveStreamingDetails;
  if (!d) return "vod"; // ライブ配信ではない通常動画
  if (d.actualEndTime) return "ended";
  if (d.concurrentViewers != null) return "live";
  if (d.actualStartTime) return "live"; // 配信中だが視聴者数非公開
  return "upcoming"; // 予約枠（まだ開始していない）
}

/** videos.list の結果を、DBに入れる形（LiveStream）に変換する。 */
function toLiveStream(it: VideoItem, meta?: VideoMeta): LiveStream | null {
  const cv = it.liveStreamingDetails?.concurrentViewers;
  if (cv == null) return null; // 実際に配信中のものだけ
  const title = it.snippet?.title ?? meta?.title ?? "";
  // どの対応タイトルのキーワードにも一致しない配信は除外（別ゲーム等の誤検出対策）
  const game = classifyTitle(title);
  if (!game) return null;
  return {
    platform: "youtube",
    game,
    channelId: it.snippet?.channelId ?? meta?.channelId ?? "",
    channelName: it.snippet?.channelTitle ?? meta?.channel ?? "",
    streamId: it.id,
    title,
    viewers: parseInt(cv, 10),
    language: "",
    url: `https://www.youtube.com/watch?v=${it.id}`,
  };
}

/**
 * 今ライブ配信中のマリテニ動画を横断検索して返す。
 * search(eventType=live) は 1回100ユニット。videos は 50件で1ユニット。
 */
export async function fetchYouTubeLive(apiKey: string): Promise<LiveStream[]> {
  const found = new Map<string, VideoMeta>();

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

  const items = await fetchVideos(apiKey, [...found.keys()]);
  const out: LiveStream[] = [];
  for (const it of items) {
    const s = toLiveStream(it, found.get(it.id));
    if (s) out.push(s);
  }
  return out;
}

/**
 * 動画IDを指定してライブ判定する（検索の取りこぼし補完用）。
 * 消費は videos.list のみ＝50件で1ユニット。
 * 戻り値の statuses には、渡した全IDぶんの状態が入る（応答に無いIDは 'gone'）。
 */
export async function fetchYouTubeLiveByIds(
  apiKey: string,
  ids: string[],
): Promise<{ live: LiveStream[]; statuses: Map<string, VideoStatus> }> {
  const statuses = new Map<string, VideoStatus>();
  if (ids.length === 0) return { live: [], statuses };

  const items = await fetchVideos(apiKey, ids);
  const live: LiveStream[] = [];
  for (const it of items) {
    statuses.set(it.id, statusOf(it));
    const s = toLiveStream(it);
    if (s) live.push(s);
  }
  // 応答に含まれなかったID＝削除/非公開。二度と問い合わせないよう確定させる。
  for (const id of ids) if (!statuses.has(id)) statuses.set(id, "gone");
  return { live, statuses };
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => XML_ENTITIES[m] ?? m);
}

function parseFeed(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(e)?.[1];
    if (!videoId) continue;
    out.push({
      videoId,
      channelId: /<yt:channelId>([^<]+)<\/yt:channelId>/.exec(e)?.[1] ?? "",
      title: unescapeXml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? ""),
      published: /<published>([^<]+)<\/published>/.exec(e)?.[1] ?? "",
    });
  }
  return out;
}

/**
 * 既知チャンネルのRSSフィードから最近の動画一覧を取る。
 * APIキー不要・YouTubeクォータを一切消費しないので、検索の取りこぼし探しに使える。
 * 取れなかったチャンネルは黙って飛ばす（補完は best-effort）。
 */
export async function fetchChannelFeedEntries(
  channelIds: string[],
  concurrency = 6,
): Promise<FeedEntry[]> {
  const out: FeedEntry[] = [];
  let cursor = 0;
  let failed = 0;

  async function worker() {
    while (cursor < channelIds.length) {
      const id = channelIds[cursor++];
      try {
        const res = await fetch(`${FEED_BASE}${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        out.push(...parseFeed(await res.text()));
      } catch {
        failed++;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, channelIds.length) }, () => worker()),
  );
  if (failed) console.warn(`[YT feed] ${failed}/${channelIds.length}件のRSS取得に失敗`);
  return out;
}
