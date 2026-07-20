# 변경 이력

이 파일은 사람이 읽기 위한 것입니다. 배포할 때마다 맨 위에 한 항목씩 추가하세요.

`sw.js` 의 `CACHE` 버전과 여기의 버전을 같이 올리면, 나중에
"언제부터 이 문제가 있었는지" 추적하기 쉬워집니다.

## [Unreleased]

### 추가
- 관리자 **통계 탭** — 월간 완독 권수·완독률·최근 14일 활동 (`admin_stats()`)
- 관리자 **연체 처리 수동 실행** 버튼 — pg_cron 이 멈춰도 복구 가능 (`admin_run_overdue()`)
- 하단 탭바·관리자 탭에 **승인 대기 배지** — 신규 가입자가 방치되지 않게
- 장르 **룩업 테이블**(`genres`) + 등록 화면 `<select>` 전환
- `books.norm_title` / `norm_author` 정규화 컬럼 — 띄어쓰기·구두점만 다른 같은 책을 하나로
- 모든 화면의 **로딩 표시**(`App.showLoading`)와 **빈 상태 컴포넌트**(`App.emptyState`)
- 문서: README, LICENSE, 이용약관, 개인정보처리방침, 이 파일
- GitHub Actions 린트 워크플로

### 수정
- **책 꽂기가 동작하지 않던 버그** — 모달에 제출 버튼이 없어
  `Bookshelf.submitAddBook` 이 어디서도 호출되지 않았습니다
- 모달 **포커스 트랩** — Tab 이 모달 밖으로 빠져나가던 문제
- 별점 ARIA — 부모가 `role="group"` 인데 자식이 `role="radio"` 여서 무효였던 구조
- 별점 선택 시 `aria-label` 이 "별점" 이름표를 덮어쓰던 문제
- 색상·아이콘 피커에 `role="radio"` / `aria-checked` / 화살표 키 이동 추가
- 폼 검증 오류를 3초 뒤 사라지는 토스트 대신 **입력 칸 아래 고정**
- 서재 책장이 8권마다 강제로 줄바꿈되던 문제 → 화면 폭에 따라 자동 배치
- 생성형 표지·책등 색이 노랑~연두 구간에서 흰 글자와 대비가 부족하던 문제
- 자동완성 화살표 이동 하이라이트를 인라인 style 대신 CSS 클래스로

### 보안
- Supabase SDK를 `@2` → `@2.110.7` 로 고정하고 SRI(`integrity`) 해시 추가
- Edge Function 의 `esm.sh` import 도 같은 버전으로 고정

### 마이그레이션
적용 순서대로 실행하세요.
- `supabase/migrations/003_book_normalize_genres.sql`
- `supabase/migrations/004_admin_stats.sql`

---

## [v2] — 서비스 워커 캐시 `library-bank-v2`

- 도서 검색 API(네이버) 제거 → 사용자가 직접 입력
- 장르 필드 추가, 도서명 자동완성
- 연체료 소급 부과, 알림(`notifications`), 이벤트 로그(`events`)

## [v1] — 최초 버전

- PHP 기반 구버전에서 Supabase 로 이전
