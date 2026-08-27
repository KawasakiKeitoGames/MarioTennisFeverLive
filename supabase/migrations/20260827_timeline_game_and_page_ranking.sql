-- =====================================================================
-- 2026-08-27 公開ページ拡張
--   1) stream_sessions : channel_id / game を返す
--        → 推移のタイムラインでチャンネル名を配信者詳細ページへリンクし、
--          帯の色をゲームタイトル別にするため。セッション分割の単位も
--          channel_name → (channel_id, game) に変更（同一chが別タイトルへ
--          切り替えた場合は別の帯として描く）。
--   2) top_streams    : thumbnail_url を返す（配信ハイライトのアイコン表示）
--   3) streamer_page_ranking : 配信者ページ（/streamers/{pf}/{id}）の閲覧
--        ランキングを公開ページ向けに返す。events は非公開テーブルなので
--        security definer で集計結果だけを露出する（生ログは出さない）。
--        管理画面用の streamer_page_views はそのまま据え置き。
--
-- ※ 1) 2) は戻り値の変更を伴うため create or replace 不可 → drop → create。
--    適用後は NOTIFY pgrst, 'reload schema'; が必要。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) stream_sessions: + channel_id / game
-- ---------------------------------------------------------------------
drop function if exists public.stream_sessions(int, text);
create function public.stream_sessions(
  p_hours int default 24,
  p_game  text default null
)
returns table (
  platform       text,
  channel_id     text,
  channel_name   text,
  game           text,
  session_start  timestamptz,
  session_end    timestamptz,
  peak           integer,
  avg_viewers    integer,
  points         integer
)
language sql
stable
as $$
  with s as (
    select platform, channel_id, channel_name, game, captured_at, coalesce(viewers, 0) as v,
      case when captured_at - lag(captured_at) over (partition by platform, channel_id, game order by captured_at)
                > interval '40 minutes'
           or lag(captured_at) over (partition by platform, channel_id, game order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours)
      and (p_game is null or game = p_game)
      and channel_name is not null
  ),
  g as (
    select *, sum(newsess) over (partition by platform, channel_id, game order by captured_at) as sid
    from s
  )
  select platform, channel_id,
         max(channel_name)  as channel_name,
         game,
         min(captured_at)   as session_start,
         max(captured_at)   as session_end,
         max(v)::int        as peak,
         round(avg(v))::int as avg_viewers,
         count(*)::int      as points
  from g
  group by platform, channel_id, game, sid
  order by max(v) desc;
$$;
grant execute on function public.stream_sessions(int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) top_streams: + thumbnail_url（チャンネルアイコン）
-- ---------------------------------------------------------------------
drop function if exists public.top_streams(int, int, text, text);
create function public.top_streams(
  p_days     int  default 30,
  p_limit    int  default 6,
  p_platform text default null,
  p_game     text default null
)
returns table (
  stream_id     text,
  channel_id    text,
  channel_name  text,
  platform      text,
  peak_viewers  integer,
  avg_viewers   double precision,
  hours         bigint,
  started_at    timestamptz,
  title         text,
  url           text,
  thumbnail_url text
)
language sql stable as $$
  with snaps as (
    select *
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
      and (p_platform is null or platform = p_platform)
      and (p_game is null or game = p_game)
      and stream_id is not null
  ),
  agg as (
    select
      stream_id,
      max(channel_id)                                               as channel_id,
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
    limit greatest(p_limit, 1)
  )
  select a.stream_id, a.channel_id, a.channel_name, a.platform, a.peak_viewers,
         a.avg_viewers, a.hours, a.started_at, a.title, a.url, c.thumbnail_url
  from agg a
  left join public.channels c on c.channel_id = a.channel_id
  order by a.peak_viewers desc, a.hours desc, a.started_at desc;
$$;
grant execute on function public.top_streams(int, int, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) streamer_page_ranking: 配信者ページの閲覧ランキング（公開用）
--    ・events は anon から読めないため security definer（集計値のみ返す）
--    ・順位は「見た人数(uniques)」→「閲覧数(views)」の順で決める
--      （同じ人の再読込で順位が動かないようにするため）
--    ・観測実績のあるチャンネルだけを返す（存在しないパスの混入を除く）
-- ---------------------------------------------------------------------
create or replace function public.streamer_page_ranking(
  p_days     int  default 30,
  p_limit    int  default 10,
  p_platform text default null
)
returns table (
  platform      text,
  channel_id    text,
  channel_name  text,
  views         bigint,
  uniques       bigint,
  thumbnail_url text
)
language sql
stable
security definer
set search_path = public
as $$
  with agg as (
    select
      split_part(e.path, '/', 3) as platform,
      split_part(e.path, '/', 4) as channel_id,
      count(*)                                as views,
      count(distinct nullif(e.visitor, ''))   as uniques
    from public.events e
    where e.type = 'view'
      and e.path like '/streamers/%/%'
      and e.created_at >= now() - make_interval(days => greatest(p_days, 1))
    group by 1, 2
    having split_part(e.path, '/', 4) <> ''
  )
  select a.platform, a.channel_id, n.channel_name, a.views, a.uniques, c.thumbnail_url
  from agg a
  join lateral (
    select s.channel_name
    from public.stream_snapshots s
    where s.platform = a.platform
      and s.channel_id = a.channel_id
      and s.channel_name is not null
    order by s.captured_at desc
    limit 1
  ) n on true
  left join public.channels c on c.channel_id = a.channel_id
  where p_platform is null or a.platform = p_platform
  order by a.uniques desc, a.views desc, n.channel_name
  limit greatest(p_limit, 1);
$$;
grant execute on function public.streamer_page_ranking(int, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
