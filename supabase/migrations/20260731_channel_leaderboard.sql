-- =====================================================================
-- 配信者ランキングを「盛り上がり総量（視聴者×時間）」で並べるRPC。
--   従来の channel_appearances（配信時間hのみ・admin用に残置）を、公開分析では
--   視聴の“面積”＝ viewer_hours 主体のランキングに置き換える。
--
--   viewer_hours : 各1時間バケットの平均同時視聴を足し上げた延べ視聴時間。
--                  1バケット=約1時間なので Σ(bucket平均視聴) ≒ 同時視聴曲線の面積。
--                  1回でも観測されたバケットは avg で正規化されるため、YouTube/Twitch の
--                  収集頻度差に依存しない（[[fever-live-fair-appearances]] と同じ公平化思想）。
--   stream_hours : 観測された1時間バケット数（≒配信時間h）。
--   peak_viewers : 期間内の最高同時視聴。
-- 冪等: OR REPLACE。
-- =====================================================================
create or replace function public.channel_leaderboard(
  p_days     int  default 30,
  p_limit    int  default 20,
  p_platform text default null
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
  ),
  buckets as (  -- 配信 × 1時間バケットに正規化
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

grant execute on function public.channel_leaderboard(int, int, text) to anon, authenticated;
