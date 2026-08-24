-- Twitchの配信本数を正しく数えられるようにする（2026-08-24）
--
-- 背景: lib/twitch.ts は stream_id に user_login（チャンネル名）を入れていたため、
--       同一チャンネルの別々の配信が1本に潰れ、count(distinct stream_id) が
--       「チャンネル数」になっていた。実測(8/17-8/23)では Twitch 20ch に対し
--       実際の配信は24本。
--
-- 対応: アプリ側で Twitch API の id（配信ごとのユニークID）を stream_id に入れ、
--       started_at（配信者側の実際の開始時刻）を新列に保存する。
--       ※過去分のTwitch行は stream_id=login のまま。遡及は不可なので、
--         過去期間の本数はギャップ分割（40分）で数えること。
alter table stream_snapshots
  add column if not exists stream_started_at timestamptz;

comment on column stream_snapshots.stream_started_at is
  '配信開始時刻。TwitchはAPIのstarted_atをそのまま保存。YouTubeは未取得のためnull。';

-- 同一配信の行をまとめて引くときのための索引（配信本数・配信時間の集計用）
create index if not exists stream_snapshots_stream_started_idx
  on stream_snapshots (platform, stream_id, stream_started_at);
