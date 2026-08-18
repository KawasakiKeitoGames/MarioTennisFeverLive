-- =====================================================================
-- 配信者詳細ページ（/streamers/{platform}/{channel_id}）の閲覧ランキング。
-- 管理画面「アクセス解析」用。path からPF/チャンネルIDを取り出し、
-- 最新スナップショットのチャンネル名を付けて閲覧数順に返す。
-- =====================================================================
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
      and created_at >= now() - make_interval(days => greatest(p_days, 1))
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
