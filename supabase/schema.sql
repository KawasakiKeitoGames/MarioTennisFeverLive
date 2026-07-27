-- =====================================================================
-- Mario Tennis Fever ライブウォッチャー Supabase スキーマ
-- Supabase の SQL Editor に貼り付けて実行してください。
-- =====================================================================

-- 各取得時点の配信中データを1行ずつ蓄積（時系列）
create table if not exists public.stream_snapshots (
  id           bigint generated always as identity primary key,
  captured_at  timestamptz not null default now(),
  platform     text        not null check (platform in ('youtube','twitch')),
  channel_id   text        not null,          -- YouTube: channelId / Twitch: user_login
  channel_name text,
  stream_id    text,                          -- YouTube: videoId / Twitch: stream idの代わりにuser_login
  title        text,
  viewers      integer,
  language     text,
  url          text
);

create index if not exists idx_snap_captured  on public.stream_snapshots (captured_at desc);
create index if not exists idx_snap_platform  on public.stream_snapshots (platform);
create index if not exists idx_snap_channel   on public.stream_snapshots (platform, channel_id, captured_at desc);

-- 取得を実行した各時点を1行ずつ記録（配信0件の回も必ず1行入れる）。
-- これにより「最新取得時点が0件」を表現でき、誰も配信していない時に
-- 古い一覧が残り続ける問題を防ぐ。
create table if not exists public.captures (
  captured_at timestamptz primary key default now(),
  youtube     integer not null default 0,
  twitch      integer not null default 0
);

-- 過去の stream_snapshots から captures を補完（既存DB向け・冪等）
insert into public.captures (captured_at, youtube, twitch)
  select captured_at,
         count(*) filter (where platform = 'youtube'),
         count(*) filter (where platform = 'twitch')
  from public.stream_snapshots
  group by captured_at
  on conflict (captured_at) do nothing;

-- 最新取得時刻 = captures の最大値（0件の回も含む）
create or replace view public.latest_capture as
  select max(captured_at) as captured_at from public.captures;

-- 「現在配信中」一覧 = 最新取得時点に属する行（0件なら空になる）
create or replace view public.current_streams as
  select s.*
  from public.stream_snapshots s
  join public.latest_capture lc on s.captured_at = lc.captured_at
  order by s.viewers desc nulls last;

-- =====================================================================
-- RLS: 公開読み取りのみ許可。書き込みは service_role（Cron）だけ。
-- =====================================================================
alter table public.stream_snapshots enable row level security;

-- 匿名ユーザーに SELECT を許可（公開サイト用）
drop policy if exists "public read snapshots" on public.stream_snapshots;
create policy "public read snapshots"
  on public.stream_snapshots for select
  to anon
  using (true);

-- INSERT は付与しない（service_role キーは RLS をバイパスするため設定不要）

alter table public.captures enable row level security;
drop policy if exists "public read captures" on public.captures;
create policy "public read captures"
  on public.captures for select
  to anon
  using (true);

-- =====================================================================
-- 古いデータの掃除（任意）: 30日より古いスナップショットを削除する関数
-- pg_cron 拡張があれば定期実行に紐づけられます。
-- =====================================================================
create or replace function public.prune_old_snapshots()
returns void language sql as $$
  delete from public.stream_snapshots
  where captured_at < now() - interval '30 days';
$$;

-- =====================================================================
-- 視聴者数の推移（グラフ用）: DB側で時間バケット集計してから返す。
--   - platform で絞り込み、指定期間のピーク上位 p_top チャンネルだけを対象
--   - p_bucket_min 分ごとのバケットで max(viewers) に集計
--   - 返す行数は「バケット数 × p_top」で頭打ち → Egressと行数を固定化
-- anon から supabase.rpc('viewer_history', {...}) で呼ぶ（SECURITY INVOKER=RLS適用）。
-- =====================================================================
create or replace function public.viewer_history(
  p_platform   text,
  p_hours      int default 24,
  p_bucket_min int default 20,
  p_top        int default 12
)
returns table (
  bucket       timestamptz,
  channel_name text,
  viewers      integer
)
language sql
stable
as $$
  with win as (
    select channel_id, channel_name, captured_at, viewers
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
    max(w.channel_name)  as channel_name,
    max(w.viewers)::int  as viewers
  from win w
  join top t on t.channel_id = w.channel_id
  group by 1, w.channel_id
  order by 1;
$$;
