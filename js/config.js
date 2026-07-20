/* ═══════════════════════════════════════════════════════════
   config.js — Supabase 접속 정보

   ★ 여기 두 줄만 바꾸면 됩니다. ★

   Supabase 대시보드 → 왼쪽 아래 Settings(톱니) → API 에서 복사하세요.
     SUPABASE_URL      = "Project URL"
     SUPABASE_ANON_KEY = "Project API keys" 의 anon / public 키

   ❓ anon 키를 이렇게 공개해도 되나요?
      네, 괜찮습니다. 이 키는 "공개용"으로 설계된 키입니다.
      실제 보안은 DB의 RLS(Row Level Security) 정책이 담당합니다.
      → 로그인해도 남의 데이터는 DB가 막습니다.
      ⚠️ 단, service_role 키는 절대 여기에 넣으면 안 됩니다. 그건 만능 키입니다.
   ═══════════════════════════════════════════════════════════ */

const SUPABASE_URL      = 'https://ptllemacoknfhxanjtna.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0bGxlbWFjb2tuZmh4YW5qdG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4NDk3NzAsImV4cCI6MjA5OTQyNTc3MH0.UoKC6G5lW5aCe1W2yb--xay8yTiz8Rldxns2UH0Cqyw';

// ── 자동 로그인 토글 ────────────────────────────────────────
//  체크 시 localStorage 에 세션을 저장 → 브라우저를 닫아도 로그인 유지.
//  해제 시 sessionStorage 에 저장 → 탭을 닫으면 로그아웃(자동 로그인 안 함).
//  세션 토큰이 어느 저장소로 갈지를 이 어댑터가 lb_remember 플래그를 매번
//  읽어 결정합니다. 로그인 화면 체크박스가 로그인 직전에 이 플래그를 씁니다.
const REMEMBER_KEY = 'lb_remember';
const _pickStore = () =>
  (window.localStorage.getItem(REMEMBER_KEY) !== '0')   // 기본값: 유지
    ? window.localStorage : window.sessionStorage;
const rememberStorage = {
  // 전환 직후에도 읽히도록 두 저장소를 모두 확인합니다.
  getItem:    (k) => window.localStorage.getItem(k) ?? window.sessionStorage.getItem(k),
  setItem:    (k, v) => {
    const store = _pickStore();
    store.setItem(k, v);
    (store === window.localStorage ? window.sessionStorage : window.localStorage).removeItem(k);
  },
  removeItem: (k) => { window.localStorage.removeItem(k); window.sessionStorage.removeItem(k); },
};

// ── 아래는 건드리지 마세요 ──────────────────────────────────
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // 새로고침해도 로그인 유지
    autoRefreshToken: true,     // 토큰 자동 갱신 (PHP판의 refresh 로직을 대체)
    detectSessionInUrl: true,   // 비밀번호 재설정 링크 처리
    storage: rememberStorage,   // 자동 로그인 토글에 따라 local/session 선택
  },
});

// 설정이 안 된 상태면 바로 알려줌 (원인 모를 오류로 헤매지 않도록)
if (SUPABASE_URL.includes('여기에') || SUPABASE_ANON_KEY.includes('여기에')) {
  document.addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML =
      '<div style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px;' +
      'border:2px solid #C97070;border-radius:12px;line-height:1.7">' +
      '<h2 style="color:#C97070;margin-top:0">⚙️ 설정이 필요합니다</h2>' +
      '<p><b>js/config.js</b> 파일을 열어서 맨 위 두 줄을 채워주세요.</p>' +
      '<pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow:auto">' +
      "const SUPABASE_URL      = 'https://xxxxx.supabase.co';\n" +
      "const SUPABASE_ANON_KEY = 'eyJhbGci...';</pre>" +
      '<p style="color:#666;font-size:14px">Supabase 대시보드 → Settings → API 에서 복사할 수 있습니다.</p>' +
      '</div>';
  });
}
