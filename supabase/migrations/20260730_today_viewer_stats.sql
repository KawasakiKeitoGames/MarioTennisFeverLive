-- =====================================================================
-- トップの「本日ピーク」と「前回比(▲▼)」を1行で返す軽量RPC。
--   - current_total : 最新収集時点の合算同時視聴（= 画面の総視聴者数と一致）
--   - previous_total: 1つ前の収集時点の合算同時視聴（前回比の分母）
--   - peak / peak_at: 本日(JST)の合算同時視聴のピークと、その時刻
-- YouTube と Twitch は収集間隔が違う（Twitchは短間隔）ため、各サンプル時点で
-- 「YouTubeの直近合算 + Twitchの直近合算」を as-of で足して同時視聴合算とする。
-- 返すのは常に1行なので egress はごく小さい。
-- =====================================================================
create or replace function public.today_viewer_stats()
returns table (
  current_total  integer,
  previous_total integer,
  peak           integer,
  peak_at        timestamptz
)
language sql
stable
as $$
  with totals as (
    -- 本日(JST)の、各収集時点 × PF の合算視聴者
    select s.platform,
           s.captured_at,
           sum(coalesce(s.viewers, 0))::int as total
    from public.stream_snapshots s
    where (s.captured_at at time zone 'Asia/Tokyo')::date
        = (now() at time zone 'Asia/Tokyo')::date
    group by s.platform, s.captured_at
  ),
  times as (
    select distinct captured_at from totals
  ),
  combined as (
    -- 各サンプル時点での「YouTube最新合算 + Twitch最新合算」= 同時視聴合算
    select t.captured_at,
           coalesce((select tt.total from totals tt
                     where tt.platform = 'youtube' and tt.captured_at <= t.captured_at
                     order by tt.captured_at desc limit 1), 0)
         + coalesce((select tt.total from totals tt
                     where tt.platform = 'twitch'  and tt.captured_at <= t.captured_at
                     order by tt.captured_at desc limit 1), 0) as combined
    from times t
  ),
  ranked as (
    select captured_at, combined,
           row_number() over (order by captured_at desc) as rn
    from combined
  )
  select
    (select combined from ranked where rn = 1)                                          as current_total,
    (select combined from ranked where rn = 2)                                          as previous_total,
    (select max(combined) from combined)                                                as peak,
    (select captured_at from combined order by combined desc, captured_at asc limit 1)  as peak_at;
$$;

grant execute on function public.today_viewer_stats() to anon, authenticated;
