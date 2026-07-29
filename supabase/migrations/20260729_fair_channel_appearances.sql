-- よく配信しているch ランキングの PF公平化
--
-- 課題: 旧 channel_appearances は stream_snapshots の生の行数を count(*) していた。
--       収集間隔は YouTube=6〜30分 / Twitch=2分（[[fever-live-project]]）と差があるため、
--       同じ配信時間でも Twitch の方が数倍多くの行を生み、登場回数が水増しされていた。
--
-- 対策: 生の行数ではなく「配信が観測された1時間バケットの数」を数える。
--       count(distinct date_trunc('hour', captured_at)) は、その時間帯に最低1回でも
--       観測されれば1とカウントする。YouTube の最粗間隔(30分)でも継続配信中は各1時間内で
--       必ず1回は捕捉されるため、収集頻度に依存しない = PF公平な「配信時間(概算・時間)」になる。
--       ついでに従来無視されていた期間(p_days)・PF(p_platform)フィルタも効くようにする。

-- 旧シグネチャ（引数構成が変わるため create or replace では置換できない）を掃除
drop function if exists public.channel_appearances(int);
drop function if exists public.channel_appearances(int, int, text);

create or replace function public.channel_appearances(
  p_limit    int  default 30,
  p_days     int  default 90,
  p_platform text default null
)
returns table (
  channel_name text,
  platform     text,
  appearances  bigint,   -- 実体は「観測された1時間バケット数」≒ 配信していた時間数
  last_seen    timestamptz
)
language sql
stable
as $$
  select coalesce(max(channel_name), channel_id)             as channel_name,
         max(platform)                                       as platform,
         count(distinct date_trunc('hour', captured_at))     as appearances,
         max(captured_at)                                    as last_seen
  from public.stream_snapshots
  where captured_at >= now() - make_interval(days => greatest(p_days, 1))
    and (p_platform is null or platform = p_platform)
  group by channel_id
  order by appearances desc, last_seen desc
  limit greatest(p_limit, 1);
$$;
