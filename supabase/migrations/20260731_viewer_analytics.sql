-- =====================================================================
-- 分析ページを「配信数」中心から「視聴者 × 人」中心に振り直すための追加RPC。
--   - analytics_headline : 視聴者ベースのKPI（ピーク同時視聴・累計配信時間・
--                          アクティブch・データ蓄積日数）を1行で返す。
--   - top_streams        : 単発配信の記録（最高視聴の配信ハイライト）を返す。
--   - daily_activity     : 既存の日別集計に視聴者(avg/peak)列を追加（軸の統一）。
-- すべて既存の stream_snapshots のみから集計（追加の外部APIコストゼロ）。
-- 返却行数は固定 or 上限つきで Egress を抑える。冪等（OR REPLACE / DROP IF EXISTS）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ヘッドラインKPI（1行）
--    peak_viewers  : 期間内の「同時視聴者数」のピーク。
--                    p_platform=null のときは各サンプル時点で YouTube と Twitch の
--                    直近合算を as-of で足した“合算同時視聴”の最大（トップの定義と一致）。
--    total_stream_hours : 延べ配信時間の概算。配信×1時間バケットのユニーク数。
--    active_channels    : 期間内に観測されたユニークch数。
--    span_days          : データが存在する最古スナップショットから今までの日数（期間ボタン制御用・PF非依存）。
-- ---------------------------------------------------------------------
create or replace function public.analytics_headline(
  p_days     int  default 30,
  p_platform text default null
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
  ),
  per_pf as (  -- 各収集時点 × PF の合算視聴者
    select platform, captured_at, sum(coalesce(viewers, 0))::int as total
    from snaps group by platform, captured_at
  ),
  times as (select distinct captured_at from per_pf),
  combined as (  -- 各サンプル時点の“合算同時視聴”（as-of）
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

grant execute on function public.analytics_headline(int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) 配信ハイライト（記録）: 単発配信を最高同時視聴でランキング。
--    peak_viewers 降順。title は最も視聴されていた時点のもの、url は最新のもの。
-- ---------------------------------------------------------------------
create or replace function public.top_streams(
  p_days     int  default 30,
  p_limit    int  default 6,
  p_platform text default null
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

grant execute on function public.top_streams(int, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) daily_activity に視聴者(avg/peak)列を追加。
--    OUT列の追加は CREATE OR REPLACE ではできないため drop してから再作成。
--    既存の呼び出し（/api/insights, 名前付き引数）は列追加のみのため無影響。
-- ---------------------------------------------------------------------
drop function if exists public.daily_activity(int, text);
create or replace function public.daily_activity(
  p_days     int  default 30,
  p_platform text default null
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

grant execute on function public.daily_activity(int, text) to anon, authenticated;
