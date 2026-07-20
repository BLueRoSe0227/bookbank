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

  /* ── 폼 오류를 필드 옆에 고정 ──────────────────────────
     토스트는 3초 뒤 사라져서 사용자가 놓치기 쉽습니다. 입력값이 잘못된 경우는
     해당 칸 아래에 붙여두고, 고칠 때까지 남겨둡니다.
     (원래 등록 폼에만 있던 방식을 모든 폼으로 넓혔습니다) */
  const fieldError = (sel, msg) => {
    const input = $(sel);
    if (!input) return;
    const field = input.closest('.field');
    if (!field) return showToast(msg, 'error');   // .field 밖이면 토스트로 폴백
    field.classList.add('has-error');
    let err = field.querySelector('.field-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'field-error';
      err.setAttribute('role', 'alert');
      field.appendChild(err);
    }
    err.textContent = '⚠ ' + msg;
    input.focus();
  };

  /* scope 안(폼·모달)의 오류 표시를 모두 지웁니다. 생략하면 화면 전체. */
  const clearErrors = (scope) => {
    const root = scope ? $(scope) : document;
    root?.querySelectorAll('.field.has-error').forEach(f => {
      f.classList.remove('has-error');
      f.querySelector('.field-error')?.remove();
    });
  };

  /* 로딩 표시 — 예전엔 관리자 화면에만 있어서 다른 화면은 느린 네트워크에서
     빈 화면으로 보였습니다. 데이터를 불러오는 곳은 모두 이걸 먼저 부릅니다. */
  const showLoading = (sel) => {
    const el = $(sel);
    if (el) el.innerHTML = '<div class="loading-wrap"><div class="spinner" role="status" '
                         + 'aria-label="불러오는 중"></div></div>';
  };

  /* 빈 상태 — 문구만 있으면 다음에 뭘 해야 할지 알 수 없습니다.
     아이콘 + 설명 + (선택) 버튼 한 개로 통일합니다.
     action: { label, page } — 누르면 해당 화면으로 이동 */
  const emptyState = (icon, message, action = null) => {
    const btn = action
      ? `<button class="btn btn-primary btn-sm empty-cta" type="button" `
        + `data-page="${escapeHtml(action.page)}">${escapeHtml(action.label)}</button>`
      : '';
    return `<div class="empty-state">`
      + `<div class="empty-icon" aria-hidden="true">${escapeHtml(icon)}</div>`
      + `<p class="empty-text">${escapeHtml(message)}</p>${btn}</div>`;
  };

  /* emptyState 로 그린 버튼을 화면 이동에 연결합니다 (innerHTML 로 그린 뒤 호출). */
  const wireEmptyCta = (root) => {
    (root ? [root] : $$('.page')).forEach(r =>
      r.querySelectorAll('.empty-cta').forEach(b =>
        b.addEventListener('click', () => navigate(b.dataset.page))));
  };

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

  /* ── 모달 + 포커스 트랩 ────────────────────────────────
     모달이 열려 있는 동안 Tab 이 뒤 화면으로 빠져나가면 키보드·스크린리더
     사용자는 자기가 어디에 있는지 알 수 없게 됩니다.
     열 때: 직전 포커스를 기억하고 모달 안으로 이동
     닫을 때: 원래 있던 자리로 되돌려 놓기 */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]),'
                  + ' select:not([disabled]), textarea:not([disabled]),'
                  + ' [tabindex]:not([tabindex="-1"])';

  const _focusables = (root) =>
    Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);

  const _focusReturn = [];   // 중첩 모달을 대비해 스택으로 둡니다

  const openModal = (id) => {
    const m = $(`#${id}`);
    if (!m || m.classList.contains('active')) return;
    _focusReturn.push(document.activeElement);
    m.classList.add('active');
    // 닫기(X)보다는 실제 내용에 먼저 포커스를 둡니다
    const items = _focusables(m);
    (items.find(el => !el.classList.contains('modal-close')) || items[0])?.focus();
  };

  const closeModal = (id) => {
    const m = $(`#${id}`);
    if (!m || !m.classList.contains('active')) return;
    m.classList.remove('active');
    const back = _focusReturn.pop();
    if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
  };

  /* Tab 이 모달 밖으로 나가려 하면 반대쪽 끝으로 돌려보냅니다.
     맨 위에 열린 모달 하나만 대상으로 합니다. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const open = $$('.modal.active');
    if (!open.length) return;
    const modal = open[open.length - 1];
    const items = _focusables(modal);
    if (!items.length) return;

    const first = items[0], last = items[items.length - 1];
    if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

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
  /* 노랑~연두(hue 40~170) 는 같은 명도라도 눈에 훨씬 밝게 보여서
     흰 글자와의 대비가 부족해집니다. 그 구간만 어둡게 보정합니다. */
  const _coverLight = (hue) => (hue >= 40 && hue <= 170 ? 33 : 42);

  const genCover = (title, extraClass = '') => {
    const t = (String(title || '').trim()) || '?';
    const hue = _coverHue(t);
    const l = _coverLight(hue);
    const hue2 = (hue + 40) % 360;
    const bg = `linear-gradient(150deg, hsl(${hue} 46% ${l}%), hsl(${hue2} 52% ${_coverLight(hue2) - 10}%))`;
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
      Admin.checkPending();   // 관리자면 승인 대기 건수를 탭바에 표시 (실패해도 무시)
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
    showToast, showLoading, emptyState, wireEmptyCta, fieldError, clearErrors,
    navigate, openModal, closeModal,
    getProfile, loadProfile, refreshHeader, rules, genres,
    errMsg, fmtDate, daysLeft, toISODate, today, addDays,
    genCover, confirmDialog, _resolveConfirm, logEvent,
    finishOnboard, toggleTheme, boot, registerSW,
  };
})();

document.addEventListener('DOMContentLoaded', () => { App.boot(); });
App.registerSW();
