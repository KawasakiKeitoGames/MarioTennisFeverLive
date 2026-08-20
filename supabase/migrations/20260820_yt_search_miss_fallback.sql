-- YouTube検索(search.list eventType=live)が検索インデックス漏れでライブを返さない
-- 取りこぼし対策。既知チャンネルのRSSフィード(クォータ消費0)から候補動画を拾い、
-- videos.list(50件=1ユニット)でライブ判定して補完する。
-- このテーブルは「一度判定して確定したもの(通常動画/終了済み/消滅)」を覚えておき、
-- 毎回の videos.list 問い合わせをほぼ0件に抑えるためのもの。
create table if not exists public.yt_video_status (
  video_id text primary key,
  channel_id text,
  status text not null check (status in ('live', 'upcoming', 'ended', 'vod', 'gone')),
  title text,
  checked_at timestamptz not null default now()
);

create index if not exists yt_video_status_checked_at_idx on public.yt_video_status (checked_at desc);

-- 収集(service_role)専用。公開ロール向けのポリシーは作らない＝anonからは読めない。
alter table public.yt_video_status enable row level security;
