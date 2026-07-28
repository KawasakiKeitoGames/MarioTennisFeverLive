-- =====================================================================
-- 公開ページ用の分析RPC（追加APIコストゼロ・既存 stream_snapshots/captures のみ）
--   すべて DB 側で集計してから返し、返却行数を固定して Egress を抑える。
--   anon から supabase.rpc(...) で呼ぶ（SECURITY INVOKER=RLS適用・公開readのみ）。
-- 冪等: OR REPLACE。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) コミュニティの盛り上がり（日別）: 平均/ピーク同時配信数・ユニーク配信数。
--    p_platform が null なら両PF合算。
-- ---------------------------------------------------------------------
create or replace function public.daily_activity(
  p_days     int  default 30,
  p_platform text default null
)
returns table (
  day             date,
  unique_streams  bigint,
  avg_concurrent  double precision,
  peak_concurrent bigint
)
language sql stable as $$
  with rows as (
    select captured_at, stream_id,
           (captured_at at time zone 'Asia/Tokyo')::date as d
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
  ),
  per_cap as (
    select d, captured_at, count(*) as c
    from rows group by d, captured_at
  )
  select p.d as day,
         (select count(distinct r.stream_id) from rows r where r.d = p.d) as unique_streams,
         round(avg(p.c), 1) as avg_concurrent,
         max(p.c)           as peak_concurrent
  from per_cap p
  group by p.d
  order by p.d;
$$;

-- ---------------------------------------------------------------------
-- 2) 配信の時間帯ヒートマップ: JSTの曜日(0=日)×時間(0-23)ごとの平均同時配信数。
--    平均 = その枠のスナップショット総数 / その枠に入った収集回数。
-- ---------------------------------------------------------------------
create or replace function public.hour_heatmap(
  p_days     int  default 30,
  p_platform text default null
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
  group by 1, 2
  order by 1, 2;
$$;

-- ---------------------------------------------------------------------
-- 3) 新規参入チャンネル: 初観測(min captured_at)が直近 p_days 以内のチャンネル。
-- ---------------------------------------------------------------------
create or replace function public.new_channels(
  p_days  int default 14,
  p_limit int default 50
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
  group by channel_id
  having min(captured_at) >= now() - make_interval(days => greatest(p_days, 1))
  order by first_seen desc
  limit greatest(p_limit, 1);
$$;

-- ---------------------------------------------------------------------
-- 4) タイトルのハッシュタグ傾向: 配信タイトルの #タグ を集計。
--    同一配信(stream_id)は1回だけ数える（毎収集での重複を除去）。
-- ---------------------------------------------------------------------
create or replace function public.title_hashtags(
  p_days     int  default 30,
  p_limit    int  default 30,
  p_platform text default null
)
returns table (tag text, uses bigint)
language sql stable as $$
  with streams as (
    select distinct on (stream_id) stream_id, title
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
    order by stream_id, captured_at desc
  )
  select lower(m[1]) as tag, count(*) as uses
  from streams s,
       regexp_matches(
         coalesce(s.title, ''),
         '[#＃][^\s　#＃、，,。.!！?？【】「」『』（）()〈〉《》・／/＆&｜|：:；;〜~＠@]+',
         'g'
       ) as m
  group by 1
  order by uses desc, tag
  limit greatest(p_limit, 1);
$$;
