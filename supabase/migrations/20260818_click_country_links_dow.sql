-- =====================================================================
-- 2026-08-18 管理画面・分析ページ強化
--   1) events.country 追加（クリック/PVの国コード。Vercelの x-vercel-ip-country
--      ヘッダー由来の2文字コードのみ保存。IPそのものは保存しない）
--   2) top_clicked に国別内訳(countries jsonb)を追加（戻り値変更のため drop→create）
--   3) click_countries: クリックの国別合計（管理画面のサマリ用）
--   4) channel_leaderboard に channel_id を追加（チャンネルリンク生成用）
--   5) channel_dow_profile: 配信者×曜日(JST)の配信時間（時間帯マップの曜日表示用）
-- =====================================================================

alter table public.events
  add column if not exists country text;

-- ---------------------------------------------------------------------
-- top_clicked: + countries（国コード→クリック数のjsonb。国不明は '??'）
-- ---------------------------------------------------------------------
drop function if exists public.top_clicked(int, int);
create or replace function public.top_clicked(
  p_days int default 30, p_limit int default 20
)
returns table (channel_name text, platform text, clicks bigint, countries jsonb)
language sql stable as $$
  with c as (
    select channel_id, channel_name, platform, country
    from public.events
    where type = 'click'
      and created_at >= now() - make_interval(days => greatest(p_days, 1))
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

-- ---------------------------------------------------------------------
-- click_countries: クリックの国別合計（国不明は '??'）
-- ---------------------------------------------------------------------
create or replace function public.click_countries(p_days int default 30)
returns table (country text, clicks bigint)
language sql stable as $$
  select coalesce(country, '??') as country, count(*) as clicks
  from public.events
  where type = 'click'
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by 1 order by clicks desc;
$$;

-- ---------------------------------------------------------------------
-- channel_leaderboard: + channel_id（YouTube=UC…/Twitch=login。リンク生成に使う）
-- ---------------------------------------------------------------------
drop function if exists public.channel_leaderboard(int, int, text, text);
create or replace function public.channel_leaderboard(
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
  last_seen    timestamptz
)
language sql stable as $$
  with snaps as (
    select channel_id, channel_name, platform, captured_at,
           coalesce(viewers, 0) as viewers
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
  ),
  buckets as (
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
  select channel_id,
         coalesce(max(ch), channel_id)                    as channel_name,
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
grant execute on function public.channel_leaderboard(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_dow_profile: 配信者×曜日(JST・0=日)の配信時間h。
-- 対象チャンネルの選び方は channel_hour_profile と同一（配信時間h上位）。
-- ---------------------------------------------------------------------
create or replace function public.channel_dow_profile(
  p_days     int  default 30,
  p_limit    int  default 10,
  p_platform text default null,
  p_game     text default null
)
returns table (
  channel_id  text,
  dow         int,
  hours_count bigint
)
language sql stable as $$
  with buckets as (
    select s.channel_id,
           date_trunc('hour', s.captured_at) as hb
    from public.stream_snapshots s
    where s.captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or s.platform = p_platform)
      and (p_game is null or s.game = p_game)
    group by s.channel_id, date_trunc('hour', s.captured_at)
  ),
  top_ch as (
    select channel_id, count(*) as total
    from buckets
    group by channel_id
    order by total desc
    limit greatest(p_limit, 1)
  )
  select b.channel_id,
         extract(dow from b.hb at time zone 'Asia/Tokyo')::int as dow,
         count(*) as hours_count
  from buckets b
  join top_ch t using (channel_id)
  group by b.channel_id, extract(dow from b.hb at time zone 'Asia/Tokyo')
  order by b.channel_id, dow;
$$;
grant execute on function public.channel_dow_profile(int, int, text, text) to anon, authenticated;
