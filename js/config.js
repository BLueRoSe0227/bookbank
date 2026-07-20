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

// ── 아래는 건드리지 마세요 ──────────────────────────────────
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // 새로고침해도 로그인 유지
    autoRefreshToken: true,     // 토큰 자동 갱신 (PHP판의 refresh 로직을 대체)
    detectSessionInUrl: true,   // 비밀번호 재설정 링크 처리
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
