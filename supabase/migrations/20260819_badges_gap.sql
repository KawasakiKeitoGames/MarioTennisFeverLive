-- =====================================================================
-- 2026-08-19 current_stream_badges のセッションギャップをPF別に
--   日中のYouTube収集が60分間隔になったため、40分固定ギャップだと
--   連続配信でも毎回「別セッション」扱いになり、経過時間(started_at)が
--   リセットされ、トレンド(prev_v)も取れなくなる。
--   → YouTubeは70分・その他はp_gap_min(40分)で判定（20260819_schedule_tuning.sqlと同方針）。
--   トレンドは「p_lookback_min(20分)以上前の最新スナップショット」比較のため、
--   セッションが繋がれば日中は前回収集(約60分前)との比較として機能する。
-- =====================================================================
create or replace function public.current_stream_badges(
  p_gap_min      int default 40,   -- この分数を超える検知の空白は「別セッション」（YouTubeは70分固定）
  p_lookback_min int default 20    -- 傾向判定でこの分だけ前の視聴者数と比較する
)
returns table (
  platform    text,
  channel_id  text,
  started_at  timestamptz,
  streak_days int,
  trend       text
)
language sql
stable
as $$
  with live as (
    select distinct cs.platform, cs.channel_id, cs.captured_at as now_at
    from public.current_streams cs
  ),
  hist as (
    select s.platform, s.channel_id, s.captured_at, s.viewers,
           lag(s.captured_at) over (
             partition by s.platform, s.channel_id order by s.captured_at
           ) as prev_at
    from public.stream_snapshots s
    join live l
      on l.platform = s.platform and l.channel_id = s.channel_id
    where s.captured_at >= now() - interval '30 days'
  ),
  sessioned as (
    select platform, channel_id, captured_at, viewers,
           sum(case
                 when prev_at is null
                   or captured_at - prev_at
                      > make_interval(mins => case when platform = 'youtube'
                                                   then greatest(p_gap_min, 70)
                                                   else p_gap_min end)
                 then 1 else 0 end)
             over (partition by platform, channel_id order by captured_at) as session_id
    from hist
  ),
  cur_sid as (
    select platform, channel_id, max(session_id) as sid
    from sessioned
    group by platform, channel_id
  ),
  cur_rows as (
    select se.*
    from sessioned se
    join cur_sid c
      on c.platform = se.platform and c.channel_id = se.channel_id and c.sid = se.session_id
  ),
  session_start as (
    select platform, channel_id, min(captured_at) as started_at
    from cur_rows
    group by platform, channel_id
  ),
  days as (
    select distinct platform, channel_id,
           (captured_at at time zone 'Asia/Tokyo')::date as d
    from hist
  ),
  ranked_days as (
    select platform, channel_id, d,
           max(d) over (partition by platform, channel_id) as max_d,
           row_number() over (partition by platform, channel_id order by d desc) - 1 as rn
    from days
  ),
  streak as (
    select platform, channel_id, count(*) as streak_days
    from ranked_days
    where (max_d - d) = rn
    group by platform, channel_id
  ),
  trend_src as (
    select l.platform, l.channel_id,
      (select cr.viewers from cur_rows cr
        where cr.platform = l.platform and cr.channel_id = l.channel_id
        order by cr.captured_at desc limit 1) as now_v,
      (select cr.viewers from cur_rows cr
        where cr.platform = l.platform and cr.channel_id = l.channel_id
          and cr.captured_at <= l.now_at - make_interval(mins => p_lookback_min)
        order by cr.captured_at desc limit 1) as prev_v
    from live l
  )
  select
    l.platform,
    l.channel_id,
    ss.started_at,
    coalesce(st.streak_days, 1)::int as streak_days,
    case
      when t.prev_v is null or t.now_v is null then 'flat'
      when t.now_v - t.prev_v >= 3
           and (t.now_v - t.prev_v)::numeric / greatest(t.prev_v, 1) >= 0.05 then 'up'
      when t.prev_v - t.now_v >= 3
           and (t.prev_v - t.now_v)::numeric / greatest(t.prev_v, 1) >= 0.05 then 'down'
      else 'flat'
    end as trend
  from live l
  left join session_start ss on ss.platform = l.platform and ss.channel_id = l.channel_id
  left join streak st        on st.platform = l.platform and st.channel_id = l.channel_id
  left join trend_src t      on t.platform  = l.platform and t.channel_id  = l.channel_id;
$$;
