-- ═══════════════════════════════════════════════════════════
--  006 — 컬러 테마 상점 + 방 꾸미기(건축 도면 데코)
--
--  왜 필요한가
--   (1) 코인(잔액)의 소비처가 대출 보증금/연장/방 추가뿐이라 모으는 재미가
--       약했습니다. 색 테마와 방 꾸미기 아이템을 코인으로 구매하게 합니다.
--   (2) 구매(가격·소유 여부)는 반드시 서버가 판정해야 위변조를 막습니다.
--       가격표(palettes·decor_items)와 소유 기록(theme_unlocks·room_decor)을
--       DB에 두고, 구매는 SECURITY DEFINER 함수로만 처리합니다.
--
--  적용: Supabase 대시보드 → SQL Editor → 전체 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
--
--  ⚠️ 이 파일은 005 까지 적용된 DB를 전제로 합니다.
-- ═══════════════════════════════════════════════════════════

-- ── 0. 거래 유형 추가 ──────────────────────────────────────
--  ⚠️ ALTER TYPE ... ADD VALUE 는 트랜잭션 안에서 추가한 값을 같은
--     트랜잭션에서 쓸 수 없습니다. 그래서 begin 밖에서 먼저 커밋합니다.
alter type txn_type add value if not exists 'theme_fee';
alter type txn_type add value if not exists 'decor_fee';


begin;

-- ── 1. 팔레트 가격표 ───────────────────────────────────────
--  실제 색상 값은 화면(js/themes.js)이 가지고, DB 는 존재·가격·분류만
--  관리합니다(장르 테이블과 같은 방식). 가격은 서버가 판정합니다.
create table if not exists palettes (
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
  ('sand',      '모노 샌드', 'mono',   100, 120)
on conflict (id) do nothing;

alter table palettes enable row level security;
drop policy if exists "회원 팔레트 조회" on palettes;
create policy "회원 팔레트 조회" on palettes
  for select using (is_member());
grant select on palettes to authenticated;
revoke insert, update, delete on palettes from authenticated;


-- ── 2. 테마 소유 기록 ──────────────────────────────────────
create table if not exists theme_unlocks (
  user_id     uuid not null references profiles(id) on delete cascade,
  palette_id  text not null references palettes(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, palette_id)
);
alter table theme_unlocks enable row level security;
drop policy if exists "본인 테마 조회" on theme_unlocks;
create policy "본인 테마 조회" on theme_unlocks
  for select using (user_id = auth.uid() or is_admin());
grant select on theme_unlocks to authenticated;
revoke insert, update, delete on theme_unlocks from authenticated;

-- 테마 구매 (가격은 palettes 가 판정. 관리자는 adjust_points 가 잔액 무관 처리)
create or replace function unlock_theme(p_palette text)
returns json
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_pal   palettes%rowtype;
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


-- ── 3. 방 꾸미기 아이템 ────────────────────────────────────
create table if not exists decor_items (
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
  ('rug',    '러그', '🟫', 30, 60)
on conflict (kind) do nothing;

alter table decor_items enable row level security;
drop policy if exists "회원 데코아이템 조회" on decor_items;
create policy "회원 데코아이템 조회" on decor_items
  for select using (is_member());
grant select on decor_items to authenticated;
revoke insert, update, delete on decor_items from authenticated;


-- ── 4. 방에 놓인 데코 ──────────────────────────────────────
create table if not exists room_decor (
  id         bigserial primary key,
  room_id    bigint not null references bookshelf_rooms(id) on delete cascade,
  user_id    uuid   not null references profiles(id) on delete cascade,
  kind       text   not null references decor_items(kind),
  created_at timestamptz not null default now()
);
create index if not exists room_decor_room_idx on room_decor (room_id);

alter table room_decor enable row level security;
drop policy if exists "본인 데코 조회" on room_decor;
create policy "본인 데코 조회" on room_decor
  for select using (user_id = auth.uid());
drop policy if exists "본인 데코 삭제" on room_decor;
create policy "본인 데코 삭제" on room_decor
  for delete using (user_id = auth.uid());
grant select, delete on room_decor to authenticated;
revoke insert, update on room_decor from authenticated;

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

  v_balance := adjust_points(v_uid, -v_item.price, 'decor_fee',
                             '방 꾸미기: ' || v_item.name);
  insert into room_decor (room_id, user_id, kind) values (p_room, v_uid, p_kind)
  returning id into v_id;

  return json_build_object('balance', v_balance, 'id', v_id, 'kind', p_kind);
end;
$$;


grant execute on function unlock_theme, add_decor to authenticated;

commit;
