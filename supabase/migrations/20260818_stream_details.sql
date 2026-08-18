-- =====================================================================
-- 2026-08-18 配信の実測時間（アーカイブ情報）
--   - stream_details: 1日1回のエンリッチで取得する動画/VODの実測情報。
--     YouTube: videos.list(liveStreamingDetails) の actualStartTime/actualEndTime
--              （video_id = stream_snapshots.stream_id）
--     Twitch : Get Videos(type=archive) の created_at + duration
--              （video_id = VOD ID。セッションとは channel_id＋開始時刻の近さで突合）
--   - yt_streams_needing_details: 詳細未取得（または配信中で end 未確定）の
--     YouTube 動画IDを返す（エンリッチJobの取得対象）
--   - channel_recent_streams を再作成し、実測時間と Twitch VOD 直リンクを付与
-- =====================================================================

create table if not exists public.stream_details (
  platform         text not null check (platform in ('youtube','twitch')),
  video_id         text not null,
  channel_id       text,
  actual_start     timestamptz,
  actual_end       timestamptz,
  duration_seconds integer,
  title            text,
  fetched_at       timestamptz not null default now(),
  primary key (platform, video_id)
);
create index if not exists idx_sd_channel on public.stream_details (channel_id, actual_start desc);

alter table public.stream_details enable row level security;
drop policy if exists "public read stream_details" on public.stream_details;
create policy "public read stream_details" on public.stream_details
  for select to anon using (true);

-- ---------------------------------------------------------------------
-- 詳細未取得のYouTube動画ID（直近p_days・actual_end未確定は再取得対象）
-- ---------------------------------------------------------------------
create or replace function public.yt_streams_needing_details(p_days int default 7)
returns table (stream_id text, channel_id text)
language sql stable as $$
  select distinct s.stream_id, s.channel_id
  from public.stream_snapshots s
  left join public.stream_details d
    on d.platform = 'youtube' and d.video_id = s.stream_id
  where s.platform = 'youtube'
    and s.stream_id is not null
    and s.captured_at >= now() - make_interval(days => greatest(p_days, 1))
    and (d.video_id is null or d.actual_end is null);
$$;

-- ---------------------------------------------------------------------
-- channel_recent_streams: 実測時間・VOD直リンクを付与（戻り値変更のためdrop→create）
-- ---------------------------------------------------------------------
drop function if exists public.channel_recent_streams(text, text, int);
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
      case when captured_at - lag(captured_at) over (order by captured_at) > interval '40 minutes'
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
  select se.started_at, se.ended_at, se.peak_viewers, se.avg_viewers, se.hours,
         se.title, se.url, se.game,
         d.actual_start, d.actual_end, d.duration_seconds,
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
            and sd.actual_start is not null
            and sd.actual_start between se.started_at - interval '30 minutes'
                                    and se.started_at + interval '30 minutes')
      )
    order by abs(extract(epoch from (sd.actual_start - se.started_at))) asc
    limit 1
  ) d on true
  order by se.started_at desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_recent_streams(text, text, int) to anon, authenticated;
