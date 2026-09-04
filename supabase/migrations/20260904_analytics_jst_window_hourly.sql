-- =====================================================================
-- 2026-09-04 アクセス解析：期間の基準をJSTの「日」に統一＋時間別推移を追加
--   1) analytics_since(p_days): 期間の開始時刻。JSTの0時基準で
--      p_days=1 → 今日(JST 0:00〜)、7 → 今日を含む7日間。
--      これまでは now()-N日（＝直近N×24時間）だったため「今日」に昨日が混ざっていた。
--   2) 解析RPCの期間条件をすべて analytics_since に差し替え（戻り値・引数は不変）
--   3) events_hourly: JSTの時間別カウント（今日の推移グラフ用）
-- =====================================================================

create or replace function public.analytics_since(p_days int default 30)
returns timestamptz
language sql stable as $$
  select (
    date_trunc('day', (now() at time zone 'Asia/Tokyo'))
      - make_interval(days => greatest(p_days, 1) - 1)
  ) at time zone 'Asia/Tokyo';
$$;

-- ---------------------------------------------------------------------
-- 時間別カウント（0〜23時／JST）。今日の推移グラフ用。
-- ---------------------------------------------------------------------
create or replace function public.events_hourly(
  p_days int default 1,
  p_type text default 'view'
)
returns table (hour int, count bigint)
language sql stable as $$
  select extract(hour from (e.created_at at time zone 'Asia/Tokyo'))::int as hour,
         count(*) as count
  from public.events e
  where e.type = p_type
    and e.created_at >= public.analytics_since(p_days)
  group by 1 order by 1;
$$;

-- ---------------------------------------------------------------------
-- 以下、期間条件のみ analytics_since に差し替え（本体のロジックは既存のまま）
-- ---------------------------------------------------------------------
create or replace function public.events_daily(
  p_days int default 30,
  p_type text default 'view'
)
returns table (day date, count bigint)
language sql stable as $$
  select (e.created_at at time zone 'Asia/Tokyo')::date as day, count(*) as count
  from public.events e
  where e.type = p_type
    and e.created_at >= public.analytics_since(p_days)
  group by 1 order by 1;
$$;

create or replace function public.analytics_summary(p_days int default 30)
returns table (views bigint, clicks bigint, uniques bigint)
language sql stable as $$
  select
    count(*) filter (where type = 'view')                       as views,
    count(*) filter (where type = 'click')                      as clicks,
    count(distinct visitor) filter (where visitor is not null)  as uniques
  from public.events
  where created_at >= public.analytics_since(p_days);
$$;

create or replace function public.top_clicked(
  p_days int default 30, p_limit int default 20
)
returns table (channel_name text, platform text, clicks bigint, countries jsonb)
language sql stable as $$
  with c as (
    select channel_id, channel_name, platform, country
    from public.events
    where type = 'click'
      and created_at >= public.analytics_since(p_days)
  ),
  by_ch as (
    select channel_id,
           coalesce(max(channel_name), channel_id) as channel_name,
           max(platform) as platform,
           count(*) as clicks
    from c group by channel_id
  ),
  by_cc as (
    select channel_id, coalesce(country, '??') as country, count(*) as cnt
    from c group by channel_id, coalesce(country, '??')
  )
  select b.channel_name, b.platform, b.clicks,
         (select jsonb_object_agg(bc.country, bc.cnt)
            from by_cc bc where bc.channel_id = b.channel_id) as countries
  from by_ch b
  order by b.clicks desc
  limit greatest(p_limit, 1);
$$;

create or replace function public.click_countries(p_days int default 30)
returns table (country text, clicks bigint)
language sql stable as $$
  select coalesce(country, '??') as country, count(*) as clicks
  from public.events
  where type = 'click'
    and created_at >= public.analytics_since(p_days)
  group by 1 order by clicks desc;
$$;

create or replace function public.path_views(p_days int default 30)
returns table (path text, count bigint)
language sql stable as $$
  select
    case when path like '/streamers/%' then '/streamers/*'
         else coalesce(path, '(不明)') end as path,
    count(*) as count
  from public.events
  where type = 'view'
    and created_at >= public.analytics_since(p_days)
  group by 1 order by count desc;
$$;

create or replace function public.clicks_by_path(p_days int default 30)
returns table (path text, clicks bigint, kinds jsonb)
language sql stable as $$
  with c as (
    select
      case when path like '/streamers/%' then '/streamers/*'
           else coalesce(path, '(不明)') end as path,
      coalesce(kind, 'stream') as kind
    from public.events
    where type = 'click'
      and created_at >= public.analytics_since(p_days)
  ),
  by_pk as (
    select path, kind, count(*) as cnt from c group by path, kind
  )
  select path, sum(cnt)::bigint as clicks, jsonb_object_agg(kind, cnt) as kinds
  from by_pk
  group by path
  order by clicks desc;
$$;

create or replace function public.top_referrers(p_days int default 30, p_limit int default 15)
returns table (referrer_host text, count bigint)
language sql stable as $$
  select coalesce(referrer_host, '(直接/なし)') as referrer_host, count(*) as count
  from public.events
  where type = 'view'
    and created_at >= public.analytics_since(p_days)
  group by 1 order by count desc limit greatest(p_limit, 1);
$$;

create or replace function public.streamer_page_views(
  p_days  int default 30,
  p_limit int default 20
)
returns table (
  platform     text,
  channel_id   text,
  channel_name text,
  views        bigint,
  uniques      bigint
)
language sql stable as $$
  with agg as (
    select
      split_part(path, '/', 3) as platform,
      split_part(path, '/', 4) as channel_id,
      count(*) as views,
      count(distinct nullif(visitor, '')) as uniques
    from public.events
    where type = 'view'
      and path like '/streamers/%/%'
      and created_at >= public.analytics_since(p_days)
    group by 1, 2
    having split_part(path, '/', 4) <> ''
    order by views desc, uniques desc
    limit greatest(p_limit, 1)
  )
  select a.platform, a.channel_id,
         coalesce(n.channel_name, a.channel_id) as channel_name,
         a.views, a.uniques
  from agg a
  left join lateral (
    select s.channel_name
    from public.stream_snapshots s
    where s.platform = a.platform
      and s.channel_id = a.channel_id
      and s.channel_name is not null
    order by s.captured_at desc
    limit 1
  ) n on true
  order by a.views desc, a.uniques desc;
$$;

notify pgrst, 'reload schema';
