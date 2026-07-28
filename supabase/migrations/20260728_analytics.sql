-- =====================================================================
-- アクセス解析（閲覧ログ）テーブル＋集計関数
-- FEVER LIVE 管理画面用。Supabase の SQL Editor に貼り付けて実行してもOK。
-- 何度実行しても安全（IF NOT EXISTS / OR REPLACE）。
-- =====================================================================

create table if not exists public.events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  type          text        not null check (type in ('view','click')),
  path          text,
  referrer_host text,
  platform      text,
  channel_id    text,
  channel_name  text,
  target_url    text,
  visitor       text
);

create index if not exists idx_events_created on public.events (created_at desc);
create index if not exists idx_events_type    on public.events (type, created_at desc);

alter table public.events enable row level security;
-- 匿名向けポリシーは付けない ＝ anon は select/insert 不可（解析は非公開）。
-- service_role は RLS をバイパスするため API 側の読み書きには影響しない。

-- 日別カウント（PV/クリック推移グラフ用）。JST日付で集計。
create or replace function public.events_daily(
  p_days int default 30,
  p_type text default 'view'
)
returns table (day date, count bigint)
language sql stable as $$
  select (e.created_at at time zone 'Asia/Tokyo')::date as day, count(*) as count
  from public.events e
  where e.type = p_type
    and e.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1 order by 1;
$$;

-- チャンネル別クリック数ランキング
create or replace function public.top_clicked(
  p_days int default 30, p_limit int default 20
)
returns table (channel_name text, platform text, clicks bigint)
language sql stable as $$
  select coalesce(max(e.channel_name), e.channel_id) as channel_name,
         max(e.platform) as platform, count(*) as clicks
  from public.events e
  where e.type = 'click'
    and e.created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by e.channel_id order by clicks desc limit greatest(p_limit, 1);
$$;

-- 期間サマリ（総PV・ユニークビジター・総クリック）
create or replace function public.analytics_summary(p_days int default 30)
returns table (views bigint, clicks bigint, uniques bigint)
language sql stable as $$
  select
    count(*) filter (where type = 'view')                       as views,
    count(*) filter (where type = 'click')                      as clicks,
    count(distinct visitor) filter (where visitor is not null)  as uniques
  from public.events
  where created_at >= now() - make_interval(days => greatest(p_days, 1));
$$;

-- パス別PV
create or replace function public.path_views(p_days int default 30)
returns table (path text, count bigint)
language sql stable as $$
  select coalesce(path, '(不明)') as path, count(*) as count
  from public.events
  where type = 'view'
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1 order by count desc;
$$;

-- リファラ上位ホスト
create or replace function public.top_referrers(p_days int default 30, p_limit int default 15)
returns table (referrer_host text, count bigint)
language sql stable as $$
  select coalesce(referrer_host, '(直接/なし)') as referrer_host, count(*) as count
  from public.events
  where type = 'view'
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1 order by count desc limit greatest(p_limit, 1);
$$;

-- 観測チャンネルの登場回数ランキング
create or replace function public.channel_appearances(p_limit int default 30)
returns table (channel_name text, platform text, appearances bigint, last_seen timestamptz)
language sql stable as $$
  select coalesce(max(channel_name), channel_id) as channel_name,
         max(platform) as platform, count(*) as appearances, max(captured_at) as last_seen
  from public.stream_snapshots
  group by channel_id order by appearances desc limit greatest(p_limit, 1);
$$;
