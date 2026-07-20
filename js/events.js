/* ═══════════════════════════════════════════════════════════
   events.js — 화면의 정적 요소들을 각 모듈에 연결합니다.

   [변경] PHP판 index.html 은 onclick="Admin.switchTab(...)" 같은
          인라인 핸들러를 60개 쓰고 있었습니다. 그러면 CSP(콘텐츠 보안 정책)를
          걸 수 없어서 XSS 방어의 마지막 수단을 포기하게 됩니다.
          → 여기서 이벤트 위임으로 한 번에 처리합니다. HTML엔 onclick 이 0개입니다.
   ═══════════════════════════════════════════════════════════ */
(() => {
  const on = (sel, ev, fn) => App.$$(sel).forEach(el => el.addEventListener(ev, fn));

  document.addEventListener('DOMContentLoaded', () => {

    /* ── 하단 탭바 ─────────────────────────────────────── */
    on('.nav-item', 'click', (e) => {
      const page = e.currentTarget.dataset.page;
      if (page) App.navigate(page);
    });

    /* ── 로그인/가입 탭 ────────────────────────────────── */
    on('.auth-tab', 'click', (e) => Auth.switchTab(e.currentTarget.dataset.tab));

    /* ── 관리자 탭 ─────────────────────────────────────── */
    on('#page-admin .tab', 'click', (e) =>
      Admin.switchTab(e.currentTarget.dataset.tab, e.currentTarget));

    /* ── 폼 제출 (엔터키가 그대로 동작합니다) ──────────── */
    App.$('#loginForm') ?.addEventListener('submit', Auth.login);
    App.$('#signupForm')?.addEventListener('submit', Auth.signup);
    on('[data-form="forgot"]',   'submit', Auth.forgotPassword);
    on('[data-form="reset"]',    'submit', Auth.submitNewPassword);
    on('[data-form="nickname"]', 'submit', (e) => { e.preventDefault(); Settings.saveNickname(); });
    on('[data-form="password"]', 'submit', (e) => { e.preventDefault(); Settings.changePassword(); });
    App.$('#registerForm')?.addEventListener('submit', Books.submitLoan);

    /* ── 모달 열기/닫기 ────────────────────────────────── */
    on('[data-open]',  'click', (e) => App.openModal(e.currentTarget.dataset.open));
    on('[data-close]', 'click', (e) => {
      // 확인 대화상자를 X로 닫으면 "취소"로 처리
      if (e.currentTarget.dataset.close === 'confirmModal') return App._resolveConfirm(false);
      App.closeModal(e.currentTarget.dataset.close);
    });

    // 모달 바깥(어두운 배경)을 누르면 닫기
    // classList 를 직접 건드리지 않고 App.closeModal 을 거칩니다 — 그래야
    // 포커스가 원래 자리로 돌아갑니다.
    on('.modal', 'click', (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.currentTarget.id === 'confirmModal') return App._resolveConfirm(false);
      App.closeModal(e.currentTarget.id);
    });

    // ESC 로 열린 모달 닫기 (맨 위 것 하나만)
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = App.$$('.modal.active');
      if (!open.length) return;
      const top = open[open.length - 1];
      if (top.id === 'confirmModal') App._resolveConfirm(false);
      else App.closeModal(top.id);
    });

    /* ── [X1] 확인 대화상자 ───────────────────────────── */
    App.$('#confirmOkBtn')    ?.addEventListener('click', () => App._resolveConfirm(true));
    App.$('#confirmCancelBtn')?.addEventListener('click', () => App._resolveConfirm(false));

    /* ── [X8] 온보딩 ──────────────────────────────────── */
    App.$('#onboardOkBtn')?.addEventListener('click', () => App.finishOnboard());

    /* ── 각종 동작 버튼 ────────────────────────────────── */
    const actions = {
      'logout':         () => Auth.logout(),
      'theme':          () => App.toggleTheme(),
      'export':         () => Settings.exportData(),
      'delete-account': () => Settings.deleteAccount(),
      'submit-adjust':  () => Admin.submitAdjust(),
      'submit-room':    () => Bookshelf.submitRoom(),
      'delete-room':    () => Bookshelf.deleteRoom(),
      'open-addbook':   () => Bookshelf.openAddBook(),
      'submit-addbook': () => Bookshelf.submitAddBook(),
    };
    on('[data-action]', 'click', (e) => actions[e.currentTarget.dataset.action]?.());

    /* ── 서재: 방 추가 버튼 ────────────────────────────── */
    on('[data-open-roomform]', 'click', () => Bookshelf.openRoomForm());

    /* ── 반납 버튼 ─────────────────────────────────────── */
    // (대출 신청은 위 #registerForm submit 이 처리합니다)
    App.$('#returnSubmitBtn')?.addEventListener('click', () => Loans.submitReturn());

    /* ── 비밀번호 재설정 링크로 들어온 경우 ────────────── */
    // Supabase 는 재설정 링크를 주소 뒤 #access_token=...&type=recovery 로 붙여줍니다.
    if (window.location.hash.includes('type=recovery')) {
      Auth.showResetPasswordForm();
    }
  });
})();
