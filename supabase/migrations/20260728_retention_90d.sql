-- =====================================================================
-- データ保持期間を 90 日に変更し、captures も対象に含める。
-- あわせて pg_cron で毎日自動掃除する（手動ボタン /api/admin/prune も同じ関数を呼ぶ）。
-- =====================================================================

create or replace function public.prune_old_snapshots()
returns void language sql as $$
  delete from public.stream_snapshots
  where captured_at < now() - interval '90 days';
  delete from public.captures
  where captured_at < now() - interval '90 days';
$$;

-- 毎日 JST 02:00（= UTC 17:00、配信が少ない深夜）に自動実行
select cron.schedule('mtf-prune', '0 17 * * *', $cmd$ select public.prune_old_snapshots(); $cmd$);
