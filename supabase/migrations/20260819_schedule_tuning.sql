-- =====================================================================
-- 2026-08-19 収集スケジュール再配分（直近3週間の実測に基づく）
--   実測: ピークは21〜23時(平均3.7〜4.5配信)で20時台は1.2。深夜1〜4時は
--   0.7〜1.6と18〜19時(0.4〜0.6)より多い。日中(5〜12時/13〜18時)は0.26以下。
--   → ピーク5分・深夜20分に強化、日中60分・20時台10分・お昼15分に緩和。
--   合計 96回/日(約9,700u) → 90回/日(約9,100u)。
--
--   1) セッション分割のギャップ閾値をPF別に変更: YouTube 70分 / Twitch 40分
--      （日中のYouTube収集が60分間隔になり、40分では連続配信が細切れになるため。
--        Twitchは終日2分間隔のまま40分を維持。stream_idによる分割は従来どおり）
--      対象: channel_recent_streams / channel_kpi_ranks / stream_sessions
--   2) pg_cron ジョブ再配分（末尾のDOブロック。lib/schedule.ts と一致必須）
-- =====================================================================

-- ---------------------------------------------------------------------
-- channel_recent_streams: ギャップ閾値をPF別に（YouTube 70分/その他40分）
-- ---------------------------------------------------------------------
create or replace function public.channel_recent_streams(
  p_platform   text,
  p_channel_id text,
  p_limit      int default 10
)
returns table (
  started_at       timestamptz,
  ended_at         timestamptz,
  peak_viewers     integer,
  avg_viewers      integer,
  hours            bigint,
  title            text,
  url              text,
  game             text,
  actual_start     timestamptz,
  actual_end       timestamptz,
  duration_seconds integer,
  vod_url          text
)
language sql stable as $$
  with s as (
    select captured_at, coalesce(viewers, 0) as v, title, url, game, stream_id,
      case when captured_at - lag(captured_at) over (order by captured_at)
                > case when p_platform = 'youtube' then interval '70 minutes' else interval '40 minutes' end
           or stream_id is distinct from lag(stream_id) over (order by captured_at)
           or lag(captured_at) over (order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where platform = p_platform and channel_id = p_channel_id
  ),
  g as (
    select *, sum(newsess) over (order by captured_at) as sid from s
  ),
  sess as (
    select min(captured_at)                                 as started_at,
           max(captured_at)                                 as ended_at,
           max(v)::int                                      as peak_viewers,
           round(avg(v))::int                               as avg_viewers,
           count(distinct date_trunc('hour', captured_at))  as hours,
           (array_agg(title order by captured_at desc))[1]  as title,
           (array_agg(url order by captured_at desc))[1]    as url,
           max(game)                                        as game,
           max(stream_id)                                   as sess_stream_id
    from g
    group by sid
  )
  -- 実測時間で上書きするのは YouTube のみ（動画=配信単位のため）。
  -- Twitch の VOD は配信全体（複数カテゴリを含みうる）で、セッションはカテゴリ単位の
  -- 観測なので時間は観測スパンのまま（収集2分間隔で十分正確）。VODは
  -- 「セッション開始時刻を含むアーカイブ」への直リンクとしてのみ使う。
  select se.started_at, se.ended_at, se.peak_viewers, se.avg_viewers, se.hours,
         se.title, se.url, se.game,
         case when p_platform = 'youtube' then d.actual_start end     as actual_start,
         case when p_platform = 'youtube' then d.actual_end end       as actual_end,
         case when p_platform = 'youtube' then d.duration_seconds end as duration_seconds,
         case when p_platform = 'twitch' and d.video_id is not null
              then 'https://www.twitch.tv/videos/' || d.video_id
              else null end as vod_url
  from sess se
  left join lateral (
    select sd.*
    from public.stream_details sd
    where sd.platform = p_platform
      and (
        (p_platform = 'youtube' and sd.video_id = se.sess_stream_id)
        or (p_platform = 'twitch' and sd.channel_id = p_channel_id
            and sd.actual_start is not null and sd.actual_end is not null
            and se.started_at >= sd.actual_start - interval '5 minutes'
            and se.started_at <  sd.actual_end   + interval '5 minutes')
      )
    order by abs(extract(epoch from (sd.actual_start - se.started_at))) asc
    limit 1
  ) d on true
  order by se.started_at desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_recent_streams(text, text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- channel_kpi_ranks: 平均配信時間のセッション分割も同じPF別閾値に
-- ---------------------------------------------------------------------
create or replace function public.channel_kpi_ranks(
  p_channel_id text,
  p_days       int default 30
)
returns table (
  total_channels    bigint,
  stream_hours_rank bigint,
  viewer_hours_rank bigint,
  peak_rank         bigint,
  avg_viewers_rank  bigint,
  avg_session_hours double precision,
  avg_session_rank  bigint
)
language sql stable as $$
  with snaps as (
    select platform, channel_id, captured_at, coalesce(viewers, 0) as v, stream_id
    from public.stream_snapshots
    where captured_at >= now() - make_interval(days => greatest(p_days, 1))
  ),
  hb as (
    select channel_id, date_trunc('hour', captured_at) as hb,
           avg(v) as av, max(v) as pk
    from snaps group by 1, 2
  ),
  base as (
    select channel_id,
           count(*)        as stream_hours,
           round(sum(av))  as viewer_hours,
           max(pk)         as peak_v,
           avg(av)         as avg_v
    from hb group by channel_id
  ),
  sess_marks as (
    select channel_id, captured_at,
      case when captured_at - lag(captured_at) over w
                > case when platform = 'youtube' then interval '70 minutes' else interval '40 minutes' end
           or stream_id is distinct from lag(stream_id) over w
           or lag(captured_at) over w is null
        then 1 else 0 end as newsess
    from snaps
    window w as (partition by platform, channel_id order by captured_at)
  ),
  sess as (
    select channel_id, sid,
           greatest(extract(epoch from max(captured_at) - min(captured_at)) / 3600.0, 0.1) as dur_h
    from (
      select channel_id, captured_at,
             sum(newsess) over (partition by channel_id order by captured_at) as sid
      from sess_marks
    ) x
    group by channel_id, sid
  ),
  sess_avg as (
    select channel_id, avg(dur_h) as avg_session_h from sess group by channel_id
  ),
  ranked as (
    select b.channel_id,
           coalesce(sa.avg_session_h, 0) as avg_session_h,
           rank() over (order by b.stream_hours desc)                 as r_sh,
           rank() over (order by b.viewer_hours desc)                 as r_vh,
           rank() over (order by b.peak_v desc)                       as r_pk,
           rank() over (order by b.avg_v desc)                        as r_av,
           rank() over (order by coalesce(sa.avg_session_h, 0) desc)  as r_as,
           count(*) over () as total
    from base b
    left join sess_avg sa using (channel_id)
  )
  select total, r_sh, r_vh, r_pk, r_av,
         round(avg_session_h::numeric, 1)::double precision, r_as
  from ranked
  where channel_id = p_channel_id;
$$;
grant execute on function public.channel_kpi_ranks(text, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- stream_sessions（/history）: ギャップ閾値をPF別に
-- ---------------------------------------------------------------------
create or replace function public.stream_sessions(
  p_hours int default 24,
  p_game  text default null
)
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
                > case when platform = 'youtube' then interval '70 minutes' else interval '40 minutes' end
           or lag(captured_at) over (partition by platform, channel_name order by captured_at) is null
        then 1 else 0 end as newsess
    from public.stream_snapshots
    where captured_at >= now() - make_interval(hours => p_hours)
      and (p_game is null or game = p_game)
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
grant execute on function public.stream_sessions(int, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- pg_cron 再配分（UTC登録・JST運用）。既存ジョブのコマンド（URL+認証）を
-- そのまま流用して差し替える。lib/schedule.ts の YT_SCHEDULE と一致必須。
--   golden    */5 12-15  = JST 21:00〜翌0:55 5分  (48回)
--   evening   */10 11    = JST 20時台      10分  (6回)
--   prime     */15 9-10  = JST 18〜19時    15分  (8回・据え置き)
--   noon      */15 3     = JST 12時台      15分  (4回)
--   daytime   0 0-2,4-8,20-23 = JST 5〜11時・13〜17時 60分 (12回)
--   latenight */20 16-19 = JST 1:00〜4:40  20分  (12回)
--   合計 90回/日 ×101u ≒ 9,100u（上限10,000u）
-- ---------------------------------------------------------------------
do $$
declare cmd text;
begin
  select command into cmd from cron.job where jobname = 'mtf-collect-golden';
  if cmd is null then
    raise exception 'mtf-collect-golden が見つかりません（コマンド流用元）';
  end if;
  perform cron.schedule('mtf-collect-golden',    '*/5 12-15 * * *',      cmd);
  perform cron.schedule('mtf-collect-evening',   '*/10 11 * * *',        cmd);
  perform cron.schedule('mtf-collect-prime',     '*/15 9-10 * * *',      cmd);
  perform cron.schedule('mtf-collect-noon',      '*/15 3 * * *',         cmd);
  perform cron.schedule('mtf-collect-daytime',   '0 0-2,4-8,20-23 * * *', cmd);
  perform cron.schedule('mtf-collect-latenight', '*/20 16-19 * * *',     cmd);
end $$;
