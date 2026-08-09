-- =====================================================================
-- 配信者ごとの「時間帯傾向」を返すRPC（公開分析ページ用）。
--   どの配信者が JST のどの時間帯に配信していることが多いかを、
--   1時間バケットの観測数で返す（収集頻度に依存しない公平な回数）。
--   [[fever-live-fair-appearances]] と同じ公平化思想。
--   対象は期間内の配信時間が多い上位 p_limit チャンネルのみ。
-- 冪等: OR REPLACE。
-- =====================================================================
create or replace function public.channel_hour_profile(
  p_days     int  default 30,
  p_limit    int  default 10,
  p_platform text default null
)
returns table (
  channel_id   text,
  channel_name text,
  platform     text,
  hour         int,
  hours_count  bigint
)
language sql stable as $$
  with buckets as (  -- 配信 × 1時間バケットに正規化（収集頻度差をならす）
    select s.channel_id,
           max(s.channel_name) as ch,
           max(s.platform)     as pf,
           date_trunc('hour', s.captured_at) as hb
    from public.stream_snapshots s
    where s.captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or s.platform = p_platform)
    group by s.channel_id, date_trunc('hour', s.captured_at)
  ),
  top_ch as (  -- 配信時間（バケット数）上位のみ対象
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

grant execute on function public.channel_hour_profile(int, int, text) to anon, authenticated;
