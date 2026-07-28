-- =====================================================================
-- 収集をプラットフォーム別に分離するための captures 再設計。
--   旧: captures(captured_at PK, youtube int, twitch int)  … 1収集=両PF同時
--   新: captures(id, captured_at, platform, count)         … PFごとに独立記録
-- これにより YouTube と Twitch を別サイクル（例: Twitchは2分間隔）で回せる。
-- 「現在配信中」は各PFの最新収集時点をそれぞれ採用する。
-- 冪等: 再実行しても壊れないよう information_schema で旧形状を判定する。
-- =====================================================================

do $$
begin
  -- captures がまだ旧形状（youtube 列を持つ）の場合だけ移行する
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'captures' and column_name = 'youtube'
  ) then
    -- 依存ビューを一旦落とす（captures を差し替えるため）
    drop view if exists public.current_streams;
    drop view if exists public.latest_capture;

    create table public.captures_v2 (
      id          bigint generated always as identity primary key,
      captured_at timestamptz not null default now(),
      platform    text        not null check (platform in ('youtube','twitch')),
      count       integer     not null default 0
    );
    create index idx_captures_platform on public.captures_v2 (platform, captured_at desc);

    -- 旧の1行(両PF) → PFごとの2行に展開して移行
    insert into public.captures_v2 (captured_at, platform, count)
      select captured_at, 'youtube', coalesce(youtube, 0) from public.captures
      union all
      select captured_at, 'twitch',  coalesce(twitch, 0)  from public.captures;

    drop table public.captures;
    alter table public.captures_v2 rename to captures;
  end if;
end $$;

-- RLS（公開読み取りのみ・冪等）
alter table public.captures enable row level security;
drop policy if exists "public read captures" on public.captures;
create policy "public read captures"
  on public.captures for select
  to anon
  using (true);

-- 各PFの最新収集時刻
create or replace view public.latest_capture_by_platform as
  select platform, max(captured_at) as captured_at
  from public.captures
  group by platform;

-- 全体の最新収集時刻（既存 /api/streams 互換のため単一行ビューを維持）
create or replace view public.latest_capture as
  select max(captured_at) as captured_at from public.captures;

-- 「現在配信中」= PFごとに、そのPFの最新収集時点に属する行だけを返す。
-- あるPFが0件だった回はスナップショット行が無く、そのPFは空になる（＝現在配信なし）。
create or replace view public.current_streams as
  select s.*
  from public.stream_snapshots s
  join public.latest_capture_by_platform lc
    on lc.platform = s.platform
   and lc.captured_at = s.captured_at
  order by s.viewers desc nulls last;
