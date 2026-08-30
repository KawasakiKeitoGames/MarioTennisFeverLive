-- =====================================================================
-- 2026-08-30 Twitchのカテゴリ(game_id)を保存するテーブル
--
-- 収集は毎回 helix/games?name=... で game_id を引き直していたため、
-- この1本が落ちると収集全体が止まっていた（2026-08-29 08:30 UTC〜9時間超の停止）。
-- game_id はタイトルごとに不変なので、一度解決したらここに保存し、
-- 以後はAPIを叩かずに使う。helix/games が落ちている間も収集を継続できる。
--
-- 収集は service_role で書くため RLS はポリシー無しの有効化のみ（anonからは不可視）。
-- =====================================================================

create table if not exists public.twitch_game_ids (
  game       text primary key,            -- lib/games.ts の GameId ('fever' 等)
  twitch_id  text        not null,        -- Twitch の game_id
  name       text        not null,        -- Twitch 上のカテゴリ名（変更検知用）
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_twitch_game_ids_twitch_id
  on public.twitch_game_ids (twitch_id);

alter table public.twitch_game_ids enable row level security;
