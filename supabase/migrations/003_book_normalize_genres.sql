-- ═══════════════════════════════════════════════════════════
--  003 — 책 DB 정규화 + 장르 룩업 테이블
--
--  왜 필요한가
--   (1) 지금은 "해리 포터"·"해리포터"·"해리 포터 " 가 전부 다른 책입니다.
--       기존 유니크 인덱스가 lower() 만 적용해서 공백·구두점 차이를
--       걸러내지 못했기 때문입니다. → 서재와 통계가 쪼개집니다.
--   (2) 장르가 자유 입력이라 "소설"/"장편소설"/"문학" 이 별개 항목이 됩니다.
--       → 장르 통계와 '장르 탐험가' 업적이 무의미해집니다.
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
--
--  ⚠️ 이 파일은 002 까지 적용된 DB를 전제로 합니다.
-- ═══════════════════════════════════════════════════════════

begin;

-- ── 1. 정규화 함수 ─────────────────────────────────────────
--  공백과 구두점을 모두 지우고 소문자로 만듭니다.
--    "해리 포터 (1권)" → "해리포터1권"
--    "J.K. 롤링"       → "jk롤링"
--
--  ⚠️ 아래 generated 컬럼이 이 함수를 사용합니다. 정의를 바꾸면
--     이미 저장된 값과 어긋나므로, 수정할 일이 생기면 함수만 고치지 말고
--     컬럼을 drop → 재생성해서 전체를 다시 계산해야 합니다.
create or replace function book_norm(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(t, ''))), '[[:space:][:punct:]]', '', 'g');
$$;


-- ── 2. books 정규화 컬럼 ───────────────────────────────────
alter table books add column if not exists norm_title  text
  generated always as (book_norm(title)) stored;
alter table books add column if not exists norm_author text
  generated always as (book_norm(author)) stored;


-- ── 3. 기존 중복 병합 ──────────────────────────────────────
--  정규화 기준으로 같은 책이면 가장 오래된 행(min(id))으로 몰아줍니다.
--  대출 기록과 서재에 꽂힌 책의 참조를 먼저 옮긴 뒤에 삭제해야
--  외래키가 깨지지 않습니다.
create temp table book_dupes on commit drop as
  select id,
         min(id) over (partition by norm_title, norm_author) as keep_id
    from books;

update loans l
   set book_id = d.keep_id
  from book_dupes d
 where l.book_id = d.id and d.id <> d.keep_id;

update bookshelf_books bb
   set book_id = d.keep_id
  from book_dupes d
 where bb.book_id = d.id and d.id <> d.keep_id;

delete from books b
 using book_dupes d
 where b.id = d.id and d.id <> d.keep_id;


-- ── 4. 유니크 인덱스 교체 ──────────────────────────────────
drop index if exists books_title_author_idx;
create unique index if not exists books_norm_idx
  on books (norm_title, norm_author);


-- ── 5. 장르 룩업 테이블 ────────────────────────────────────
--  자유 입력 대신 정해진 목록에서 고르게 합니다.
--  화면의 <select> 도 이 표를 읽어 그리므로, 장르를 추가하려면
--  여기에 한 줄만 넣으면 앱에도 바로 반영됩니다.
create table if not exists genres (
  id   smallserial primary key,
  name text not null unique,
  sort smallint not null default 0
);

insert into genres (name, sort) values
  ('소설', 10), ('시', 20), ('에세이', 30), ('인문', 40),
  ('사회', 50), ('과학', 60), ('경제/경영', 70), ('자기계발', 80),
  ('역사', 90), ('예술', 100), ('만화', 110), ('어린이', 120),
  ('기타', 999)
on conflict (name) do nothing;

alter table genres enable row level security;
drop policy if exists "회원 장르 조회" on genres;
create policy "회원 장르 조회" on genres
  for select using (is_member());

grant select on genres to authenticated;
revoke insert, update, delete on genres from authenticated;


-- ── 6. books.genre_id ──────────────────────────────────────
--  genre(text) 컬럼은 그대로 둡니다. 화면과 통계가 이미 쓰고 있고,
--  목록에 없는 예전 값도 보존해야 하기 때문입니다.
--  genre_id 는 "정리된 장르"를 가리키는 추가 정보입니다.
alter table books add column if not exists genre_id smallint references genres(id);

update books b
   set genre_id = g.id
  from genres g
 where b.genre_id is null
   and book_norm(b.genre) = book_norm(g.name);

create index if not exists books_genre_idx on books (genre_id);


-- ── 7. create_loan 교체 ────────────────────────────────────
--  바뀐 점
--    · 같은 책 판별을 정규화 기준으로 (공백·구두점 차이를 흡수)
--    · 장르를 genres 목록과 대조해 genre_id 를 함께 채움
--  인자 목록은 002 와 동일하므로 기존 권한이 그대로 유지됩니다.
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
  v_pages    int  := case when p_pages is null then null else greatest(1, p_pages) end;
begin
  if not is_member() then raise exception '승인된 회원만 이용할 수 있습니다.'; end if;
  if v_title = '' then raise exception '도서명을 입력해주세요.'; end if;
  if char_length(v_title)  > 200 then raise exception '도서명이 너무 깁니다.'; end if;
  if char_length(v_author) > 100 then raise exception '작가명이 너무 깁니다.'; end if;
  if p_target <= current_date then raise exception '오늘 이후 날짜를 선택해주세요.'; end if;

  -- 목록에 없는 장르는 무시합니다 (genre 텍스트는 그대로 두되 genre_id 는 NULL)
  select id into v_genre_id from genres where book_norm(name) = book_norm(v_genre);

  -- 이미 대출 중인 같은 책인지 (정규화 기준)
  if exists (
       select 1 from loans l join books b on b.id = l.book_id
       where l.user_id = v_uid
         and b.norm_title  = book_norm(v_title)
         and b.norm_author = book_norm(v_author)
         and l.status in ('active','overdue')
     ) then
    raise exception '이미 대출 중인 도서입니다.';
  end if;

  insert into books (title, author, publisher, pub_date, genre, genre_id, description, total_pages)
  values (v_title, v_author, coalesce(p_publisher,''), coalesce(p_pub_date,''),
          v_genre, v_genre_id, coalesce(p_desc,''), v_pages)
  on conflict (norm_title, norm_author) do nothing;

  select id into v_book from books
   where norm_title = book_norm(v_title) and norm_author = book_norm(v_author);

  -- 먼저 등록한 사람의 값을 존중하되, 비어 있던 칸만 채웁니다.
  update books set
    genre       = case when coalesce(genre,'')='' then v_genre else genre end,
    genre_id    = coalesce(genre_id, v_genre_id),
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

commit;
