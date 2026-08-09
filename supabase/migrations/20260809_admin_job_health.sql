-- 管理画面用: pg_cron ジョブ（mtf-*）の稼働状況を返す RPC。
-- cron スキーマは PostgREST から直接読めないため security definer で仲介する。
-- 管理画面（service_role）専用。anon には公開しない。
create or replace function admin_job_health()
returns table (
  jobname text,
  active boolean,
  schedule text,
  last_success timestamptz,
  last_run timestamptz,
  last_status text,
  fails_24h bigint
)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    j.active,
    j.schedule::text,
    max(d.start_time) filter (where d.status = 'succeeded') as last_success,
    max(d.start_time) as last_run,
    (
      select d2.status::text
      from cron.job_run_details d2
      where d2.jobid = j.jobid
      order by d2.start_time desc
      limit 1
    ) as last_status,
    count(*) filter (
      where d.status is distinct from 'succeeded'
        and d.start_time >= now() - interval '24 hours'
    ) as fails_24h
  from cron.job j
  left join cron.job_run_details d on d.jobid = j.jobid
  where j.jobname like 'mtf-%'
  group by j.jobid, j.jobname, j.active, j.schedule
  order by j.jobname;
$$;

revoke execute on function admin_job_health() from public;
revoke execute on function admin_job_health() from anon;
revoke execute on function admin_job_health() from authenticated;
grant execute on function admin_job_health() to service_role;
