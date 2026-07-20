-- ═══════════════════════════════════════════════════════════
--  독서 통장 — Supabase 스키마 (PostgreSQL)
--
--  Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 RUN 하세요.
--  한 번만 실행하면 됩니다.
--
--  PHP 버전과의 차이:
--    - 회원/비밀번호/토큰 테이블 없음 → Supabase Auth(auth.users)가 처리
--    - 푸시 알림 관련 테이블 전부 삭제
--    - 레이트리밋/캐시 테이블 삭제 (Supabase 기본 제공)
--    - 보안은 RLS(Row Level Security)로: "내 데이터만 보인다"를 DB가 강제
-- ═══════════════════════════════════════════════════════════

-- ── 0. 정리 (다시 실행할 때를 위해) ────────────────────────
drop table if exists room_decor       cascade;
drop table if exists decor_items       cascade;
drop table if exists theme_unlocks    cascade;
drop table if exists palettes         cascade;
drop table if exists requests         cascade;
drop table if exists events           cascade;
drop table if exists notifications    cascade;
drop table if exists bookshelf_books  cascade;
drop table if exists bookshelf_rooms  cascade;
drop table if exists transactions     cascade;
drop table if exists overdue_logs     cascade;
drop table if exists loans            cascade;
drop table if exists books            cascade;
drop table if exists profiles         cascade;
drop type  if exists user_role        cascade;
drop type  if exists loan_status      cascade;
drop type  if exists txn_type         cascade;


-- ── 1. 타입 ────────────────────────────────────────────────
-- PostgreSQL은 MySQL의 ENUM(...) 인라인 문법이 없어 타입을 먼저 만듭니다.
create type user_role   as enum ('pending','member','admin');
create type loan_status as enum ('active','returned','overdue');
create type txn_type    as enum (
  'join_bonus','return_bonus','overdue_fee','room_fee','admin_adjust',
  'loan_deposit','deposit_refund','extend_fee','theme_fee','decor_fee'
);


-- ── 2. 프로필 ──────────────────────────────────────────────
-- 로그인 정보(이메일/비밀번호)는 Supabase가 auth.users 에 보관합니다.
-- 우리는 앱 고유 정보(닉네임·역할·잔액)만 여기에 둡니다.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null unique check (char_length(nickname) between 2 and 20),
  role        user_role not null default 'pending',
  balance     int  not null default 0 check (balance >= 0),
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- 회원가입 시 프로필 자동 생성 (Supabase Auth 가입 → 트리거 → profiles)
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into profiles (id, nickname)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'nickname'), ''),
      '독자' || substr(new.id::text, 1, 6)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ── 3. 도서 (공용 캐시) ────────────────────────────────────
-- [변경] 도서 검색 API를 걷어내고 사용자가 직접 입력하는 방식으로 바꿨습니다.
--        isbn/cover_url 은 더 이상 채워지지 않지만, 기존 데이터를 위해 컬럼은 남깁니다.
-- 정규화 함수: 공백과 구두점을 지우고 소문자로.
--   "해리 포터 (1권)" → "해리포터1권" / "J.K. 롤링" → "jk롤링"
--   lower() 만으로는 "해리 포터"와 "해리포터"를 같은 책으로 못 봅니다.
--
-- ⚠️ 아래 generated 컬럼이 이 함수를 씁니다. 정의를 바꾸면 이미 저장된 값과
--    어긋나므로, 고칠 일이 생기면 컬럼을 drop → 재생성해 전체를 다시 계산하세요.
create or replace function book_norm(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(t, ''))), '[[:space:][:punct:]]', '', 'g');
$$;

-- 장르는 자유 입력이 아니라 이 목록에서 고릅니다.
--   자유 입력이면 "소설"/"장편소설"/"문학" 이 별개 항목이 되어
--   장르 통계와 '장르 탐험가' 업적이 무의미해집니다.
--   화면의 <select> 도 이 표를 읽어 그리므로, 추가하려면 여기에 한 줄만 넣으면 됩니다.
create table genres (
  id   smallserial primary key,
  name text not null unique,
  sort smallint not null default 0
);
insert into genres (name, sort) values
  ('소설', 10), ('시', 20), ('에세이', 30), ('인문', 40),
  ('사회', 50), ('과학', 60), ('경제/경영', 70), ('자기계발', 80),
  ('역사', 90), ('예술', 100), ('만화', 110), ('어린이', 120),
  ('기타', 999);

create table books (
  id          bigserial primary key,
  isbn        text unique,              -- (구) API 시절 데이터용. 직접 등록은 NULL
  title       text not null,
  author      text default '',
  publisher   text default '',
  pub_date    text default '',
  description text default '',          -- 줄거리
  cover_url   text default '',          -- (구) API 시절 데이터용. 직접 등록은 ''
  genre       text default '',          -- 표시용 원문 (목록에 없는 예전 값도 보존)
  genre_id    smallint references genres(id),   -- 통계용 정리된 장르
  total_pages int,                      -- NULL = 미상. 통계에서 추정값으로 오염되지 않게. (P5)
  created_at  timestamptz not null default now(),
  norm_title  text generated always as (book_norm(title))  stored,
  norm_author text generated always as (book_norm(author)) stored
);
-- 도서명+작가로 같은 책을 판별합니다 (ISBN이 없으므로).
create unique index books_norm_idx  on books (norm_title, norm_author);
create index        books_genre_idx on books (genre_id);


-- ── 4. 대출 ────────────────────────────────────────────────
create table loans (
  id              bigserial primary key,
  user_id         uuid not null references profiles(id) on delete cascade,
  book_id         bigint not null references books(id),
  loan_date       date not null default current_date,
  target_end_date date not null,
  return_date     date,
  status          loan_status not null default 'active',
  read_pages      int default 0,
  memo            text,
  rating          smallint check (rating between 1 and 5),
  deposit         int not null default 0,   -- 이 대출에 걸린 보증금 (반납 시 환급)
  extend_count    int not null default 0,
  created_at      timestamptz not null default now()
);
create index loans_user_status_idx on loans (user_id, status);
create index loans_target_date_idx on loans (target_end_date);


-- ── 5. 거래 내역 ───────────────────────────────────────────
create table transactions (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  loan_id     bigint references loans(id) on delete set null,
  type        txn_type not null,
  amount      int not null,
  balance     int not null,
  description text,
  created_at  timestamptz not null default now()
);
create index transactions_user_idx on transactions (user_id, created_at desc);


-- ── 6. 연체 기록 ───────────────────────────────────────────
create table overdue_logs (
  id         bigserial primary key,
  loan_id    bigint not null references loans(id) on delete cascade,
  user_id    uuid   not null references profiles(id) on delete cascade,
  fee_date   date   not null,
  amount     int    not null default -10,
  created_at timestamptz not null default now(),
  unique (loan_id, fee_date)          -- 하루에 두 번 부과되는 것을 DB가 막음
);


-- ── 7. 서재 ────────────────────────────────────────────────
create table bookshelf_rooms (
  id          bigserial primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  description text default '',
  color       text default '#5B8FBF',
  icon        text default '📚',
  sort_order  int  default 0,
  created_at  timestamptz not null default now()
);
create index bookshelf_rooms_user_idx on bookshelf_rooms (user_id);

create table bookshelf_books (
  id       bigserial primary key,
  room_id  bigint not null references bookshelf_rooms(id) on delete cascade,
  user_id  uuid   not null references profiles(id) on delete cascade,
  loan_id  bigint not null unique references loans(id) on delete cascade,
  book_id  bigint not null references books(id),
  note     text,
  added_at timestamptz not null default now()
);
create index bookshelf_books_room_idx on bookshelf_books (room_id);


-- ═══════════════════════════════════════════════════════════
--  8. 보안 정책 (RLS)
--
--  PHP에서는 모든 쿼리에 "WHERE user_id = ?" 를 직접 붙여야 했고,
--  하나라도 빠뜨리면 남의 데이터가 보였습니다.
--  여기서는 DB가 강제하므로 실수로도 뚫리지 않습니다.
-- ═══════════════════════════════════════════════════════════

-- 현재 사용자가 관리자인지 (정책 안에서 재귀 방지를 위해 함수로 분리)
create or replace function is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- 현재 사용자가 승인된 회원인지
create or replace function is_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('member','admin'));
$$;

alter table profiles        enable row level security;
alter table books           enable row level security;
alter table loans           enable row level security;
alter table transactions    enable row level security;
alter table overdue_logs    enable row level security;
alter table bookshelf_rooms enable row level security;
alter table bookshelf_books enable row level security;

-- profiles
--
-- ⚠️ 여기가 이 앱에서 가장 위험한 지점입니다.
--    RLS의 "for update using (id = auth.uid())" 는 '본인 행'만 제한할 뿐,
--    그 행의 '어떤 컬럼이든' 바꾸게 허용합니다.
--    → 사용자가 자기 balance 를 999999 로 바꾸거나
--      스스로 role='admin' 이 될 수 있습니다. (실제로 뚫리는 것 확인함)
--
--    PostgreSQL RLS 는 컬럼을 제한하지 못하므로,
--    반드시 '컬럼 단위 GRANT' 로 막아야 합니다. (아래 권한 섹션 참고)
--    balance 와 role 은 SECURITY DEFINER 함수를 통해서만 바뀝니다.
create policy "본인 프로필 조회" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "본인 프로필 수정" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "관리자 회원 삭제" on profiles
  for delete using (is_admin());
-- 회원 승인(role 변경)   → approve_member() 함수
-- 포인트 변경(balance)   → adjust_points() 계열 함수
-- 본인 탈퇴              → delete_my_account() 함수

-- books: 승인 회원은 모두 조회 가능 (공용 캐시)
create policy "회원 도서 조회" on books
  for select using (is_member());

-- genres: 회원이면 목록 조회 가능 (등록 화면의 장르 <select> 를 이 표로 그립니다)
alter table genres enable row level security;
create policy "회원 장르 조회" on genres
  for select using (is_member());
-- 도서 등록은 create_loan() 함수에서만 (사용자가 임의로 넣지 못하게)

-- loans: 본인 것만. 관리자는 전체 조회.
create policy "본인 대출 조회" on loans
  for select using (user_id = auth.uid() or is_admin());
-- 생성/수정은 아래 RPC 함수로만 (포인트와 원자적으로 처리하기 위해)

-- transactions: 본인 것만 조회 (쓰기는 함수만)
create policy "본인 거래 조회" on transactions
  for select using (user_id = auth.uid() or is_admin());

-- overdue_logs: 본인 것만 조회
create policy "본인 연체기록 조회" on overdue_logs
  for select using (user_id = auth.uid() or is_admin());

-- bookshelf_rooms: 본인 것만 전부
create policy "본인 서재방 조회" on bookshelf_rooms
  for select using (user_id = auth.uid());
create policy "본인 서재방 삭제" on bookshelf_rooms
  for delete using (user_id = auth.uid());
create policy "본인 서재방 수정" on bookshelf_rooms
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- 방 추가는 RPC(요금 차감과 원자적 처리)

-- bookshelf_books: 본인 것만
create policy "본인 서재책 조회" on bookshelf_books
  for select using (user_id = auth.uid());
create policy "본인 서재책 추가" on bookshelf_books
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from bookshelf_rooms r where r.id = room_id and r.user_id = auth.uid())
    and exists (select 1 from loans l where l.id = loan_id and l.user_id = auth.uid()
                and l.status = 'returned')
  );
create policy "본인 서재책 삭제" on bookshelf_books
  for delete using (user_id = auth.uid());
create policy "본인 서재책 수정" on bookshelf_books
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ═══════════════════════════════════════════════════════════
--  9. 포인트 경제
--
--  잔액 = "지금 몇 권까지 빌릴 수 있는가" (대출 여력)
--    가입      +500  → 동시 5권 가능
--    대출      -100  (보증금, 반납하면 돌려받음)
--    정시 반납 +100 환급 +15 보너스
--    연체      -10 / 일
--    방 추가   -200
--    연장      -50  (환급 없음)
-- ═══════════════════════════════════════════════════════════
create or replace function app_config(key text)
returns int language sql immutable as $$
  select case key
    when 'join_bonus'    then 500
    when 'loan_deposit'  then 100
    when 'return_bonus'  then 15
    when 'overdue_fee'   then 10
    when 'room_fee'      then 200
    when 'extend_fee'    then 50
    when 'extend_days'   then 7
    when 'extend_max'    then 2
    else 0 end;
$$;

-- [D4] 규칙 전체를 한 번에 반환. 클라이언트가 app_config 를 8번 왕복하지 않도록.
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

-- 포인트 증감 (내부용). 잔액이 모자라면 예외를 던져 거래 전체가 취소됩니다.
-- 단, 대상이 관리자면 잔액과 상관없이 모든 활동이 가능해야 하므로
-- 마이너스 잔액을 허용한 채 예외 없이 진행합니다.
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
      v_amount  := -v_balance;   -- 있는 만큼만 차감 (연체료용)
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


-- ── 대출 신청 ──────────────────────────────────────────────
-- [변경] 사용자가 책 정보를 직접 입력합니다. ISBN·표지는 받지 않습니다.
--        구버전(p_isbn/p_cover)이 남아 있으면 오버로드로 공존하므로 먼저 지웁니다.
drop function if exists create_loan(text, text, text, text, text, int, date, text);

create or replace function create_loan(
  p_title text, p_author text, p_publisher text, p_pub_date text,
  p_pages int, p_genre text, p_desc text, p_target date, p_memo text
) returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_book     bigint;
  v_deposit  int  := app_config('loan_deposit');
  v_balance  int;
  v_loan     bigint;
  v_title    text := trim(coalesce(p_title, ''));
  v_author   text := trim(coalesce(p_author, ''));
  v_genre    text := coalesce(nullif(trim(p_genre), ''), '');
  v_genre_id smallint;
  v_pages    int  := case when p_pages is null then null else greatest(1, p_pages) end;  -- P5: 미입력은 NULL
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if v_title = '' then raise exception '도서명을 입력해주세요.'; end if;
  if char_length(v_title)  > 200 then raise exception '도서명이 너무 깁니다.'; end if;
  if char_length(v_author) > 100 then raise exception '작가명이 너무 깁니다.'; end if;
  if p_target <= current_date then raise exception '오늘 이후 날짜를 선택해주세요.'; end if;

  -- 목록에 없는 장르는 무시합니다 (genre 텍스트는 남기되 genre_id 는 NULL)
  select id into v_genre_id from genres where book_norm(name) = book_norm(v_genre);

  -- 중복 대출 확인 (ISBN이 없으므로 도서명+작가를 정규화해서 판별)
  if exists (
       select 1 from loans l join books b on b.id = l.book_id
       where l.user_id = v_uid
         and b.norm_title  = book_norm(v_title)
         and b.norm_author = book_norm(v_author)
         and l.status in ('active','overdue')
     ) then
    raise exception '이미 대출 중인 도서입니다.';
  end if;

  -- 도서 등록 또는 재사용 (D3: 동시 등록 경합에도 books 행은 하나)
  --   유니크 인덱스(norm_title, norm_author) 에 on conflict 로 원자적 처리.
  insert into books (title, author, publisher, pub_date, genre, genre_id, description, total_pages)
  values (v_title, v_author, coalesce(p_publisher,''), coalesce(p_pub_date,''),
          v_genre, v_genre_id, coalesce(p_desc,''), v_pages)
  on conflict (norm_title, norm_author) do nothing;

  select id into v_book from books
   where norm_title = book_norm(v_title) and norm_author = book_norm(v_author);

  -- 기존 행에 장르/줄거리/페이지가 비어 있으면 이번 입력으로 채워줌 (덮어쓰진 않음)
  update books set
    genre       = case when coalesce(genre,'')='' then v_genre else genre end,
    genre_id    = coalesce(genre_id, v_genre_id),
    description = case when coalesce(description,'')='' then coalesce(p_desc,'') else description end,
    total_pages = coalesce(total_pages, v_pages)
   where id = v_book;

  -- 보증금 차감 (잔액 부족하면 여기서 예외 → 대출 취소)
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


-- ── 반납 ───────────────────────────────────────────────────
create or replace function return_loan(p_loan bigint, p_rating int, p_memo text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_loan    loans%rowtype;
  v_pages   int;
  v_title   text;
  v_late    boolean;
  v_bonus   int := 0;
  v_balance int;
begin
  select * into v_loan from loans
   where id = p_loan and user_id = v_uid and status in ('active','overdue');
  if not found then raise exception '대출 정보를 찾을 수 없습니다.'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception '별점을 선택해주세요.'; end if;

  select total_pages, title into v_pages, v_title from books where id = v_loan.book_id;
  v_late := current_date > v_loan.target_end_date;

  -- 보증금 환급
  v_balance := adjust_points(v_uid, v_loan.deposit, 'deposit_refund',
                             '보증금 환급: ' || v_title, p_loan);

  -- 정시 반납 보너스
  if not v_late then
    v_bonus   := app_config('return_bonus');
    v_balance := adjust_points(v_uid, v_bonus, 'return_bonus',
                               '반납 보너스: ' || v_title, p_loan);
  end if;

  update loans
     set status = 'returned', return_date = current_date,
         rating = p_rating, memo = p_memo, read_pages = v_pages
   where id = p_loan;

  return json_build_object('bonus', v_bonus, 'refund', v_loan.deposit, 'balance', v_balance);
end;
$$;


-- ── 대출 연장 (포인트 소비처) ──────────────────────────────
create or replace function extend_loan(p_loan bigint)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_loan    loans%rowtype;
  v_fee     int := app_config('extend_fee');
  v_days    int := app_config('extend_days');
  v_max     int := app_config('extend_max');
  v_balance int;
  v_new     date;
begin
  select * into v_loan from loans
   where id = p_loan and user_id = v_uid and status = 'active';
  if not found then raise exception '연장할 수 있는 대출이 아닙니다. (연체 중에는 연장 불가)'; end if;
  if v_loan.extend_count >= v_max then
    raise exception '연장은 최대 %회까지 가능합니다.', v_max;
  end if;

  v_balance := adjust_points(v_uid, -v_fee, 'extend_fee', '대출 연장', p_loan);
  v_new := v_loan.target_end_date + v_days;

  update loans set target_end_date = v_new, extend_count = extend_count + 1
   where id = p_loan;

  return json_build_object('new_date', v_new, 'balance', v_balance);
end;
$$;


-- ── 서재 방 추가 (요금 차감과 원자적) ──────────────────────
create or replace function create_room(p_name text, p_desc text, p_icon text, p_color text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_fee     int := app_config('room_fee');
  v_balance int;
  v_room    bigint;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception '방 이름을 입력해주세요.'; end if;

  v_balance := adjust_points(v_uid, -v_fee, 'room_fee', '서재 방 추가: ' || p_name);

  insert into bookshelf_rooms (user_id, name, description, icon, color)
  values (v_uid, p_name, coalesce(p_desc,''), coalesce(nullif(p_icon,''),'📚'),
          case when p_color ~ '^#[0-9a-fA-F]{6}$' then p_color else '#5B8FBF' end)
  returning id into v_room;

  return json_build_object('room_id', v_room, 'balance', v_balance);
end;
$$;


-- ── 관리자: 회원 승인 ──────────────────────────────────────
create or replace function approve_member(p_user uuid)
returns json
language plpgsql
security definer set search_path = public
as $$
declare v_balance int;
begin
  if not is_admin() then raise exception '관리자 권한이 필요합니다.'; end if;
  if not exists (select 1 from profiles where id = p_user and role = 'pending') then
    raise exception '대기 중인 회원을 찾을 수 없습니다.';
  end if;

  update profiles set role = 'member', approved_at = now() where id = p_user;
  v_balance := adjust_points(p_user, app_config('join_bonus'), 'join_bonus',
                             '가입 승인 보너스');
  return json_build_object('balance', v_balance);
end;
$$;

-- ── 관리자: 포인트 수동 조정 ───────────────────────────────
create or replace function admin_adjust_points(p_user uuid, p_amount int, p_reason text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare v_balance int;
begin
  if not is_admin() then raise exception '관리자 권한이 필요합니다.'; end if;
  if p_amount = 0 then raise exception '조정 금액을 입력해주세요.'; end if;
  if abs(p_amount) > 10000 then raise exception '1회 조정 한도는 ±10,000원입니다.'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception '조정 사유를 입력해주세요.'; end if;

  v_balance := adjust_points(p_user, p_amount, 'admin_adjust', '관리자 조정: ' || p_reason);
  return json_build_object('balance', v_balance);
end;
$$;


-- ── 본인 탈퇴 ──────────────────────────────────────────────
-- 개인정보처리방침의 "이용자는 언제든지 삭제(탈퇴)를 요청할 수 있습니다" 이행.
-- auth.users 를 지우면 profiles 이하 모든 데이터가 CASCADE 로 함께 삭제됩니다.
create or replace function delete_my_account()
returns void
language plpgsql
security definer set search_path = public, auth
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;

  -- 마지막 관리자는 탈퇴 불가 (서비스 운영 불능 방지)
  if exists (select 1 from profiles where id = v_uid and role = 'admin')
     and (select count(*) from profiles where role = 'admin') <= 1 then
    raise exception '마지막 관리자는 탈퇴할 수 없습니다.';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;


-- ── 데이터 내보내기 ────────────────────────────────────────
create or replace function export_my_data()
returns json
language sql
security definer set search_path = public
stable
as $$
  select json_build_object(
    'exported_at', now(),
    'profile', (select row_to_json(p) from
                (select nickname, role, balance, created_at from profiles where id = auth.uid()) p),
    'loans', coalesce((select json_agg(row_to_json(l)) from
      (select b.title, b.author, b.publisher, l.loan_date, l.target_end_date,
              l.return_date, l.status, l.rating, l.memo
         from loans l join books b on b.id = l.book_id
        where l.user_id = auth.uid() order by l.created_at) l), '[]'::json),
    'transactions', coalesce((select json_agg(row_to_json(t)) from
      (select type, amount, balance, description, created_at
         from transactions where user_id = auth.uid() order by created_at) t), '[]'::json),
    'bookshelf', coalesce((select json_agg(row_to_json(s)) from
      (select r.name as room, b.title, bb.note, bb.added_at
         from bookshelf_books bb
         join bookshelf_rooms r on r.id = bb.room_id
         join books b on b.id = bb.book_id
        where bb.user_id = auth.uid() order by bb.added_at) s), '[]'::json)
  );
$$;


-- ── 연체료 자동 차감 (pg_cron 이 매일 호출) ────────────────
-- PHP 버전은 크론잡이 없어 외부 서비스(cron-job.org)를 써야 했지만,
-- Supabase는 DB 안에서 스케줄을 돌릴 수 있습니다.
-- [D2] 놓친 날짜를 소급 부과합니다.
--   기존 버전은 current_date 하루만 부과해서, pg_cron 이 (무료 플랜 7일 정지 등으로)
--   며칠 걸렀으면 그 사이 연체료가 영영 누락됐습니다.
--   → 각 대출마다 "마지막으로 부과된 날 다음날 ~ 어제"까지 하루씩 채워 부과합니다.
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
     where status in ('active','overdue')
       and target_end_date < current_date
  loop
    update loans set status = 'overdue' where id = r.id and status = 'active';

    -- 이 대출에 대해 아직 부과 안 된 첫 연체일을 계산
    v_from := greatest(
      r.target_end_date + 1,
      coalesce((select max(fee_date) + 1 from overdue_logs o where o.loan_id = r.id),
               r.target_end_date + 1)
    );

    -- 어제까지 하루씩 부과 (오늘 자정 이후 실행되므로 어제가 마지막 확정 연체일)
    d := v_from;
    while d <= current_date - 1 loop
      -- 잔액이 모자라도 있는 만큼만 차감하고 계속 진행 (p_clamp = true)
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

-- 매일 한국시간 00:05 (= UTC 15:05) 실행
-- pg_cron 확장이 필요합니다: Dashboard → Database → Extensions → pg_cron 켜기
create extension if not exists pg_cron;
select cron.unschedule('overdue-daily') where exists
  (select 1 from cron.job where jobname = 'overdue-daily');
select cron.schedule('overdue-daily', '5 15 * * *', 'select process_overdue()');


-- ═══════════════════════════════════════════════════════════
--  10. 알림 (P3) — 반납 임박/연체를 앱 안에서 알려줍니다.
--
--  이메일까지 보내려면 별도 Edge Function + SMTP 가 필요합니다.
--  (supabase/functions/send-reminders/ 참고 — 선택사항)
--  여기서는 매일 알림 행을 만들어 두고, 앱이 열릴 때 배너로 보여줍니다.
-- ═══════════════════════════════════════════════════════════
create table if not exists notifications (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  loan_id    bigint references loans(id) on delete cascade,
  kind       text not null,             -- 'due_soon' | 'overdue'
  title      text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (loan_id, kind, created_at)
);
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);

alter table notifications enable row level security;
create policy "본인 알림 조회" on notifications
  for select using (user_id = auth.uid());
create policy "본인 알림 읽음처리" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 반납 임박(D-1)·연체 발생 알림을 하루 한 번 생성
create or replace function generate_reminders()
returns int
language plpgsql
security definer set search_path = public
as $$
declare v_count int := 0;
begin
  -- 반납 하루 전
  insert into notifications (user_id, loan_id, kind, title)
  select l.user_id, l.id, 'due_soon',
         b.title || ' — 내일까지 반납이에요'
    from loans l join books b on b.id = l.book_id
   where l.status = 'active'
     and l.target_end_date = current_date + 1
     and not exists (select 1 from notifications n
                      where n.loan_id = l.id and n.kind = 'due_soon'
                        and n.created_at::date = current_date);
  get diagnostics v_count = row_count;

  -- 연체 시작(오늘부터 연체)
  insert into notifications (user_id, loan_id, kind, title)
  select l.user_id, l.id, 'overdue',
         b.title || ' — 반납일이 지났어요'
    from loans l join books b on b.id = l.book_id
   where l.status in ('active','overdue')
     and l.target_end_date = current_date - 1
     and not exists (select 1 from notifications n
                      where n.loan_id = l.id and n.kind = 'overdue'
                        and n.created_at::date = current_date);
  return v_count;
end;
$$;

-- 매일 한국시간 09:00 (= UTC 00:00)
select cron.unschedule('reminders-daily') where exists
  (select 1 from cron.job where jobname = 'reminders-daily');
select cron.schedule('reminders-daily', '0 0 * * *', 'select generate_reminders()');


-- ═══════════════════════════════════════════════════════════
--  11. 이벤트 로그 (P8) — 제품 개선을 위한 최소 관측성.
--    누가·언제·무엇을(대출/반납/연장 등) 했는지 익명 집계용으로 남깁니다.
-- ═══════════════════════════════════════════════════════════
create table if not exists events (
  id         bigserial primary key,
  user_id    uuid references profiles(id) on delete set null,
  type       text not null,             -- 'loan_create' | 'loan_return' | 'loan_extend' ...
  meta       jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_type_idx on events (type, created_at desc);

alter table events enable row level security;
-- 본인 이벤트만 기록 가능. 조회는 관리자만.
create policy "본인 이벤트 기록" on events
  for insert with check (user_id = auth.uid());
create policy "관리자 이벤트 조회" on events
  for select using (is_admin());

create or replace function log_event(p_type text, p_meta jsonb default '{}'::jsonb)
returns void
language sql
security definer set search_path = public
as $$
  insert into events (user_id, type, meta) values (auth.uid(), p_type, coalesce(p_meta, '{}'::jsonb));
$$;


-- ═══════════════════════════════════════════════════════════
--  12. 요청사항(문의) — 회원이 관리자에게 문의를 남기고
--      관리자가 앱 안에서 답변합니다.
-- ═══════════════════════════════════════════════════════════
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
create policy "본인 요청 조회" on requests
  for select using (user_id = auth.uid() or is_admin());

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


-- ═══════════════════════════════════════════════════════════
--  13. 코인 상점 — 색 테마 + 방 꾸미기
--
--  색상 값은 화면(js/themes.js)이 갖고, DB 는 존재·가격·분류·소유만
--  관리합니다(장르 테이블과 같은 방식). 가격 판정은 반드시 서버가 합니다.
-- ═══════════════════════════════════════════════════════════

-- 팔레트 가격표
create table palettes (
  id       text primary key,
  name     text not null,
  category text not null check (category in ('vivid','pastel','mono')),
  price    int  not null default 0 check (price >= 0),
  sort     int  not null default 0
);
insert into palettes (id, name, category, price, sort) values
  ('cobalt',    '코발트',    'vivid',  300, 10),
  ('ruby',      '루비',      'vivid',  300, 20),
  ('emerald',   '에메랄드',  'vivid',  300, 30),
  ('violet',    '바이올렛',  'vivid',  300, 40),
  ('tangerine', '탠저린',    'vivid',  300, 50),
  ('lavender',  '라벤더',    'pastel', 200, 60),
  ('mint',      '민트',      'pastel', 200, 70),
  ('peach',     '피치',      'pastel', 200, 80),
  ('sky',       '스카이',    'pastel', 200, 90),
  ('rose',      '로즈',      'pastel', 200, 100),
  ('charcoal',  '모노 차콜', 'mono',   100, 110),
  ('sand',      '모노 샌드', 'mono',   100, 120);

-- 테마 소유 기록
create table theme_unlocks (
  user_id     uuid not null references profiles(id) on delete cascade,
  palette_id  text not null references palettes(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, palette_id)
);

-- 방 꾸미기 아이템 가격표
create table decor_items (
  kind  text primary key,
  name  text not null,
  emoji text not null default '',
  price int  not null default 0 check (price >= 0),
  sort  int  not null default 0
);
insert into decor_items (kind, name, emoji, price, sort) values
  ('door',   '문',   '🚪', 50, 10),
  ('window', '창문', '🪟', 40, 20),
  ('plant',  '화분', '🪴', 30, 30),
  ('frame',  '액자', '🖼️', 30, 40),
  ('lamp',   '조명', '💡', 40, 50),
  ('rug',    '러그', '🟫', 30, 60);

-- 방에 놓인 데코
create table room_decor (
  id         bigserial primary key,
  room_id    bigint not null references bookshelf_rooms(id) on delete cascade,
  user_id    uuid   not null references profiles(id) on delete cascade,
  kind       text   not null references decor_items(kind),
  created_at timestamptz not null default now()
);
create index room_decor_room_idx on room_decor (room_id);

alter table palettes      enable row level security;
alter table theme_unlocks enable row level security;
alter table decor_items   enable row level security;
alter table room_decor    enable row level security;

create policy "회원 팔레트 조회"    on palettes      for select using (is_member());
create policy "본인 테마 조회"      on theme_unlocks for select using (user_id = auth.uid() or is_admin());
create policy "회원 데코아이템 조회" on decor_items   for select using (is_member());
create policy "본인 데코 조회"      on room_decor    for select using (user_id = auth.uid());
create policy "본인 데코 삭제"      on room_decor    for delete using (user_id = auth.uid());

-- 테마 구매 (가격은 palettes 가 판정)
create or replace function unlock_theme(p_palette text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_pal     palettes%rowtype;
  v_balance int;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  select * into v_pal from palettes where id = p_palette;
  if not found then raise exception '존재하지 않는 테마입니다.'; end if;
  if exists (select 1 from theme_unlocks where user_id = v_uid and palette_id = p_palette) then
    raise exception '이미 보유한 테마입니다.';
  end if;

  v_balance := adjust_points(v_uid, -v_pal.price, 'theme_fee', '테마 구매: ' || v_pal.name);
  insert into theme_unlocks (user_id, palette_id) values (v_uid, p_palette);
  return json_build_object('balance', v_balance, 'palette', p_palette);
end;
$$;

-- 데코 구매(설치). 가격은 decor_items 가 판정. 본인 방에만.
create or replace function add_decor(p_room bigint, p_kind text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_item    decor_items%rowtype;
  v_balance int;
  v_id      bigint;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if not exists (select 1 from bookshelf_rooms where id = p_room and user_id = v_uid) then
    raise exception '내 방이 아닙니다.';
  end if;
  select * into v_item from decor_items where kind = p_kind;
  if not found then raise exception '존재하지 않는 아이템입니다.'; end if;

  v_balance := adjust_points(v_uid, -v_item.price, 'decor_fee', '방 꾸미기: ' || v_item.name);
  insert into room_decor (room_id, user_id, kind) values (p_room, v_uid, p_kind)
  returning id into v_id;
  return json_build_object('balance', v_balance, 'id', v_id, 'kind', p_kind);
end;
$$;


-- ── 권한 ───────────────────────────────────────────────────
-- Supabase는 보통 이 권한을 자동으로 주지만, 명시해두면 어떤 환경에서도 동작합니다.
-- 실제 접근 제한은 위의 RLS 정책이 담당합니다. (권한 = 문을 여는 것,
--  RLS = 문 안에서 내 물건만 보이게 하는 것)
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- 🔒 핵심 방어: profiles 는 nickname 만 직접 수정 가능
--    이 두 줄이 없으면 사용자가 자기 잔액과 역할을 마음대로 바꿀 수 있습니다.
revoke update on profiles from authenticated;
grant  update (nickname) on profiles to authenticated;

-- 🔒 대출/거래/연체 기록은 직접 쓰기 금지 (함수를 통해서만)
revoke insert, update, delete on loans        from authenticated;
revoke insert, update, delete on transactions from authenticated;
revoke insert, update, delete on overdue_logs from authenticated;
revoke insert, update, delete on books        from authenticated;
-- 🔒 장르 목록은 읽기 전용 (관리자가 SQL로만 추가)
revoke insert, update, delete on genres       from authenticated;
-- 서재 방 추가도 요금 차감과 묶여야 하므로 함수로만
revoke insert on bookshelf_rooms from authenticated;

-- 🔒 알림: 본인 것 조회 + 읽음처리(update)만. 생성은 서버(generate_reminders)만.
revoke insert, delete on notifications from authenticated;
-- 🔒 이벤트: 기록(insert)만 RLS로 허용. 수정/삭제 금지, 조회는 관리자만(RLS).
revoke update, delete on events from authenticated;
-- 🔒 요청사항: 직접 쓰기 금지. 등록은 submit_request, 답변은 admin_reply_request 로만.
revoke insert, update, delete on requests from authenticated;
-- 🔒 상점: 가격표는 읽기 전용, 소유/설치는 함수로만. 데코 삭제(회수)는 본인 것만 허용.
revoke insert, update, delete on palettes      from authenticated;
revoke insert, update, delete on theme_unlocks from authenticated;
revoke insert, update, delete on decor_items   from authenticated;
revoke insert, update on room_decor from authenticated;

grant execute on function create_loan, return_loan, extend_loan, create_room,
                          export_my_data, delete_my_account, app_config, app_config_all,
                          is_admin, is_member, log_event,
                          approve_member, admin_adjust_points,
                          submit_request, admin_reply_request,
                          unlock_theme, add_decor
  to authenticated;

-- 내부 함수는 사용자가 직접 못 부르게 차단.
-- (adjust_points 를 직접 부를 수 있으면 잔액을 마음대로 올릴 수 있습니다)
revoke execute on function adjust_points(uuid,int,txn_type,text,bigint,boolean)
  from authenticated, anon, public;
revoke execute on function process_overdue() from authenticated, anon, public;
revoke execute on function generate_reminders() from authenticated, anon, public;
