-- ═══════════════════════════════════════════════════════════
--  002 — 도서 검색 API 제거 + 전반 개선분
--
--  이미 schema.sql(구버전)으로 배포한 DB에 적용하는 변경분입니다.
--  아직 배포 전이라면 이 파일은 필요 없습니다. (schema.sql 이 이미 최신)
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
--  여러 번 실행해도 안전하도록 작성했습니다.
-- ═══════════════════════════════════════════════════════════

begin;

-- ── 1. books: 줄거리 컬럼, total_pages 를 NULL 허용으로 ─────
alter table books add column if not exists description text default '';
-- 기존 기본값 300 을 떼고 NULL(미상) 허용. 통계가 추정값으로 오염되지 않게. (P5)
alter table books alter column total_pages drop default;

-- ── 2. 도서명+작가 중복 행 정리 후 유니크 인덱스 ───────────
--  API 시절 ISBN이 달라 별개 행이던 책을 도서명+작가 기준으로 합칩니다.
with dupes as (
  select id,
         first_value(id) over (
           partition by lower(title), lower(coalesce(author, ''))
           order by id
         ) as keep_id
    from books
)
, moved as (
  update loans l set book_id = d.keep_id
    from dupes d
   where l.book_id = d.id and d.id <> d.keep_id
  returning 1
)
delete from books b using dupes d where b.id = d.id and d.id <> d.keep_id;

create unique index if not exists books_title_author_idx
  on books (lower(title), lower(coalesce(author, '')));

-- ── 3. app_config_all (D4) ─────────────────────────────────
create or replace function app_config_all()
returns json language sql immutable as $$
  select json_build_object(
    'join_bonus',   app_config('join_bonus'),
    'loan_deposit', app_config('loan_deposit'),
    'return_bonus', app_config('return_bonus'),
    'overdue_fee',  app_config('overdue_fee'),
    'room_fee',     app_config('room_fee'),
    'extend_fee',   app_config('extend_fee'),
    'extend_days',  app_config('extend_days'),
    'extend_max',   app_config('extend_max')
  );
$$;

-- ── 4. create_loan 교체 (genre, NULL 페이지, on-conflict) ──
drop function if exists create_loan(text, text, text, text, text, int, date, text);
drop function if exists create_loan(text, text, text, text, text, int, text, date, text);

create or replace function create_loan(
  p_title text, p_author text, p_publisher text, p_pub_date text,
  p_pages int, p_genre text, p_desc text, p_target date, p_memo text
) returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_book    bigint;
  v_deposit int  := app_config('loan_deposit');
  v_balance int;
  v_loan    bigint;
  v_title   text := trim(coalesce(p_title, ''));
  v_author  text := trim(coalesce(p_author, ''));
  v_pages   int  := case when p_pages is null then null else greatest(1, p_pages) end;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if v_title = '' then raise exception '도서명을 입력해주세요.'; end if;
  if char_length(v_title)  > 200 then raise exception '도서명이 너무 깁니다.'; end if;
  if char_length(v_author) > 100 then raise exception '작가명이 너무 깁니다.'; end if;
  if p_target <= current_date then raise exception '오늘 이후 날짜를 선택해주세요.'; end if;

  if exists (
       select 1 from loans l join books b on b.id = l.book_id
       where l.user_id = v_uid
         and lower(b.title) = lower(v_title)
         and lower(coalesce(b.author, '')) = lower(v_author)
         and l.status in ('active','overdue')
     ) then
    raise exception '이미 대출 중인 도서입니다.';
  end if;

  insert into books (title, author, publisher, pub_date, genre, description, total_pages)
  values (v_title, v_author, coalesce(p_publisher,''), coalesce(p_pub_date,''),
          coalesce(nullif(trim(p_genre),''), ''), coalesce(p_desc,''), v_pages)
  on conflict (lower(title), lower(coalesce(author, ''))) do nothing;

  select id into v_book from books
   where lower(title) = lower(v_title)
     and lower(coalesce(author, '')) = lower(v_author);

  update books set
    genre       = case when coalesce(genre,'')='' then coalesce(nullif(trim(p_genre),''),'') else genre end,
    description = case when coalesce(description,'')='' then coalesce(p_desc,'') else description end,
    total_pages = coalesce(total_pages, v_pages)
   where id = v_book;

  v_balance := adjust_points(v_uid, -v_deposit, 'loan_deposit',
                             '대출 보증금: ' || v_title, null);

  insert into loans (user_id, book_id, target_end_date, memo, deposit)
  values (v_uid, v_book, p_target, p_memo, v_deposit)
  returning id into v_loan;

  update transactions set loan_id = v_loan
   where user_id = v_uid and loan_id is null and type = 'loan_deposit'
   and id = (select max(id) from transactions where user_id = v_uid and type = 'loan_deposit');

  return json_build_object('loan_id', v_loan, 'balance', v_balance, 'deposit', v_deposit);
end;
$$;

-- ── 5. process_overdue: 놓친 날짜 소급 부과 (D2) ───────────
create or replace function process_overdue()
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  r         record;
  d         date;
  v_from    date;
  v_fee     int := app_config('overdue_fee');
  v_count   int := 0;
begin
  for r in
    select id, user_id, target_end_date from loans
     where status in ('active','overdue') and target_end_date < current_date
  loop
    update loans set status = 'overdue' where id = r.id and status = 'active';
    v_from := greatest(
      r.target_end_date + 1,
      coalesce((select max(fee_date) + 1 from overdue_logs o where o.loan_id = r.id),
               r.target_end_date + 1)
    );
    d := v_from;
    while d <= current_date - 1 loop
      perform adjust_points(r.user_id, -v_fee, 'overdue_fee',
                            '연체 수수료 (' || d || ')', r.id, true);
      insert into overdue_logs (loan_id, user_id, fee_date, amount)
      values (r.id, r.user_id, d, -v_fee)
      on conflict (loan_id, fee_date) do nothing;
      v_count := v_count + 1;
      d := d + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- ── 6. 알림 (P3) ───────────────────────────────────────────
create table if not exists notifications (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  loan_id bigint references loans(id) on delete cascade,
  kind text not null, title text not null,
  read_at timestamptz, created_at timestamptz not null default now(),
  unique (loan_id, kind, created_at)
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);
alter table notifications enable row level security;
drop policy if exists "본인 알림 조회" on notifications;
drop policy if exists "본인 알림 읽음처리" on notifications;
create policy "본인 알림 조회" on notifications for select using (user_id = auth.uid());
create policy "본인 알림 읽음처리" on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function generate_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare v_count int := 0;
begin
  insert into notifications (user_id, loan_id, kind, title)
  select l.user_id, l.id, 'due_soon', b.title || ' — 내일까지 반납이에요'
    from loans l join books b on b.id = l.book_id
   where l.status = 'active' and l.target_end_date = current_date + 1
     and not exists (select 1 from notifications n where n.loan_id = l.id and n.kind = 'due_soon' and n.created_at::date = current_date);
  get diagnostics v_count = row_count;
  insert into notifications (user_id, loan_id, kind, title)
  select l.user_id, l.id, 'overdue', b.title || ' — 반납일이 지났어요'
    from loans l join books b on b.id = l.book_id
   where l.status in ('active','overdue') and l.target_end_date = current_date - 1
     and not exists (select 1 from notifications n where n.loan_id = l.id and n.kind = 'overdue' and n.created_at::date = current_date);
  return v_count;
end; $$;

create extension if not exists pg_cron;
select cron.unschedule('reminders-daily') where exists (select 1 from cron.job where jobname = 'reminders-daily');
select cron.schedule('reminders-daily', '0 0 * * *', 'select generate_reminders()');

-- ── 7. 이벤트 로그 (P8) ────────────────────────────────────
create table if not exists events (
  id bigserial primary key,
  user_id uuid references profiles(id) on delete set null,
  type text not null, meta jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_type_idx on events (type, created_at desc);
alter table events enable row level security;
drop policy if exists "본인 이벤트 기록" on events;
drop policy if exists "관리자 이벤트 조회" on events;
create policy "본인 이벤트 기록" on events for insert with check (user_id = auth.uid());
create policy "관리자 이벤트 조회" on events for select using (is_admin());

create or replace function log_event(p_type text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into events (user_id, type, meta) values (auth.uid(), p_type, coalesce(p_meta, '{}'::jsonb));
$$;

-- ── 8. 권한 정리 ───────────────────────────────────────────
grant select, insert, update, delete on notifications, events to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke insert, delete on notifications from authenticated;
revoke update, delete on events from authenticated;
grant execute on function app_config_all, log_event, create_loan to authenticated;
revoke execute on function generate_reminders() from authenticated, anon, public;

commit;
