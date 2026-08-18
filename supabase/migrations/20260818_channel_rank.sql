-- =====================================================================
-- 2026-08-18 配信者詳細ページの順位表示
--   channel_rank: 延べ視聴時間（/analyticsの配信者ランキングと同じ
--   1時間バケットavg合計・両PF/全タイトル合算）での順位と、直前の同じ長さの
--   期間での順位（上昇/下降の判定用）。前期間にデータが無ければ prev_rank=null。
-- =====================================================================

create or replace function public.channel_rank(
  p_channel_id text,
  p_days       int default 30
)
returns table (rank bigint, total_channels bigint, prev_rank bigint, prev_total bigint)
language sql stable as $$
  with cur_lb as (
    select channel_id,
           row_number() over (order by vh desc, sh desc) as rn,
           count(*) over () as total
    from (
      select channel_id, round(sum(av))::bigint as vh, count(*) as sh
      from (
        select channel_id, date_trunc('hour', captured_at) as hb,
               avg(coalesce(viewers, 0)) as av
        from public.stream_snapshots
        where captured_at >= now() - make_interval(days => greatest(p_days, 1))
        group by channel_id, date_trunc('hour', captured_at)
      ) b
      group by channel_id
    ) l
  ),
  prev_lb as (
    select channel_id,
           row_number() over (order by vh desc, sh desc) as rn,
           count(*) over () as total
    from (
      select channel_id, round(sum(av))::bigint as vh, count(*) as sh
      from (
        select channel_id, date_trunc('hour', captured_at) as hb,
               avg(coalesce(viewers, 0)) as av
        from public.stream_snapshots
        where captured_at >= now() - make_interval(days => 2 * greatest(p_days, 1))
          and captured_at <  now() - make_interval(days => greatest(p_days, 1))
        group by channel_id, date_trunc('hour', captured_at)
      ) b
      group by channel_id
    ) l
  )
  select
    (select rn from cur_lb where channel_id = p_channel_id)   as rank,
    (select max(total) from cur_lb)                            as total_channels,
    (select rn from prev_lb where channel_id = p_channel_id)  as prev_rank,
    (select max(total) from prev_lb)                           as prev_total;
$$;
grant execute on function public.channel_rank(text, int) to anon, authenticated;
