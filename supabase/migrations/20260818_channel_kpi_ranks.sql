-- =====================================================================
-- 2026-08-18 配信者詳細のKPI順位＋平均配信時間
--   channel_kpi_ranks: 期間内の全チャンネルを対象に、
--   配信時間 / 延べ視聴 / ピーク同時視聴 / 平均同時視聴 / 平均配信時間 の
--   各指標での順位（rank・同値同順位）と平均配信時間の実値を返す。
--   平均配信時間は観測スパン（セッションの最初〜最後の観測時刻）ベース。
--   単一観測のセッションはスパン0になるため 0.1h(6分) を下限とする
--   （YouTubeは収集間隔が6〜30分と粗く、短い配信は1回しか観測されないため）。
-- =====================================================================

create or replace function public.channel_kpi_ranks(
  p_channel_id text,
  p_days       int default 30
)
returns table (
  total_channels    bigint,
  stream_hours_rank bigint,
  viewer_hours_rank bigint,
  peak_rank         bigint,
  avg_viewers_rank  bigint,
  avg_session_hours double precision,
  avg_session_rank  bigint
)
language sql stable as $$
  with snaps as (
    select channel_id, captured_at, coalesce(viewers, 0) as v, stream_id
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  hb as (
    select channel_id, date_trunc('hour', captured_at) as hb,
           avg(v) as av, max(v) as pk
    from snaps group by 1, 2
  ),
  base as (
    select channel_id,
           count(*)        as stream_hours,
           round(sum(av))  as viewer_hours,
           max(pk)         as peak_v,
           avg(av)         as avg_v
    from hb group by channel_id
  ),
  sess_marks as (
    select channel_id, captured_at,
      case when captured_at - lag(captured_at) over w > interval '40 minutes'
           or stream_id is distinct from lag(stream_id) over w
           or lag(captured_at) over w is null
        then 1 else 0 end as newsess
    from snaps
    window w as (partition by channel_id order by captured_at)
  ),
  sess as (
    select channel_id, sid,
           greatest(extract(epoch from max(captured_at) - min(captured_at)) / 3600.0, 0.1) as dur_h
    from (
      select channel_id, captured_at,
             sum(newsess) over (partition by channel_id order by captured_at) as sid
      from sess_marks
    ) x
    group by channel_id, sid
  ),
  sess_avg as (
    select channel_id, avg(dur_h) as avg_session_h from sess group by channel_id
  ),
  ranked as (
    select b.channel_id,
           coalesce(sa.avg_session_h, 0) as avg_session_h,
           rank() over (order by b.stream_hours desc)                 as r_sh,
           rank() over (order by b.viewer_hours desc)                 as r_vh,
           rank() over (order by b.peak_v desc)                       as r_pk,
           rank() over (order by b.avg_v desc)                        as r_av,
           rank() over (order by coalesce(sa.avg_session_h, 0) desc)  as r_as,
           count(*) over () as total
    from base b
    left join sess_avg sa using (channel_id)
  )
  select total, r_sh, r_vh, r_pk, r_av,
         round(avg_session_h::numeric, 1)::double precision, r_as
  from ranked
  where channel_id = p_channel_id;
$$;
grant execute on function public.channel_kpi_ranks(text, int) to anon, authenticated;
