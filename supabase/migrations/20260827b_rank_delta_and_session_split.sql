-- =====================================================================
-- 2026-08-27 (2) 順位変動の追加＋タイムラインのセッション分割見直し
--   1) stream_sessions : 分割条件を「配信ID(stream_id)が変わったら別セッション」主体に変更。
--        YouTubeは日中の収集間隔が最大60分あり、40分ギャップ固定だと
--        1本の配信が毎回バラバラの点になっていた（帯が潰れて数字が重なる）。
--        同じ動画ID = 1本の配信なので、IDが同じなら間隔が空いても繋ぐ。
--        Twitch（2分間隔）とID未取得の古い行は従来どおり40分ギャップで分割。
--   2) channel_leaderboard / channel_growth / streamer_page_ranking:
--        rank（今期の順位）と prev_rank（直前の同じ長さの期間での順位）を追加。
--        画面で ▲▼ の順位変動を出すため。前期間にデータが無ければ prev_rank は null
--        （フロント側は「全行がnull＝比較不能」とみなして変動表示ごと隠す）。
--        同値は同順位（rank）にして、並びのゆらぎで順位が動いて見えないようにする。
--
-- ※ 戻り値の変更を伴うため drop → create（create or replace 不可）。
--    適用後は NOTIFY pgrst, 'reload schema'; が必要。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) stream_sessions: stream_id ベースのセッション分割
-- ---------------------------------------------------------------------
drop function if exists public.stream_sessions(int, text);
create function public.stream_sessions(
  p_hours int default 24,
  p_game  text default null
)
returns table (
  platform       text,
  channel_id     text,
  channel_name   text,
  game           text,
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
    select platform, channel_id, channel_name, game, stream_id, captured_at,
           coalesce(viewers, 0) as v,
           lag(captured_at) over w as prev_at,
           lag(stream_id)   over w as prev_sid
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours)
      and (p_game is null or game = p_game)
      and channel_name is not null
    window w as (partition by platform, channel_id, game order by captured_at)
  ),
  f as (
    select s.*,
      case
        when prev_at is null then 1
        -- 配信IDが変わったら別の配信（YouTube=動画ID / Twitch=配信ID）
        when stream_id is not null and prev_sid is not null and stream_id <> prev_sid then 1
        -- IDで判定できない場合だけ従来のギャップ分割にフォールバック。
        -- Twitchは2分間隔で収集しているので40分の空白＝実際に配信していない。
        when captured_at - prev_at > interval '40 minutes'
             and (platform = 'twitch' or stream_id is null or prev_sid is null) then 1
        else 0
      end as newsess
    from s
  ),
  g as (
    select f.*, sum(newsess) over (partition by platform, channel_id, game order by captured_at) as sid
    from f
  )
  select platform, channel_id,
         max(channel_name)  as channel_name,
         game,
         min(captured_at)   as session_start,
         max(captured_at)   as session_end,
         max(v)::int        as peak,
         round(avg(v))::int as avg_viewers,
         count(*)::int      as points
  from g
  group by platform, channel_id, game, sid
  order by max(v) desc;
$$;
grant execute on function public.stream_sessions(int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2a) channel_leaderboard: + rank / prev_rank
--     prev_rank は「直前の同じ長さの期間」での順位（上位N件に限らず全chで採番）。
-- ---------------------------------------------------------------------
drop function if exists public.channel_leaderboard(int, int, text, text);
create function public.channel_leaderboard(
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
  with snaps as (
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
    select a.*,
           rank() over (order by viewer_hours desc, stream_hours desc)::int as rnk
    from agg a where is_cur
  ),
  prev as (
    select channel_id,
           rank() over (order by viewer_hours desc, stream_hours desc)::int as rnk
    from agg where not is_cur
  )
  select c.channel_id, c.channel_name, c.platform, c.stream_hours, c.viewer_hours,
         c.peak_viewers, c.avg_viewers, c.last_seen, c.rnk, p.rnk
  from cur c
  left join prev p on p.channel_id = c.channel_id
  order by c.viewer_hours desc, c.stream_hours desc, c.last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_leaderboard(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2b) channel_growth: + rank / prev_rank（増加数の順位）
-- ---------------------------------------------------------------------
drop function if exists public.channel_growth(int, int);
create function public.channel_growth(
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
  with base as (
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
         p.rnk
  from cur c
  left join public.channels ch on ch.channel_id = c.channel_id
  left join prev p on p.channel_id = c.channel_id
  order by c.delta desc nulls last
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_growth(int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2c) streamer_page_ranking: + rank / prev_rank（見た人数の順位）
-- ---------------------------------------------------------------------
drop function if exists public.streamer_page_ranking(int, int, text);
create function public.streamer_page_ranking(
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
  with ev as (
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
         c.rnk, p.rnk
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

notify pgrst, 'reload schema';
