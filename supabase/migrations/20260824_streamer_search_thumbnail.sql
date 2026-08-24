-- =====================================================================
-- channel_search にアイコン画像(thumbnail_url)を追加
--   /streamers 一覧の先頭文字アイコンを実際のチャンネルアイコンに差し替えるため、
--   エンリッチ済みの public.channels を左外部結合して返す。
-- =====================================================================

create or replace function public.channel_search(
  p_q     text default null,
  p_limit int  default 20
)
returns table (
  channel_id    text,
  channel_name  text,
  platform      text,
  first_seen    timestamptz,
  last_seen     timestamptz,
  stream_hours  bigint,
  peak_viewers  integer,
  thumbnail_url text
)
language sql stable as $$
  with ch as (
    select channel_id,
           coalesce(max(channel_name), channel_id)          as channel_name,
           max(platform)                                    as platform,
           min(captured_at)                                 as first_seen,
           max(captured_at)                                 as last_seen,
           count(distinct date_trunc('hour', captured_at))  as stream_hours,
           max(coalesce(viewers, 0))::int                   as peak_viewers
    from public.stream_snapshots
    group by channel_id
  )
  select ch.*, c.thumbnail_url
  from ch
  left join public.channels c on c.channel_id = ch.channel_id
  where p_q is null or p_q = ''
     or ch.channel_name ilike '%' || p_q || '%'
     or ch.channel_id   ilike '%' || p_q || '%'
  order by ch.last_seen desc
  limit greatest(p_limit, 1);
$$;
grant execute on function public.channel_search(text, int) to anon, authenticated;
