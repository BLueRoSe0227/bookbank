/* ═══════════════════════════════════════════════════════════
   app.js — 공통 유틸 / 화면 전환 / 인증 상태

   [v3 핵심 변경] escapeHtml 도입
     이전 버전은 서버가 저장 전에 HTML을 이스케이프했습니다. 그 결과
     닉네임 "이건 'test' 야" 가 "이건 &#039;test&#039;" 로 저장되고
     마지막 글자가 잘려 사라지는 버그가 있었습니다.
     → 이제 원본 그대로 저장하고, 화면에 그릴 때 여기서 이스케이프합니다.
   ═══════════════════════════════════════════════════════════ */

const App = (() => {
  let _profile = null;
  let _rules   = null;

  /* ── XSS 방어 ───────────────────────────────────────────
     화면에 사용자 데이터를 넣을 때는 반드시 이걸 통과시킵니다.
     책 제목에 <script> 가 들어있어도 글자로만 보이게 됩니다. */
  const escapeHtml = (v) => {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  /* 태그드 템플릿: h`<p>${제목}</p>` 처럼 쓰면 ${} 안이 자동 이스케이프됩니다.
     의도적으로 HTML을 넣고 싶을 때만 raw() 로 감쌉니다. */
  const RAW = Symbol('raw');
  const raw = (html) => ({ [RAW]: String(html) });
  const h = (strings, ...values) =>
    strings.reduce((out, s, i) => {
      if (i >= values.length) return out + s;
      const v = values[i];
      const piece = (v && typeof v === 'object' && RAW in v) ? v[RAW] : escapeHtml(v);
      return out + s + piece;
    }, '');

  /* ── 화면 ─────────────────────────────────────────────── */
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const showToast = (msg, type = 'info') => {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.textContent = msg;                       // textContent = 이스케이프 불필요
    $('#toastArea').appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 3000);
  };

  const navigate = (page) => {
    $$('.page').forEach(p => p.classList.remove('active'));
    $(`#page-${page}`)?.classList.add('active');
    $$('.nav-item').forEach(b => {
      const on = b.dataset.page === page;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    window.scrollTo(0, 0);

    const loaders = {
      home:      () => Loans.loadSummary(),
      register:  () => Books.init(),
      myloans:   () => Loans.loadList(),
      passbook:  () => Loans.loadTransactions(),
      portfolio: () => Portfolio.load(),
      bookshelf: () => Bookshelf.load(),
      settings:  () => Settings.load(),
      admin:     () => Admin.load(),
    };
    loaders[page]?.();
  };

  const openModal  = (id) => { $(`#${id}`)?.classList.add('active'); };
  const closeModal = (id) => { $(`#${id}`)?.classList.remove('active'); };

  /* ── 프로필 / 경제 규칙 ───────────────────────────────── */
  const getProfile = () => _profile;

  const loadProfile = async () => {
    const { data: { user } } = await db.auth.getUser();
    if (!user) { _profile = null; return null; }
    const { data, error } = await db
      .from('profiles')
      .select('id,nickname,role,balance,created_at')
      .eq('id', user.id)
      .single();
    if (error) { _profile = null; return null; }
    _profile = { ...data, email: user.email };
    return _profile;
  };

  const rules = async () => {
    if (_rules) return _rules;
    // [D4] 규칙 8개를 한 번의 RPC로. (기존엔 app_config 를 8번 왕복했습니다)
    const { data, error } = await db.rpc('app_config_all');
    if (!error && data) { _rules = data; return _rules; }

    // 구버전 DB(app_config_all 없음) 대비 폴백
    const keys = ['loan_deposit','return_bonus','overdue_fee','room_fee',
                  'extend_fee','extend_days','extend_max','join_bonus'];
    const out = {};
    await Promise.all(keys.map(async k => {
      const { data } = await db.rpc('app_config', { key: k });
      out[k] = data ?? 0;
    }));
    _rules = out;
    return out;
  };

  /* 장르 목록 — 등록 화면의 <select> 를 채웁니다.
     자주 바뀌지 않으므로 한 번만 받아 재사용합니다. */
  let _genres = null;
  const genres = async () => {
    if (_genres) return _genres;
    const { data, error } = await db.from('genres').select('id,name').order('sort');
    _genres = (!error && data) ? data : [];
    return _genres;
  };

  const refreshHeader = async () => {
    const p = _profile;
    if (!p) return;
    $('#headerNick').textContent    = p.nickname;
    $('#headerBalance').textContent = `${p.balance.toLocaleString()}원`;
    $('#adminNavItem')?.classList.toggle('hidden', p.role !== 'admin');
  };

  /* ── 에러 메시지 정리 ──────────────────────────────────
     DB 함수가 던진 한글 메시지를 그대로 보여주고,
     Postgres 내부 코드 같은 건 사용자에게 노출하지 않습니다. */
  const errMsg = (error, fallback = '오류가 발생했습니다.') => {
    if (!error) return fallback;
    const m = error.message || '';
    // [D6] 네트워크 실패/프로젝트 일시정지를 사용자 말로 안내
    if (/failed to fetch|networkerror|load failed|fetch failed/i.test(m))
      return '서버에 연결할 수 없어요. 잠시 후 다시 시도해주세요. (무료 플랜이 일시정지되었을 수 있어요)';
    if (/could not find the function/i.test(m))
      return '서버 업데이트가 필요합니다. 관리자에게 문의해주세요.';
    if (/duplicate key/i.test(m))      return '이미 존재합니다.';
    if (/permission denied/i.test(m))  return '권한이 없습니다.';
    if (/JWT|not authenticated/i.test(m)) return '로그인이 필요합니다.';
    // DB 함수에서 raise exception 으로 던진 한글 메시지는 그대로 표시
    return m || fallback;
  };

  /* ── 날짜 ─────────────────────────────────────────────── */
  const fmtDate = (d) => {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`;
  };
  const daysLeft = (target) => {
    const t = new Date(target); t.setHours(0,0,0,0);
    const n = new Date();      n.setHours(0,0,0,0);
    return Math.round((t - n) / 86400000);
  };

  /* [D5] 로컬 기준 YYYY-MM-DD.
     기존 코드는 toISOString()(UTC)을 써서 KST 자정 근처 날짜가 하루 어긋났습니다. */
  const toISODate = (d) => {
    const dt = d instanceof Date ? d : new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  };
  const today   = () => toISODate(new Date());
  const addDays = (n, from = new Date()) => {
    const d = new Date(from); d.setDate(d.getDate() + n); return toISODate(d);
  };

  /* [X2] 생성형 표지 — 표지 이미지가 없어도 제목마다 색이 다르게.
     서재 책등 색과 같은 "제목→색" 은유를 재사용합니다. */
  const _coverHue = (str) => {
    let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  };
  const genCover = (title, extraClass = '') => {
    const t = (String(title || '').trim()) || '?';
    const hue = _coverHue(t);
    const bg = `linear-gradient(150deg, hsl(${hue} 46% 42%), hsl(${(hue + 40) % 360} 52% 32%))`;
    return raw(`<div class="gen-cover ${escapeHtml(extraClass)}" aria-hidden="true" `
      + `style="background:${bg}"><span>${escapeHtml(t.slice(0, 1))}</span></div>`);
  };

  /* [X1] 프로미스 기반 확인 대화상자 (네이티브 confirm 대체) */
  let _confirmResolve = null;
  const confirmDialog = (message, { okText = '확인', danger = false, title = '확인' } = {}) => {
    $('#confirmTitle').textContent = title;
    $('#confirmBody').textContent  = message;
    const ok = $('#confirmOkBtn');
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    openModal('confirmModal');
    ok.focus();
    return new Promise((res) => { _confirmResolve = res; });
  };
  const _resolveConfirm = (val) => {
    closeModal('confirmModal');
    if (_confirmResolve) { const r = _confirmResolve; _confirmResolve = null; r(val); }
  };

  /* [P8] 이벤트 로그 (fire-and-forget, 실패해도 앱 흐름에 영향 없음) */
  const logEvent = (type, meta = {}) => {
    try { db.rpc('log_event', { p_type: type, p_meta: meta }); } catch { /* 무시 */ }
  };

  /* ── 테마 ─────────────────────────────────────────────── */
  const initTheme = () => {
    const saved = localStorage.getItem('theme');
    const dark  = saved ? saved === 'dark'
                        : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  };
  const toggleTheme = () => {
    const now  = document.documentElement.getAttribute('data-theme');
    const next = now === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  /* [D6] 서버에 아예 닿지 못할 때(오프라인·프로젝트 정지) 보여줄 화면.
     inline onclick 은 CSP 때문에 못 쓰므로 요소를 직접 만들어 붙입니다. */
  const showConnError = () => {
    const wrap = document.createElement('div');
    wrap.className = 'conn-error';
    wrap.innerHTML = '<div class="conn-icon" aria-hidden="true">📡</div>'
      + '<p>서버에 연결할 수 없어요.<br>인터넷 연결을 확인하거나 잠시 후 다시 시도해주세요.</p>';
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '다시 시도';
    btn.addEventListener('click', () => location.reload());
    wrap.appendChild(btn);
    document.body.innerHTML = '';
    document.body.appendChild(wrap);
  };

  /* [X8] 첫 방문 온보딩 */
  const maybeOnboard = () => {
    if (localStorage.getItem('onboarded_v1')) return;
    openModal('onboardModal');
  };
  const finishOnboard = () => {
    localStorage.setItem('onboarded_v1', '1');
    closeModal('onboardModal');
  };

  /* ── 시작 ─────────────────────────────────────────────── */
  const boot = async () => {
    initTheme();

    // 로그인 상태가 바뀌면(로그인/로그아웃/토큰갱신) 자동으로 화면 갱신
    db.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { _profile = null; Auth.showAuthScreen(); }
      if (event === 'PASSWORD_RECOVERY') { Auth.showResetPasswordForm(); }
    });

    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session) { Auth.showAuthScreen(); return; }

      const p = await loadProfile();
      if (!p) { await db.auth.signOut(); Auth.showAuthScreen(); return; }

      if (p.role === 'pending') { Auth.showPendingScreen(); return; }

      Auth.showAppScreen();
      await refreshHeader();
      navigate('home');
      maybeOnboard();
    } catch (e) {
      console.error('[boot]', e);
      showConnError();
    }
  };

  /* [D9] 서비스 워커 등록 — 기존엔 등록 코드가 없어 sw.js 가 죽어 있었습니다. */
  const registerSW = () => {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err =>
        console.warn('[sw] 등록 실패:', err));
    });
  };

  return {
    escapeHtml, h, raw, $, $$,
    showToast, navigate, openModal, closeModal,
    getProfile, loadProfile, refreshHeader, rules, genres,
    errMsg, fmtDate, daysLeft, toISODate, today, addDays,
    genCover, confirmDialog, _resolveConfirm, logEvent,
    finishOnboard, toggleTheme, boot, registerSW,
  };
})();

document.addEventListener('DOMContentLoaded', () => { App.boot(); });
App.registerSW();
