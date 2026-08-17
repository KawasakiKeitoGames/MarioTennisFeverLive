-- =====================================================================
-- 複数タイトル対応（フィーバー / エース / 64）
--   - stream_snapshots に game 列を追加（既存行は 'fever' 扱い）
--   - current_streams を再作成（ビューの列は作成時に固定されるため、
--     game 列を含めるには DROP → CREATE が必要）
--   - 公開RPC群に p_game (default null = 全タイトル) を追加。
--     引数追加は別オーバーロード扱いになり PostgREST の解決が曖昧になるため、
--     旧シグネチャを DROP してから作り直す。旧デプロイのフロントは p_game を
--     渡さず呼ぶが、default null で解決されるため互換。
-- 値は lib/games.ts の GameId（'fever' | 'aces' | 'mt64'）。タイトル追加に
-- 備えて check 制約は付けない（アプリ側で管理）。
-- =====================================================================

alter table public.stream_snapshots
  add column if not exists game text not null default 'fever';

create index if not exists idx_snap_game
  on public.stream_snapshots (game, captured_at desc);

-- ---------------------------------------------------------------------
-- current_streams 再作成（game 列を含める）
-- ---------------------------------------------------------------------
drop view if exists public.current_streams;
create view public.current_streams as
  select s.*
  from public.stream_snapshots s
  join public.latest_capture_by_platform lc
    on lc.platform = s.platform
   and lc.captured_at = s.captured_at
  order by s.viewers desc nulls last;
grant select on public.current_streams to anon, authenticated;

-- ---------------------------------------------------------------------
-- viewer_history: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.viewer_history(text, int, int, int);
create or replace function public.viewer_history(
  p_platform   text,
  p_hours      int default 24,
  p_bucket_min int default 20,
  p_top        int default 12,
  p_game       text default null
)
returns table (
  bucket       timestamptz,
  channel_name text,
  viewers      integer,
  is_portrait  boolean
)
language sql
stable
as $$
  with win as (
    select channel_id, channel_name, captured_at, viewers, orientation
    from public.stream_snapshots
    where platform = p_platform
      and (p_game is null or game = p_game)
      and captured_at >= now() - make_interval(hours => greatest(p_hours, 1))
  ),
  top as (
    select channel_id, max(coalesce(viewers, 0)) as peak
    from win
    group by channel_id
    order by peak desc
    limit greatest(p_top, 1)
  )
  select
    date_bin(
      make_interval(mins => greatest(p_bucket_min, 1)),
      w.captured_at,
      timestamptz 'epoch'
    ) as bucket,
    max(w.channel_name)                 as channel_name,
    max(w.viewers)::int                 as viewers,
    bool_or(w.orientation = 'portrait')  as is_portrait
  from win w
  join top t on t.channel_id = w.channel_id
  group by 1, w.channel_id
  order by 1;
$$;
grant execute on function public.viewer_history(text, int, int, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- viewer_total_series: + p_game
--   captures（0件収集も1行ある）を基準にする構造は維持。game で絞った結果
--   スナップショットが無い収集時点は 0 になる。
-- ---------------------------------------------------------------------
drop function if exists public.viewer_total_series(int, int, text);
create or replace function public.viewer_total_series(
  p_hours      int default 24,
  p_bucket_min int default 20,
  p_platform   text default null,
  p_game       text default null
)
returns table (t timestamptz, total integer)
language sql
stable
as $$
  with snap as (
    select platform, captured_at, sum(coalesce(viewers, 0))::int as total
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours + 1)
      and (p_game is null or game = p_game)
    group by platform, captured_at
  ),
  cap as (
    select c.platform, c.captured_at, coalesce(sn.total, 0) as total
    from public.captures c
    left join snap sn on sn.platform = c.platform and sn.captured_at = c.captured_at
    where c.captured_at >= now() - make_interval(hours => p_hours + 1)
  ),
  grid as (
    select generate_series(
      date_trunc('minute', now()) - make_interval(hours => p_hours),
      now(),
      make_interval(mins => greatest(p_bucket_min, 1))
    ) as t
  )
  select g.t,
    ( case when p_platform is null or p_platform = 'youtube'
        then coalesce((select cc.total from cap cc where cc.platform = 'youtube' and cc.captured_at <= g.t
                       order by cc.captured_at desc limit 1), 0) else 0 end
    + case when p_platform is null or p_platform = 'twitch'
        then coalesce((select cc.total from cap cc where cc.platform = 'twitch' and cc.captured_at <= g.t
                       order by cc.captured_at desc limit 1), 0) else 0 end
    )::int as total
  from grid g
  order by g.t;
$$;
grant execute on function public.viewer_total_series(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- stream_sessions: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.stream_sessions(int);
create or replace function public.stream_sessions(
  p_hours int default 24,
  p_game  text default null
)
returns table (
  platform       text,
  channel_name   text,
  session_start  timestamptz,
  session_end    timestamptz,
  peak           integer,
  avg_viewers    integer,
  points         integer
)
language sql
stable
as $$
  with s as (
    select platform, channel_name, captured_at, coalesce(viewers, 0) as v,
      case when captured_at - lag(captured_at) over (partition by platform, channel_name order by captured_at)
                > interval '40 minutes'
           or lag(captured_at) over (partition by platform, channel_name order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours)
      and (p_game is null or game = p_game)
      and channel_name is not null
  ),
  g as (
    select *, sum(newsess) over (partition by platform, channel_name order by captured_at) as sid
    from s
  )
  select platform, channel_name,
         min(captured_at) as session_start,
         max(captured_at) as session_end,
         max(v)::int      as peak,
         round(avg(v))::int as avg_viewers,
         count(*)::int    as points
  from g
  group by platform, channel_name, sid
  order by max(v) desc;
$$;
grant execute on function public.stream_sessions(int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- today_viewer_stats: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.today_viewer_stats();
create or replace function public.today_viewer_stats(
  p_game text default null
)
returns table (
  current_total  integer,
  previous_total integer,
  peak           integer,
  peak_at        timestamptz
)
language sql
stable
as $$
  with totals as (
    select s.platform,
           s.captured_at,
           sum(coalesce(s.viewers, 0))::int as total
    from public.stream_snapshots s
    where (s.captured_at at time zone 'Asia/Tokyo')::date
        = (now() at time zone 'Asia/Tokyo')::date
      and (p_game is null or s.game = p_game)
    group by s.platform, s.captured_at
  ),
  times as (
    select distinct captured_at from totals
  ),
  combined as (
    select t.captured_at,
           coalesce((select tt.total from totals tt
                     where tt.platform = 'youtube' and tt.captured_at <= t.captured_at
                     order by tt.captured_at desc limit 1), 0)
         + coalesce((select tt.total from totals tt
                     where tt.platform = 'twitch'  and tt.captured_at <= t.captured_at
                     order by tt.captured_at desc limit 1), 0) as combined
    from times t
  ),
  ranked as (
    select captured_at, combined,
           row_number() over (order by captured_at desc) as rn
    from combined
  )
  select
    (select combined from ranked where rn = 1)                                          as current_total,
    (select combined from ranked where rn = 2)                                          as previous_total,
    (select max(combined) from combined)                                                as peak,
    (select captured_at from combined order by combined desc, captured_at asc limit 1)  as peak_at;
$$;
grant execute on function public.today_viewer_stats(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- analytics_headline: + p_game（span_days はデータ全体の蓄積日数のまま）
-- ---------------------------------------------------------------------
drop function if exists public.analytics_headline(int, text);
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
  times as (select distinct captured_at from per_pf),
  combined as (
    select t.captured_at,
      case when p_platform is null then
        coalesce((select pp.total from per_pf pp
                  where pp.platform = 'youtube' and pp.captured_at <= t.captured_at
                  order by pp.captured_at desc limit 1), 0)
      + coalesce((select pp.total from per_pf pp
                  where pp.platform = 'twitch'  and pp.captured_at <= t.captured_at
                  order by pp.captured_at desc limit 1), 0)
      else
        coalesce((select pp.total from per_pf pp
                  where pp.captured_at = t.captured_at limit 1), 0)
      end as total
    from times t
  )
  select
    (select max(total) from combined)::int                                             as peak_viewers,
    (select captured_at from combined order by total desc, captured_at asc limit 1)     as peak_at,
    (select count(*) from (
        select distinct stream_id, date_trunc('hour', captured_at) from snaps
        where stream_id is not null
     ) x)                                                                               as total_stream_hours,
    (select count(distinct channel_id) from snaps)                                      as active_channels,
    coalesce(ceil(extract(epoch from (
        now() - (select min(captured_at) from public.stream_snapshots)
     )) / 86400.0)::int, 0)                                                             as span_days;
$$;
grant execute on function public.analytics_headline(int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- top_streams: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.top_streams(int, int, text);
create or replace function public.top_streams(
  p_days     int  default 30,
  p_limit    int  default 6,
  p_platform text default null,
  p_game     text default null
)
returns table (
  stream_id    text,
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

-- ---------------------------------------------------------------------
-- daily_activity: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.daily_activity(int, text);
create or replace function public.daily_activity(
  p_days     int  default 30,
  p_platform text default null,
  p_game     text default null
)
returns table (
  day             date,
  unique_streams  bigint,
  avg_concurrent  double precision,
  peak_concurrent bigint,
  avg_viewers     double precision,
  peak_viewers    bigint
)
language sql stable as $$
  with rows as (
    select captured_at, stream_id, coalesce(viewers, 0) as viewers,
           (captured_at at time zone 'Asia/Tokyo')::date as d
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
  ),
  per_cap as (
    select d, captured_at, count(*) as c, sum(viewers) as v
    from rows group by d, captured_at
  )
  select p.d as day,
         (select count(distinct r.stream_id) from rows r where r.d = p.d) as unique_streams,
         round(avg(p.c), 1)  as avg_concurrent,
         max(p.c)            as peak_concurrent,
         round(avg(p.v), 1)  as avg_viewers,
         max(p.v)            as peak_viewers
  from per_cap p
  group by p.d
  order by p.d;
$$;
grant execute on function public.daily_activity(int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- hour_heatmap: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.hour_heatmap(int, text);
create or replace function public.hour_heatmap(
  p_days     int  default 30,
  p_platform text default null,
  p_game     text default null
)
returns table (dow int, hour int, avg_concurrent double precision)
language sql stable as $$
  select
    extract(dow  from (captured_at at time zone 'Asia/Tokyo'))::int as dow,
    extract(hour from (captured_at at time zone 'Asia/Tokyo'))::int as hour,
    round(count(*)::numeric / nullif(count(distinct captured_at), 0), 2) as avg_concurrent
  from public.stream_snapshots
  where captured_at >= now() - make_interval(days => greatest(p_days, 1))
    and (p_platform is null or platform = p_platform)
    and (p_game is null or game = p_game)
  group by 1, 2
  order by 1, 2;
$$;
grant execute on function public.hour_heatmap(int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- new_channels: + p_game（そのタイトルでの初観測が期間内のチャンネル）
-- ---------------------------------------------------------------------
drop function if exists public.new_channels(int, int);
create or replace function public.new_channels(
  p_days  int default 14,
  p_limit int default 50,
  p_game  text default null
)
returns table (
  channel_id   text,
  channel_name text,
  platform     text,
  first_seen   timestamptz,
  appearances  bigint
)
language sql stable as $$
  select channel_id,
         coalesce(max(channel_name), channel_id) as channel_name,
         max(platform)    as platform,
         min(captured_at) as first_seen,
         count(*)         as appearances
  from public.stream_snapshots
  where (p_game is null or game = p_game)
  group by channel_id
  having min(captured_at) >= now() - make_interval(days => greatest(p_days, 1))
  order by first_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.new_channels(int, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_leaderboard: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.channel_leaderboard(int, int, text);
create or replace function public.channel_leaderboard(
  p_days     int  default 30,
  p_limit    int  default 20,
  p_platform text default null,
  p_game     text default null
)
returns table (
  channel_name text,
  platform     text,
  stream_hours bigint,
  viewer_hours bigint,
  peak_viewers integer,
  avg_viewers  double precision,
  last_seen    timestamptz
)
language sql stable as $$
  with snaps as (
    select channel_id, channel_name, platform, captured_at,
           coalesce(viewers, 0) as viewers
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
  ),
  buckets as (
    select channel_id,
           date_trunc('hour', captured_at) as hb,
           avg(viewers)      as avg_v,
           max(viewers)      as peak_v,
           max(channel_name) as ch,
           max(platform)     as pf,
           max(captured_at)  as last_seen
    from snaps
    group by channel_id, date_trunc('hour', captured_at)
  )
  select coalesce(max(ch), channel_id)                    as channel_name,
         max(pf)                                          as platform,
         count(*)                                         as stream_hours,
         round(sum(avg_v))::bigint                        as viewer_hours,
         max(peak_v)::int                                 as peak_viewers,
         round(avg(avg_v)::numeric, 1)::double precision  as avg_viewers,
         max(last_seen)                                   as last_seen
  from buckets
  group by channel_id
  order by viewer_hours desc, stream_hours desc, last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_leaderboard(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_hour_profile: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.channel_hour_profile(int, int, text);
create or replace function public.channel_hour_profile(
  p_days     int  default 30,
  p_limit    int  default 10,
  p_platform text default null,
  p_game     text default null
)
returns table (
  channel_id   text,
  channel_name text,
  platform     text,
  hour         int,
  hours_count  bigint
)
language sql stable as $$
  with buckets as (
    select s.channel_id,
           max(s.channel_name) as ch,
           max(s.platform)     as pf,
           date_trunc('hour', s.captured_at) as hb
    from public.stream_snapshots s
    where s.captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or s.platform = p_platform)
      and (p_game is null or s.game = p_game)
    group by s.channel_id, date_trunc('hour', s.captured_at)
  ),
  top_ch as (
    select channel_id, max(ch) as ch, max(pf) as pf, count(*) as total
    from buckets
    group by channel_id
    order by total desc
    limit greatest(p_limit, 1)
  )
  select b.channel_id,
         coalesce(t.ch, b.channel_id)                             as channel_name,
         t.pf                                                     as platform,
         extract(hour from b.hb at time zone 'Asia/Tokyo')::int   as hour,
         count(*)                                                 as hours_count
  from buckets b
  join top_ch t using (channel_id)
  group by b.channel_id, t.ch, t.pf, t.total,
           extract(hour from b.hb at time zone 'Asia/Tokyo')
  order by t.total desc, b.channel_id, hour;
$$;
grant execute on function public.channel_hour_profile(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_appearances（admin用）: + p_game
-- ---------------------------------------------------------------------
drop function if exists public.channel_appearances(int, int, text);
create or replace function public.channel_appearances(
  p_limit    int  default 30,
  p_days     int  default 90,
  p_platform text default null,
  p_game     text default null
)
returns table (
  channel_name text,
  platform     text,
  appearances  bigint,
  last_seen     timestamptz
)
language sql
stable
as $$
  select coalesce(max(channel_name), channel_id)         as channel_name,
         max(platform)                                   as platform,
         count(distinct date_trunc('hour', captured_at)) as appearances,
         max(captured_at)                                as last_seen
  from public.stream_snapshots
  where captured_at >= now() - make_interval(days => greatest(p_days, 1))
    and (p_platform is null or platform = p_platform)
    and (p_game is null or game = p_game)
  group by channel_id
  order by appearances desc, last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_appearances(int, int, text, text) to anon, authenticated;
