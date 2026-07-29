-- =====================================================================
-- 配信の縦横（縦動画 / Shorts ライブ）判定を保存・提供する。
--   - stream_snapshots に orientation 列を追加（'portrait' | 'landscape' | NULL=未判定）
--   - YouTube は videos.list の player 埋め込み寸法から収集側で判定
--   - Twitch は常に 'landscape'
--   - 視聴者数推移RPC(viewer_history)に is_portrait を追加し、グラフ凡例で区別表示
-- Supabase の SQL Editor に貼り付けて実行してください（CLI未同期のため）。
-- =====================================================================

alter table public.stream_snapshots
  add column if not exists orientation text
  check (orientation in ('portrait', 'landscape'));

-- 返り値の列を増やすため、一旦DROPしてから作り直す（CREATE OR REPLACEでは列変更不可）
drop function if exists public.viewer_history(text, int, int, int);
create or replace function public.viewer_history(
  p_platform   text,
  p_hours      int default 24,
  p_bucket_min int default 20,
  p_top        int default 12
)
returns table (
  bucket       timestamptz,
  channel_name text,
  viewers      integer,
  is_portrait  boolean
)
language sql
stable
as $$
  with win as (
    select channel_id, channel_name, captured_at, viewers, orientation
    from public.stream_snapshots
    where platform = p_platform
      and captured_at >= now() - make_interval(hours => greatest(p_hours, 1))
  ),
  top as (
    select channel_id, max(coalesce(viewers, 0)) as peak
    from win
    group by channel_id
    order by peak desc
    limit greatest(p_top, 1)
  )
  select
    date_bin(
      make_interval(mins => greatest(p_bucket_min, 1)),
      w.captured_at,
      timestamptz 'epoch'
    ) as bucket,
    max(w.channel_name)                 as channel_name,
    max(w.viewers)::int                 as viewers,
    bool_or(w.orientation = 'portrait')  as is_portrait
  from win w
  join top t on t.channel_id = w.channel_id
  group by 1, w.channel_id
  order by 1;
$$;
