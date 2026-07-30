-- =====================================================================
-- 推移ページ刷新用の2本のRPC。
--   1) viewer_total_series : 総同時視聴者数の推移（真の as-of 合算・実時間グリッド）
--   2) stream_sessions     : 配信タイムライン用の配信セッション（gaps-and-islands）
-- どちらも返却行数は数十〜数百で、egress は小さい。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 総同時視聴者数の推移。
--   グリッド各時点で「その時点以前の最新収集」の合算視聴者を採用（as-of）。
--   captures（0件収集も1行ある）を基準にするため、配信ゼロの時間帯は 0 になる
--   （snapshotだけを見て前値を持ち越す誤りを避ける）。
--   p_platform: null=YouTube+Twitch合算 / 'youtube' / 'twitch'
-- ---------------------------------------------------------------------
create or replace function public.viewer_total_series(
  p_hours      int default 24,
  p_bucket_min int default 20,
  p_platform   text default null
)
returns table (t timestamptz, total integer)
language sql
stable
as $$
  with snap as (
    -- 収集時点 × PF の合算視聴者
    select platform, captured_at, sum(coalesce(viewers, 0))::int as total
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours + 1)
    group by platform, captured_at
  ),
  cap as (
    -- 全収集（0件含む）に snapshot 合算を左結合（無ければ 0）
    select c.platform, c.captured_at, coalesce(sn.total, 0) as total
    from public.captures c
    left join snap sn on sn.platform = c.platform and sn.captured_at = c.captured_at
    where c.captured_at >= now() - make_interval(hours => p_hours + 1)
  ),
  grid as (
    select generate_series(
      date_trunc('minute', now()) - make_interval(hours => p_hours),
      now(),
      make_interval(mins => greatest(p_bucket_min, 1))
    ) as t
  )
  select g.t,
    ( case when p_platform is null or p_platform = 'youtube'
        then coalesce((select cc.total from cap cc where cc.platform = 'youtube' and cc.captured_at <= g.t
                       order by cc.captured_at desc limit 1), 0) else 0 end
    + case when p_platform is null or p_platform = 'twitch'
        then coalesce((select cc.total from cap cc where cc.platform = 'twitch' and cc.captured_at <= g.t
                       order by cc.captured_at desc limit 1), 0) else 0 end
    )::int as total
  from grid g
  order by g.t;
$$;

grant execute on function public.viewer_total_series(int, int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) 配信セッション（タイムライン用）。
--   同一 (platform, channel) の収集を時刻順に見て、40分超の空きで別セッションに分割
--   （YouTubeの最大収集間隔≒30分より大きく、連続配信を割らない閾値）。
-- ---------------------------------------------------------------------
create or replace function public.stream_sessions(p_hours int default 24)
returns table (
  platform       text,
  channel_name   text,
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
    select platform, channel_name, captured_at, coalesce(viewers, 0) as v,
      case when captured_at - lag(captured_at) over (partition by platform, channel_name order by captured_at)
                > interval '40 minutes'
           or lag(captured_at) over (partition by platform, channel_name order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours)
      and channel_name is not null
  ),
  g as (
    select *, sum(newsess) over (partition by platform, channel_name order by captured_at) as sid
    from s
  )
  select platform, channel_name,
         min(captured_at) as session_start,
         max(captured_at) as session_end,
         max(v)::int      as peak,
         round(avg(v))::int as avg_viewers,
         count(*)::int    as points
  from g
  group by platform, channel_name, sid
  order by max(v) desc;
$$;

grant execute on function public.stream_sessions(int) to anon, authenticated;
