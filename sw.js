/* ═══════════════════════════════════════════════════════════
   sw.js — 서비스 워커

   [PHP판 대비 단순화]
     - 푸시 알림 관련 코드 전부 삭제 (Supabase판에서는 푸시를 쓰지 않습니다)
     - 정적 호스팅이라 API 캐싱 전략도 불필요

   [주의] 이전 버전은 cache.addAll() 에 존재하지 않는 아이콘 9개를 넣어서
          하나라도 404면 캐시 전체가 실패하고 오프라인이 아예 안 됐습니다.
          → 여기서는 실패해도 넘어가도록 개별 처리합니다.
   ═══════════════════════════════════════════════════════════ */
// ⚠️ index.html·js 를 고쳤다면 이 번호를 반드시 올리세요.
//    캐시 우선 전략이라, 안 올리면 기존 사용자는 옛날 화면을 계속 봅니다.
//    v2: 도서 검색 API 제거 → 책 직접 등록
//    v3: 책 꽂기 버튼 추가, SDK 버전 고정, 장르 <select> 전환
//    v4: 접근성(포커스 트랩·ARIA), 로딩/빈 상태 통일, 관리자 통계 탭
//    v5: 로그인/가입에서 예외(네트워크 오류 등) 시 무반응이던 버그 수정
//    v6: profiles 행이 없을 때 로그인이 안내 없이 튕기던 문제 수정
//    v7: 관리자 잔액 무관 활동, 요청사항(문의)·활동이력 탭 추가
//    v8: 자동로그인 토글, 색 테마 상점, 방 설계도·꾸미기, 통장 은행앱 UI
const CACHE = 'library-bank-v8';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './css/portfolio.css',
  './css/bookshelf.css',
  './js/config.js',
  './js/app.js',
  './js/themes.js',
  './js/auth.js',
  './js/books.js',
  './js/loans.js',
  './js/portfolio.js',
  './js/bookshelf.js',
  './js/settings.js',
  './js/admin.js',
  './js/events.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 하나씩 넣습니다. addAll 은 하나만 실패해도 전부 실패합니다.
    await Promise.all(ASSETS.map(async (url) => {
      try { await cache.add(url); }
      catch (err) { console.warn('[sw] 캐시 실패(무시):', url); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase API·CDN 등 외부는 캐시하지 않고 항상 네트워크로
  if (url.origin !== self.location.origin) return;

  // [D9] HTML·JS·CSS 는 "네트워크 우선".
  //   → 코드를 고쳐 올리면 사용자가 새로고침만 해도 최신본을 받습니다.
  //     (기존 '캐시 우선'은 캐시 번호를 손으로 안 올리면 옛 화면에 고착됐습니다)
  //   나머지 정적 자원(아이콘 등)은 '캐시 우선'으로 빠르게.
  const isAppShell = /\.(html|js|css)$/.test(url.pathname)
    || url.pathname === '/' || url.pathname.endsWith('/');

  if (isAppShell) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
        return res;
      } catch {
        // 오프라인이면 캐시본으로 폴백, 그것도 없으면 홈
        return (await caches.match(request))
            || (await caches.match('./index.html'))
            || Response.error();
      }
    })());
    return;
  }

  // 그 외 자원: 캐시 우선
  e.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
