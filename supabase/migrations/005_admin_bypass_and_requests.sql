-- ═══════════════════════════════════════════════════════════
--  005 — 관리자 잔액 제한 해제 + 회원 요청사항(문의) 기능
--
--  왜 필요한가
--   (1) 관리자 계정도 잔액이 모자라면 대출·연장·서재 방 추가가
--       막혔습니다. 관리자는 코인(잔액)과 상관없이 모든 기능을
--       테스트/운영할 수 있어야 합니다.
--   (2) 회원이 관리자에게 문의·건의를 남길 방법이 없었습니다.
--       설정 화면에서 문의를 남기면, 관리자가 "요청사항" 탭에서
--       확인하고 앱 안에서 답변할 수 있게 합니다.
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
--
--  ⚠️ 이 파일은 004 까지 적용된 DB를 전제로 합니다.
-- ═══════════════════════════════════════════════════════════

begin;

-- ── 1. 관리자는 잔액 부족으로 막히지 않음 ──────────────────
--  adjust_points 는 대출 보증금·연장 수수료·서재 방 추가 등
--  모든 포인트 증감이 거쳐가는 공용 함수입니다.
--  대상이 관리자면 잔액이 모자라도 예외를 던지지 않고
--  마이너스 잔액을 허용한 채 그대로 진행합니다.
create or replace function adjust_points(
  p_user uuid, p_amount int, p_type txn_type,
  p_desc text, p_loan bigint default null, p_clamp boolean default false
) returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance  int;
  v_is_admin boolean;
  v_amount   int := p_amount;
begin
  -- 행 잠금: 동시에 두 요청이 와도 잔액이 꼬이지 않습니다.
  select balance, (role = 'admin') into v_balance, v_is_admin
    from profiles where id = p_user for update;
  if not found then
    raise exception '사용자를 찾을 수 없습니다.';
  end if;

  if v_balance + v_amount < 0 then
    if p_clamp then
      v_amount := -v_balance;   -- 있는 만큼만 차감 (연체료용)
    elsif not v_is_admin then
      raise exception '잔액이 부족합니다. (현재 %원, 필요 %원)', v_balance, abs(p_amount)
        using errcode = 'P0001';
    end if;
    -- 관리자는 예외 없이 그대로 진행 (마이너스 잔액 허용)
  end if;

  v_balance := v_balance + v_amount;
  update profiles set balance = v_balance where id = p_user;

  insert into transactions (user_id, loan_id, type, amount, balance, description)
  values (p_user, p_loan, p_type, v_amount, v_balance, p_desc);

  return v_balance;
end;
$$;


-- ── 2. 회원 요청사항(문의) ─────────────────────────────────
create table if not exists requests (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  content    text not null check (char_length(content) between 1 and 1000),
  status     text not null default 'open' check (status in ('open','answered')),
  reply      text,
  replied_by uuid references profiles(id) on delete set null,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists requests_user_idx   on requests (user_id, created_at desc);
create index if not exists requests_status_idx on requests (status, created_at desc);

alter table requests enable row level security;
drop policy if exists "본인 요청 조회" on requests;
create policy "본인 요청 조회" on requests
  for select using (user_id = auth.uid() or is_admin());

grant select on requests to authenticated;
-- 🔒 직접 쓰기 금지. 등록은 submit_request, 답변은 admin_reply_request 로만.
revoke insert, update, delete on requests from authenticated;

-- 문의 등록 (본인만, 승인된 회원만)
create or replace function submit_request(p_content text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_content text := trim(coalesce(p_content, ''));
  v_id      bigint;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if v_content = '' then raise exception '내용을 입력해주세요.'; end if;
  if char_length(v_content) > 1000 then raise exception '내용이 너무 깁니다. (최대 1000자)'; end if;

  insert into requests (user_id, content) values (v_uid, v_content) returning id into v_id;
  return json_build_object('id', v_id);
end;
$$;

-- 관리자 답변
create or replace function admin_reply_request(p_request bigint, p_reply text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_reply text := trim(coalesce(p_reply, ''));
begin
  if not is_admin() then raise exception '관리자 권한이 필요합니다.'; end if;
  if v_reply = '' then raise exception '답변 내용을 입력해주세요.'; end if;
  if not exists (select 1 from requests where id = p_request) then
    raise exception '요청을 찾을 수 없습니다.';
  end if;

  update requests
     set reply = v_reply, replied_by = auth.uid(), replied_at = now(), status = 'answered'
   where id = p_request;

  return json_build_object('ok', true);
end;
$$;

grant execute on function submit_request, admin_reply_request to authenticated;

commit;
