/* ═══════════════════════════════════════════════════════════
   auth.js — 로그인 / 가입 / 비밀번호

   [변경] PHP판의 JWT 발급·refresh token·비밀번호 재설정 메일을
          전부 삭제했습니다. Supabase Auth 가 다 해줍니다. (약 300줄 → 이 파일)
   ═══════════════════════════════════════════════════════════ */
const Auth = (() => {
  const showAuthScreen = () => {
    App.$('#authScreen').classList.remove('hidden');
    App.$('#pendingScreen').classList.add('hidden');
    App.$('#appScreen').classList.add('hidden');
    // 저장된 자동 로그인 선택을 체크박스에 반영 (기본: 켜짐)
    const cb = App.$('#rememberMe');
    if (cb) cb.checked = localStorage.getItem('lb_remember') !== '0';
  };
  const showPendingScreen = () => {
    App.$('#authScreen').classList.add('hidden');
    App.$('#pendingScreen').classList.remove('hidden');
    App.$('#appScreen').classList.add('hidden');
    const p = App.getProfile();
    if (p) App.$('#pendingNick').textContent = p.nickname;
  };
  const showAppScreen = () => {
    App.$('#authScreen').classList.add('hidden');
    App.$('#pendingScreen').classList.add('hidden');
    App.$('#appScreen').classList.remove('hidden');
  };

  const switchTab = (tab) => {
    App.$$('.auth-tab').forEach(t => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    App.$('#loginForm').classList.toggle('hidden', tab !== 'login');
    App.$('#signupForm').classList.toggle('hidden', tab !== 'signup');
  };

  /* ── 로그인 ── */
  const login = async (e) => {
    e?.preventDefault();
    App.clearErrors('#loginForm');
    const email = App.$('#loginEmail').value.trim();
    const pw    = App.$('#loginPassword').value;
    if (!email) return App.fieldError('#loginEmail', '이메일을 입력해주세요.');
    if (!pw)    return App.fieldError('#loginPassword', '비밀번호를 입력해주세요.');

    // 자동 로그인 토글: 로그인 직전에 세션 저장 위치(local/session)를 확정합니다.
    // (config.js 의 rememberStorage 가 이 플래그를 읽습니다)
    const remember = App.$('#rememberMe')?.checked ?? true;
    localStorage.setItem('lb_remember', remember ? '1' : '0');

    const btn = App.$('#loginBtn');
    btn.disabled = true; btn.textContent = '로그인 중...';
    try {
      const { error } = await db.auth.signInWithPassword({ email, password: pw });
      if (error) {
        // Supabase 영어 메시지를 한글로. 로그인 실패는 비밀번호 칸 아래에 남깁니다.
        if (/Invalid login credentials/i.test(error.message))
          return App.fieldError('#loginPassword', '이메일 또는 비밀번호가 올바르지 않습니다.');
        if (/Email not confirmed/i.test(error.message))
          return App.fieldError('#loginEmail', '이메일 인증을 먼저 완료해주세요. 메일함을 확인하세요.');
        return App.showToast(App.errMsg(error), 'error');
      }
      await App.boot();
    } catch (e) {
      // signInWithPassword 가 {error} 대신 예외를 던지는 경우(네트워크 끊김 등).
      // catch 가 없으면 버튼만 원상복구되고 아무 안내 없이 조용히 실패합니다.
      App.showToast(App.errMsg(e), 'error');
    } finally {
      btn.disabled = false; btn.textContent = '로그인';
    }
  };

  /* ── 가입 ── */
  const signup = async (e) => {
    e?.preventDefault();
    App.clearErrors('#signupForm');
    const nick  = App.$('#signupNickname').value.trim();
    const email = App.$('#signupEmail').value.trim();
    const pw    = App.$('#signupPassword').value;

    if (nick.length < 2 || nick.length > 20)
      return App.fieldError('#signupNickname', '닉네임은 2~20자로 입력해주세요.');
    if (!email)
      return App.fieldError('#signupEmail', '이메일을 입력해주세요.');
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw))
      return App.fieldError('#signupPassword', '비밀번호는 영문+숫자 포함 8자 이상이어야 합니다.');

    const btn = App.$('#signupBtn');
    btn.disabled = true; btn.textContent = '가입 중...';
    try {
      const { error } = await db.auth.signUp({
        email, password: pw,
        options: { data: { nickname: nick } },   // 트리거가 profiles 생성에 사용
      });
      if (error) {
        if (/already registered/i.test(error.message))
          return App.fieldError('#signupEmail', '이미 가입된 이메일입니다.');
        if (/duplicate key.*nickname/i.test(error.message))
          return App.fieldError('#signupNickname', '이미 사용 중인 닉네임입니다.');
        return App.showToast(App.errMsg(error), 'error');
      }
      App.showToast('가입 신청 완료! 관리자 승인 후 이용할 수 있습니다.', 'success');
      switchTab('login');
    } catch (e) {
      App.showToast(App.errMsg(e), 'error');
    } finally {
      btn.disabled = false; btn.textContent = '가입 신청';
    }
  };

  const logout = async () => {
    await db.auth.signOut();
    location.reload();
  };

  /* ── 비밀번호 찾기 (Supabase가 메일 발송) ── */
  const forgotPassword = async (e) => {
    e?.preventDefault();
    App.clearErrors('#forgotModal');
    const email = App.$('#forgotEmail').value.trim();
    if (!email) return App.fieldError('#forgotEmail', '이메일을 입력해주세요.');

    // 보안: 가입 여부를 알려주지 않기 위해 결과와 무관하게 같은 안내를 보여줍니다.
    // 그래서 반환된 error 는 의도적으로 사용하지 않습니다.
    await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    App.closeModal('forgotModal');
    App.showToast('이메일을 확인해주세요. (가입된 이메일인 경우 발송됩니다)', 'success');
  };

  /* ── 재설정 링크로 들어왔을 때 ── */
  const showResetPasswordForm = () => {
    showAuthScreen();
    App.openModal('resetModal');
  };

  const submitNewPassword = async (e) => {
    e?.preventDefault();
    App.clearErrors('#resetModal');
    const pw = App.$('#resetPassword').value;
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw))
      return App.fieldError('#resetPassword', '비밀번호는 영문+숫자 포함 8자 이상이어야 합니다.');

    const { error } = await db.auth.updateUser({ password: pw });
    if (error) return App.showToast(App.errMsg(error), 'error');

    App.closeModal('resetModal');
    App.showToast('비밀번호가 변경되었습니다.', 'success');
    await App.boot();
  };

  return {
    showAuthScreen, showPendingScreen, showAppScreen, showResetPasswordForm,
    switchTab, login, signup, logout, forgotPassword, submitNewPassword,
  };
})();
