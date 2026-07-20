-- ═══════════════════════════════════════════════════════════
--  004 — 관리자 통계 + 연체 처리 모니터링
--
--  왜 필요한가
--   (1) events 테이블에 기록만 쌓이고 볼 방법이 없었습니다. 수집 비용만
--       내고 의사결정엔 못 쓰는 상태였습니다.
--   (2) 연체료는 pg_cron 이 매일 부과하는데, 무료 플랜이 정지되면
--       조용히 멈춥니다. 언제 마지막으로 돌았는지 볼 방법이 없었습니다.
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
-- ═══════════════════════════════════════════════════════════

begin;

-- ── 1. 관리자 대시보드 지표 ────────────────────────────────
--  북극성 지표는 '월간 완독 권수'입니다. 대출이 아니라 반납이 성공입니다.
create or replace function admin_stats()
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_out json;
begin
  if not is_admin() then raise exception '관리자만 볼 수 있습니다.'; end if;

  select json_build_object(
    -- 회원
    'members_total',   (select count(*) from profiles where role in ('member','admin')),
    'members_pending', (select count(*) from profiles where role = 'pending'),

    -- 대출 현황
    'loans_active',    (select count(*) from loans where status = 'active'),
    'loans_overdue',   (select count(*) from loans where status = 'overdue'),

    -- 북극성 지표: 이번 달 완독 권수, 그리고 완독한 사람 1명당 평균
    'returned_this_month', (
      select count(*) from loans
       where status = 'returned'
         and return_date >= date_trunc('month', current_date)),
    'readers_this_month', (
      select count(distinct user_id) from loans
       where status = 'returned'
         and return_date >= date_trunc('month', current_date)),

    -- 완독률: 지금까지 만들어진 대출 중 반납으로 끝난 비율
    'completion_rate', (
      select case when count(*) = 0 then 0
             else round(100.0 * count(*) filter (where status = 'returned') / count(*))
             end
        from loans),

    -- 최근 14일 이벤트 (무엇이 얼마나 일어났는지)
    'events_14d', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select type, count(*) as n
          from events
         where created_at >= current_date - 14
         group by type
         order by count(*) desc
      ) t),

    -- 연체 처리가 마지막으로 돈 날 (pg_cron 감시용)
    'overdue_last_run', (select max(fee_date) from overdue_logs),
    -- 지금 부과됐어야 하는데 안 된 건이 있는지
    'overdue_pending', (
      select count(*) from loans l
       where l.status in ('active','overdue')
         and l.target_end_date < current_date - 1
         and not exists (
           select 1 from overdue_logs o
            where o.loan_id = l.id and o.fee_date = current_date - 1))
  ) into v_out;

  return v_out;
end;
$$;


-- ── 2. 연체 처리 수동 실행 ─────────────────────────────────
--  pg_cron 이 멈췄을 때 관리자가 직접 돌릴 수 있게 합니다.
--  process_overdue() 자체는 여전히 사용자에게 막혀 있고,
--  이 래퍼가 관리자 여부를 확인한 뒤 대신 호출합니다.
--  (process_overdue 는 놓친 날짜를 소급 부과하므로 한 번만 눌러도 복구됩니다)
create or replace function admin_run_overdue()
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_count int;
begin
  if not is_admin() then raise exception '관리자만 실행할 수 있습니다.'; end if;
  v_count := process_overdue();
  return json_build_object('charged', v_count);
end;
$$;

grant execute on function admin_stats, admin_run_overdue to authenticated;

commit;
