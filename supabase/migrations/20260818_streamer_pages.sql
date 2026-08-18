-- =====================================================================
-- 2026-08-18 配信者検索・詳細ページ＋クリック種別計測
--   1) events.kind 追加（クリック種別: null/'stream'=視聴, 'vod'=アーカイブ, 'channel'=外部チャンネル）
--   2) clicks_by_path: ページ別クリック数＋種別内訳（管理画面のクリック率用）
--   3) path_views 更新: /streamers/配下を '/streamers/*' に正規化（chごとにパスが割れるため）
--   4) channel_search: 配信者検索（名前部分一致・空なら最近配信順）
--   5) channel_stats: 配信者1chの期間集計（詳細ページKPI）
--   6) channel_time_grid: 1chの曜日×時間の配信時間（詳細ページの傾向グラフ）
--   7) channel_recent_streams: 1chの直近配信（40分ギャップ/stream_id変化でセッション分割。
--      Twitchは stream_id=login 固定のためギャップ分割が本体）
--   8) top_streams に channel_id 追加（ハイライトのクリック計測用）
-- =====================================================================

alter table public.events
  add column if not exists kind text;

-- ---------------------------------------------------------------------
-- clicks_by_path
-- ---------------------------------------------------------------------
create or replace function public.clicks_by_path(p_days int default 30)
returns table (path text, clicks bigint, kinds jsonb)
language sql stable as $$
  with c as (
    select
      case when path like '/streamers/%' then '/streamers/*'
           else coalesce(path, '(不明)') end as path,
      coalesce(kind, 'stream') as kind
    from public.events
    where type = 'click'
      and created_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  by_pk as (
    select path, kind, count(*) as cnt from c group by path, kind
  )
  select path, sum(cnt)::bigint as clicks, jsonb_object_agg(kind, cnt) as kinds
  from by_pk
  group by path
  order by clicks desc;
$$;

-- ---------------------------------------------------------------------
-- path_views: /streamers/* を正規化
-- ---------------------------------------------------------------------
create or replace function public.path_views(p_days int default 30)
returns table (path text, count bigint)
language sql stable as $$
  select
    case when path like '/streamers/%' then '/streamers/*'
         else coalesce(path, '(不明)') end as path,
    count(*) as count
  from public.events
  where type = 'view'
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1 order by count desc;
$$;

-- ---------------------------------------------------------------------
-- channel_search
-- ---------------------------------------------------------------------
create or replace function public.channel_search(
  p_q     text default null,
  p_limit int  default 20
)
returns table (
  channel_id   text,
  channel_name text,
  platform     text,
  first_seen   timestamptz,
  last_seen    timestamptz,
  stream_hours bigint,
  peak_viewers integer
)
language sql stable as $$
  with ch as (
    select channel_id,
           coalesce(max(channel_name), channel_id)          as channel_name,
           max(platform)                                    as platform,
           min(captured_at)                                 as first_seen,
           max(captured_at)                                 as last_seen,
           count(distinct date_trunc('hour', captured_at))  as stream_hours,
           max(coalesce(viewers, 0))::int                   as peak_viewers
    from public.stream_snapshots
    group by channel_id
  )
  select * from ch
  where p_q is null or p_q = ''
     or channel_name ilike '%' || p_q || '%'
     or channel_id   ilike '%' || p_q || '%'
  order by last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_search(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_stats（詳細ページKPI・1ch×期間）
-- ---------------------------------------------------------------------
create or replace function public.channel_stats(
  p_platform   text,
  p_channel_id text,
  p_days       int default 30
)
returns table (
  channel_name   text,
  first_seen_all timestamptz,
  last_seen      timestamptz,
  stream_hours   bigint,
  viewer_hours   bigint,
  peak_viewers   integer,
  peak_at        timestamptz,
  avg_viewers    double precision,
  sessions_note  bigint,
  games          text[]
)
language sql stable as $$
  with snaps as (
    select captured_at, coalesce(viewers, 0) as v, channel_name, stream_id, game
    from public.stream_snapshots
    where platform = p_platform and channel_id = p_channel_id
      and captured_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  buckets as (
    select date_trunc('hour', captured_at) as hb, avg(v) as av
    from snaps group by 1
  )
  select
    (select coalesce(max(s.channel_name), p_channel_id) from snaps s)          as channel_name,
    (select min(captured_at) from public.stream_snapshots
      where platform = p_platform and channel_id = p_channel_id)               as first_seen_all,
    (select max(captured_at) from snaps)                                       as last_seen,
    (select count(*) from buckets)                                             as stream_hours,
    (select coalesce(round(sum(av)), 0)::bigint from buckets)                  as viewer_hours,
    (select coalesce(max(v), 0)::int from snaps)                               as peak_viewers,
    (select captured_at from snaps order by v desc, captured_at asc limit 1)   as peak_at,
    (select round(avg(av)::numeric, 1)::double precision from buckets)         as avg_viewers,
    (select count(distinct stream_id) from snaps where stream_id is not null)  as sessions_note,
    (select array_agg(distinct game) from snaps)                               as games;
$$;
grant execute on function public.channel_stats(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_time_grid（1chの曜日×時間・JST。フロントで時間帯/曜日に集計）
-- ---------------------------------------------------------------------
create or replace function public.channel_time_grid(
  p_platform   text,
  p_channel_id text,
  p_days       int default 30
)
returns table (dow int, hour int, hours_count bigint)
language sql stable as $$
  with buckets as (
    select date_trunc('hour', captured_at) as hb
    from public.stream_snapshots
    where platform = p_platform and channel_id = p_channel_id
      and captured_at >= now() - make_interval(days => greatest(p_days, 1))
    group by 1
  )
  select extract(dow  from hb at time zone 'Asia/Tokyo')::int as dow,
         extract(hour from hb at time zone 'Asia/Tokyo')::int as hour,
         count(*) as hours_count
  from buckets
  group by 1, 2
  order by 1, 2;
$$;
grant execute on function public.channel_time_grid(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_recent_streams（セッション分割: 40分ギャップ or stream_id 変化）
-- ---------------------------------------------------------------------
create or replace function public.channel_recent_streams(
  p_platform   text,
  p_channel_id text,
  p_limit      int default 10
)
returns table (
  started_at   timestamptz,
  ended_at     timestamptz,
  peak_viewers integer,
  avg_viewers  integer,
  hours        bigint,
  title        text,
  url          text,
  game         text
)
language sql stable as $$
  with s as (
    select captured_at, coalesce(viewers, 0) as v, title, url, game, stream_id,
      case when captured_at - lag(captured_at) over (order by captured_at) > interval '40 minutes'
           or stream_id is distinct from lag(stream_id) over (order by captured_at)
           or lag(captured_at) over (order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where platform = p_platform and channel_id = p_channel_id
  ),
  g as (
    select *, sum(newsess) over (order by captured_at) as sid from s
  )
  select min(captured_at)                                 as started_at,
         max(captured_at)                                 as ended_at,
         max(v)::int                                      as peak_viewers,
         round(avg(v))::int                               as avg_viewers,
         count(distinct date_trunc('hour', captured_at))  as hours,
         (array_agg(title order by captured_at desc))[1]  as title,
         (array_agg(url order by captured_at desc))[1]    as url,
         max(game)                                        as game
  from g
  group by sid
  order by started_at desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_recent_streams(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- top_streams: + channel_id（ハイライトクリック計測でchを特定するため）
-- ---------------------------------------------------------------------
drop function if exists public.top_streams(int, int, text, text);
create or replace function public.top_streams(
  p_days     int  default 30,
  p_limit    int  default 6,
  p_platform text default null,
  p_game     text default null
)
returns table (
  stream_id    text,
  channel_id   text,
  channel_name text,
  platform     text,
  peak_viewers integer,
  avg_viewers  double precision,
  hours        bigint,
  started_at   timestamptz,
  title        text,
  url          text
)
language sql stable as $$
  with snaps as (
    select *
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
      and stream_id is not null
  )
  select
    stream_id,
    max(channel_id)                                               as channel_id,
    coalesce(max(channel_name), stream_id)                        as channel_name,
    max(platform)                                                 as platform,
    max(coalesce(viewers, 0))::int                                as peak_viewers,
    round(avg(coalesce(viewers, 0))::numeric, 1)::double precision as avg_viewers,
    count(distinct date_trunc('hour', captured_at))               as hours,
    min(captured_at)                                              as started_at,
    (array_agg(title order by coalesce(viewers,0) desc, captured_at desc))[1] as title,
    (array_agg(url order by captured_at desc))[1]                 as url
  from snaps
  group by stream_id
  order by peak_viewers desc, hours desc, started_at desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.top_streams(int, int, text, text) to anon, authenticated;
