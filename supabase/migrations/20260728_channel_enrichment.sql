-- =====================================================================
-- チャンネルのエンリッチ（登録者数の推移・開設日など）
--   - 収集Job(search)とは別に、1日1回だけ channels.list / Get Users を叩いて
--     監視チャンネルの属性を取得する。channels.list は id を最大50件まとめて
--     1ユニットなので、数百chでも日次で1桁ユニット＝実質ゼロコスト。
--   - static属性は channels に upsert、日次で変わる値は channel_stats_daily に
--     1日1行 append（= 登録者数の時系列）。
-- 冪等: 何度実行してもOK（IF NOT EXISTS / OR REPLACE）。
-- =====================================================================

-- チャンネルの静的〜低頻度属性（1ch=1行）
create table if not exists public.channels (
  channel_id       text primary key,          -- YouTube: channelId / Twitch: user_login
  platform         text not null check (platform in ('youtube','twitch')),
  title            text,
  description      text,
  published_at     timestamptz,               -- 開設日（YouTube snippet.publishedAt / Twitch created_at）
  country          text,                      -- YouTube のみ
  broadcaster_type text,                      -- Twitch のみ（partner/affiliate/''）
  thumbnail_url    text,
  first_seen       timestamptz,               -- このアプリが最初に観測した時刻
  last_enriched_at timestamptz                -- 最後にエンリッチした時刻
);
create index if not exists idx_channels_platform on public.channels (platform);

-- 日次で変わる数値の時系列（1ch × 1日 = 1行）
create table if not exists public.channel_stats_daily (
  id               bigint generated always as identity primary key,
  channel_id       text not null,
  platform         text not null check (platform in ('youtube','twitch')),
  day              date not null,             -- JST日付
  subscriber_count bigint,                    -- YouTube 登録者数（3桁丸め）。Twitchは取得不可でnull
  view_count       bigint,                    -- YouTube チャンネル総再生数
  video_count      bigint,                    -- YouTube 動画本数
  unique (channel_id, day)
);
create index if not exists idx_csd_channel on public.channel_stats_daily (channel_id, day);
create index if not exists idx_csd_day     on public.channel_stats_daily (day desc);

-- =====================================================================
-- RLS: 公開読み取りのみ。書き込みは service_role（エンリッチJob）のみ。
-- =====================================================================
alter table public.channels enable row level security;
drop policy if exists "public read channels" on public.channels;
create policy "public read channels" on public.channels for select to anon using (true);

alter table public.channel_stats_daily enable row level security;
drop policy if exists "public read csd" on public.channel_stats_daily;
create policy "public read csd" on public.channel_stats_daily for select to anon using (true);

-- =====================================================================
-- 登録者数の推移（グラフ用）: 上位チャンネルの日次系列を返す。
-- =====================================================================
create or replace function public.subscriber_history(
  p_days  int default 30,
  p_top   int default 12
)
returns table (day date, channel_name text, subscriber_count bigint)
language sql stable as $$
  with win as (
    select s.channel_id, s.day, s.subscriber_count,
           coalesce(c.title, s.channel_id) as channel_name
    from public.channel_stats_daily s
    left join public.channels c on c.channel_id = s.channel_id
    where s.platform = 'youtube'
      and s.subscriber_count is not null
      and s.day >= (now() at time zone 'Asia/Tokyo')::date - greatest(p_days, 1)
  ),
  top as (
    select channel_id, max(subscriber_count) as peak
    from win group by channel_id
    order by peak desc limit greatest(p_top, 1)
  )
  select w.day, max(w.channel_name) as channel_name, max(w.subscriber_count) as subscriber_count
  from win w join top t on t.channel_id = w.channel_id
  group by w.day, w.channel_id
  order by w.day;
$$;

-- =====================================================================
-- 登録者の伸び（期間内の増加数・増加率ランキング）。
--   窓内の最古と最新を比較。開設日も返して「勢い」を見やすくする。
-- =====================================================================
create or replace function public.channel_growth(
  p_days  int default 30,
  p_limit int default 20
)
returns table (
  channel_id   text,
  channel_name text,
  latest_subs  bigint,
  first_subs   bigint,
  delta        bigint,
  growth_pct   double precision,
  published_at timestamptz
)
language sql stable as $$
  with win as (
    select channel_id, day, subscriber_count
    from public.channel_stats_daily
    where platform = 'youtube' and subscriber_count is not null
      and day >= (now() at time zone 'Asia/Tokyo')::date - greatest(p_days, 1)
  ),
  bounds as (
    select channel_id,
           (array_agg(subscriber_count order by day desc))[1] as latest_subs,
           (array_agg(subscriber_count order by day asc))[1]  as first_subs
    from win group by channel_id
  )
  select b.channel_id,
         coalesce(c.title, b.channel_id) as channel_name,
         b.latest_subs,
         b.first_subs,
         (b.latest_subs - b.first_subs) as delta,
         case when b.first_subs > 0
              then round((b.latest_subs - b.first_subs)::numeric / b.first_subs * 100, 1)
              else null end as growth_pct,
         c.published_at
  from bounds b
  left join public.channels c on c.channel_id = b.channel_id
  order by delta desc nulls last
  limit greatest(p_limit, 1);
$$;

-- =====================================================================
-- エンリッチ対象の抽出: 直近 p_days 以内に観測されたアクティブなチャンネル一覧。
--   エンリッチJobがこれを引いて channels.list / Get Users をバッチ実行する。
-- =====================================================================
create or replace function public.active_channels(p_days int default 60)
returns table (channel_id text, platform text, channel_name text, first_seen timestamptz)
language sql stable as $$
  select channel_id,
         max(platform)                            as platform,
         coalesce(max(channel_name), channel_id)  as channel_name,
         min(captured_at)                         as first_seen
  from public.stream_snapshots
  where captured_at >= now() - make_interval(days => greatest(p_days, 1))
  group by channel_id;
$$;

-- =====================================================================
-- pg_cron 登録（エンリッチJob）
--   YouTube のクォータは太平洋時間0時にリセットされる。DST差を吸収して
--   「リセット直後」に確実に走らせるため UTC 08:30 に固定（PST=00:30/PDT=01:30 PT、
--   いずれもリセット後。JSTでは 17:30）。この時刻なら search が枠を使い切った後でも
--   競合せず、エンリッチが必ず実行される。
--   ※ URL は本番ドメインに置き換えること（既存の collect ジョブと同じ要領）。
--   ※ pg_net(net.http_post) 拡張が有効な前提。CRON_SECRET はDB側のcurrent_settingや
--     ハードコードでなく、既存collectジョブと同じ方式で渡すこと。
-- =====================================================================
-- 例（実行は本番URL/シークレットを埋めてから）:
-- select cron.schedule(
--   'mtf-enrich',
--   '30 8 * * *',
--   $cmd$
--     select net.http_post(
--       url     := 'https://<本番ドメイン>/api/cron/enrich',
--       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
--     );
--   $cmd$
-- );
