-- =====================================================================
-- Mario Tennis Fever ライブウォッチャー Supabase スキーマ
-- Supabase の SQL Editor に貼り付けて実行してください。
-- =====================================================================

-- 各取得時点の配信中データを1行ずつ蓄積（時系列）
create table if not exists public.stream_snapshots (
  id           bigint generated always as identity primary key,
  captured_at  timestamptz not null default now(),
  platform     text        not null check (platform in ('youtube','twitch')),
  channel_id   text        not null,          -- YouTube: channelId / Twitch: user_login
  channel_name text,
  stream_id    text,                          -- YouTube: videoId / Twitch: stream idの代わりにuser_login
  title        text,
  viewers      integer,
  language     text,
  url          text
);

create index if not exists idx_snap_captured  on public.stream_snapshots (captured_at desc);
create index if not exists idx_snap_platform  on public.stream_snapshots (platform);
create index if not exists idx_snap_channel   on public.stream_snapshots (platform, channel_id, captured_at desc);

-- 最新スナップショットの取得時刻を返すヘルパービュー
create or replace view public.latest_capture as
  select max(captured_at) as captured_at from public.stream_snapshots;

-- 「現在配信中」一覧 = 最新の captured_at に属する行
create or replace view public.current_streams as
  select s.*
  from public.stream_snapshots s
  join public.latest_capture lc on s.captured_at = lc.captured_at
  order by s.viewers desc nulls last;

-- =====================================================================
-- RLS: 公開読み取りのみ許可。書き込みは service_role（Cron）だけ。
-- =====================================================================
alter table public.stream_snapshots enable row level security;

-- 匿名ユーザーに SELECT を許可（公開サイト用）
drop policy if exists "public read snapshots" on public.stream_snapshots;
create policy "public read snapshots"
  on public.stream_snapshots for select
  to anon
  using (true);

-- INSERT は付与しない（service_role キーは RLS をバイパスするため設定不要）

-- =====================================================================
-- 古いデータの掃除（任意）: 30日より古いスナップショットを削除する関数
-- pg_cron 拡張があれば定期実行に紐づけられます。
-- =====================================================================
create or replace function public.prune_old_snapshots()
returns void language sql as $$
  delete from public.stream_snapshots
  where captured_at < now() - interval '30 days';
$$;
