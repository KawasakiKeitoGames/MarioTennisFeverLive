-- =====================================================================
-- 2026-08-27 (3)
--   1) 順位変動の前提チェックをRPC側に入れる。
--      「直前の同じ長さの期間」がデータ蓄積開始より前にはみ出す場合は
--      比較が不公平（前期間に居なかっただけの人が全員NEWになる）なので、
--      prev_rank を一律 null にして画面側で変動表示ごと消せるようにする。
--   2) analytics_headline の高速化（結果は変えない）。
--      各観測時刻ごとに相関サブクエリでPF別の最新値を引いていたため
--      O(n^2) になり、30日ぶんで約14秒 → anonの statement timeout(8s) を超えて
--      KPIカードが空になっていた。LOCF（直近の非NULLを持ち回る）に書き換えて
--      同じ結果のまま約54msにする。
-- 戻り値は変えないので create or replace でよい。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a) channel_leaderboard: 前期間がデータ範囲に収まっていなければ prev_rank=null
-- ---------------------------------------------------------------------
create or replace function public.channel_leaderboard(
  p_days     int  default 30,
  p_limit    int  default 20,
  p_platform text default null,
  p_game     text default null
)
returns table (
  channel_id   text,
  channel_name text,
  platform     text,
  stream_hours bigint,
  viewer_hours bigint,
  peak_viewers integer,
  avg_viewers  double precision,
  last_seen    timestamptz,
  rank         integer,
  prev_rank    integer
)
language sql stable as $$
  with cov as (
    select coalesce(
      (select min(s.captured_at) from public.stream_snapshots s
        where (p_platform is null or s.platform = p_platform)
          and (p_game is null or s.game = p_game))
      <= now() - make_interval(days => greatest(p_days, 1) * 2), false) as ok
  ),
  snaps as (
    select channel_id, channel_name, platform, captured_at,
           coalesce(viewers, 0) as viewers,
           (captured_at >= now() - make_interval(days => greatest(p_days, 1))) as is_cur
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1) * 2)
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
  ),
  buckets as (
    select channel_id, is_cur,
           date_trunc('hour', captured_at) as hb,
           avg(viewers)      as avg_v,
           max(viewers)      as peak_v,
           max(channel_name) as ch,
           max(platform)     as pf,
           max(captured_at)  as last_seen
    from snaps
    group by channel_id, is_cur, date_trunc('hour', captured_at)
  ),
  agg as (
    select channel_id, is_cur,
           coalesce(max(ch), channel_id)                    as channel_name,
           max(pf)                                          as platform,
           count(*)                                         as stream_hours,
           round(sum(avg_v))::bigint                        as viewer_hours,
           max(peak_v)::int                                 as peak_viewers,
           round(avg(avg_v)::numeric, 1)::double precision  as avg_viewers,
           max(last_seen)                                   as last_seen
    from buckets
    group by channel_id, is_cur
  ),
  cur as (
    select a.*, rank() over (order by viewer_hours desc, stream_hours desc)::int as rnk
    from agg a where is_cur
  ),
  prev as (
    select channel_id, rank() over (order by viewer_hours desc, stream_hours desc)::int as rnk
    from agg where not is_cur
  )
  select c.channel_id, c.channel_name, c.platform, c.stream_hours, c.viewer_hours,
         c.peak_viewers, c.avg_viewers, c.last_seen, c.rnk,
         case when (select ok from cov) then p.rnk end
  from cur c
  left join prev p on p.channel_id = c.channel_id
  order by c.viewer_hours desc, c.stream_hours desc, c.last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_leaderboard(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1b) channel_growth
-- ---------------------------------------------------------------------
create or replace function public.channel_growth(
  p_days  int default 30,
  p_limit int default 20
)
returns table (
  channel_id   text,
  channel_name text,
  latest_subs  bigint,
  first_subs   bigint,
  delta        bigint,
  growth_pct   double precision,
  published_at timestamptz,
  rank         integer,
  prev_rank    integer
)
language sql stable as $$
  with cov as (
    select coalesce(
      (select min(day) from public.channel_stats_daily
        where platform = 'youtube' and subscriber_count is not null)
      <= (now() at time zone 'Asia/Tokyo')::date - greatest(p_days, 1) * 2, false) as ok
  ),
  base as (
    select channel_id, day, subscriber_count,
           (day >= (now() at time zone 'Asia/Tokyo')::date - greatest(p_days, 1)) as is_cur
    from public.channel_stats_daily
    where platform = 'youtube' and subscriber_count is not null
      and day >= (now() at time zone 'Asia/Tokyo')::date - greatest(p_days, 1) * 2
  ),
  bounds as (
    select channel_id, is_cur,
           (array_agg(subscriber_count order by day desc))[1] as latest_subs,
           (array_agg(subscriber_count order by day asc))[1]  as first_subs
    from base group by channel_id, is_cur
  ),
  d as (
    select channel_id, is_cur, latest_subs, first_subs,
           (latest_subs - first_subs) as delta
    from bounds
  ),
  cur as (
    select d.*, rank() over (order by delta desc nulls last)::int as rnk
    from d where is_cur
  ),
  prev as (
    select channel_id, rank() over (order by delta desc nulls last)::int as rnk
    from d where not is_cur
  )
  select c.channel_id,
         coalesce(ch.title, c.channel_id) as channel_name,
         c.latest_subs,
         c.first_subs,
         c.delta,
         case when c.first_subs > 0
              then round((c.latest_subs - c.first_subs)::numeric / c.first_subs * 100, 1)
              else null end as growth_pct,
         ch.published_at,
         c.rnk,
         case when (select ok from cov) then p.rnk end
  from cur c
  left join public.channels ch on ch.channel_id = c.channel_id
  left join prev p on p.channel_id = c.channel_id
  order by c.delta desc nulls last
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_growth(int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1c) streamer_page_ranking
-- ---------------------------------------------------------------------
create or replace function public.streamer_page_ranking(
  p_days     int  default 30,
  p_limit    int  default 10,
  p_platform text default null
)
returns table (
  platform      text,
  channel_id    text,
  channel_name  text,
  views         bigint,
  uniques       bigint,
  thumbnail_url text,
  rank          integer,
  prev_rank     integer
)
language sql
stable
security definer
set search_path = public
as $$
  with cov as (
    select coalesce(
      (select min(e.created_at) from public.events e
        where e.type = 'view' and e.path like '/streamers/%/%')
      <= now() - make_interval(days => greatest(p_days, 1) * 2), false) as ok
  ),
  ev as (
    select split_part(e.path, '/', 3) as platform,
           split_part(e.path, '/', 4) as channel_id,
           e.visitor,
           (e.created_at >= now() - make_interval(days => greatest(p_days, 1))) as is_cur
    from public.events e
    where e.type = 'view'
      and e.path like '/streamers/%/%'
      and e.created_at >= now() - make_interval(days => greatest(p_days, 1) * 2)
  ),
  agg as (
    select platform, channel_id, is_cur,
           count(*)                              as views,
           count(distinct nullif(visitor, ''))   as uniques
    from ev
    where channel_id <> ''
      and (p_platform is null or platform = p_platform)
    group by platform, channel_id, is_cur
  ),
  cur as (
    select a.*, rank() over (order by uniques desc, views desc)::int as rnk
    from agg a where is_cur
  ),
  prev as (
    select platform, channel_id, rank() over (order by uniques desc, views desc)::int as rnk
    from agg where not is_cur
  )
  select c.platform, c.channel_id, n.channel_name, c.views, c.uniques, ch.thumbnail_url,
         c.rnk,
         case when (select ok from cov) then p.rnk end
  from cur c
  join lateral (
    select s.channel_name
    from public.stream_snapshots s
    where s.platform = c.platform
      and s.channel_id = c.channel_id
      and s.channel_name is not null
    order by s.captured_at desc
    limit 1
  ) n on true
  left join public.channels ch on ch.channel_id = c.channel_id
  left join prev p on p.platform = c.platform and p.channel_id = c.channel_id
  order by c.uniques desc, c.views desc, n.channel_name
  limit greatest(p_limit, 1);
$$;
grant execute on function public.streamer_page_ranking(int, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) analytics_headline: 相関サブクエリ → LOCF（結果は同一・約14秒→約54ms）
-- ---------------------------------------------------------------------
create or replace function public.analytics_headline(
  p_days     int  default 30,
  p_platform text default null,
  p_game     text default null
)
returns table (
  peak_viewers       integer,
  peak_at            timestamptz,
  total_stream_hours bigint,
  active_channels    bigint,
  span_days          integer
)
language sql stable as $$
  with snaps as (
    select captured_at, platform, stream_id, channel_id, viewers
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
  ),
  per_pf as (
    select platform, captured_at, sum(coalesce(viewers, 0))::int as total
    from snaps group by platform, captured_at
  ),
  -- 観測時刻ごとにPFを横並びにする（その時刻に観測が無いPFはnull）
  wide as (
    select captured_at,
           max(total) filter (where platform = 'youtube') as yt,
           max(total) filter (where platform = 'twitch')  as tw
    from per_pf group by captured_at
  ),
  -- 直近の非NULL値を持ち回るためのグループ番号（LOCF: last observation carried forward）
  marked as (
    select captured_at, yt, tw,
           count(yt) over (order by captured_at) as gy,
           count(tw) over (order by captured_at) as gt
    from wide
  ),
  combined as (
    select captured_at,
           case when p_platform is null
             then coalesce(max(yt) over (partition by gy), 0)
                + coalesce(max(tw) over (partition by gt), 0)
             else coalesce(yt, tw, 0)
           end as total
    from marked
  )
  select
    (select max(total) from combined)::int                                          as peak_viewers,
    (select captured_at from combined order by total desc, captured_at asc limit 1) as peak_at,
    (select count(*) from (
        select distinct stream_id, date_trunc('hour', captured_at) from snaps
        where stream_id is not null
     ) x)                                                                            as total_stream_hours,
    (select count(distinct channel_id) from snaps)                                   as active_channels,
    coalesce(ceil(extract(epoch from (
        now() - (select min(captured_at) from public.stream_snapshots)
     )) / 86400.0)::int, 0)                                                          as span_days;
$$;
grant execute on function public.analytics_headline(int, text, text) to anon, authenticated;

drop function if exists public.analytics_headline_v2(int, text, text);

notify pgrst, 'reload schema';
