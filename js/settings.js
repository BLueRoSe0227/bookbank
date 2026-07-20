/* ═══════════════════════════════════════════════════════════
   settings.js — 계정 설정
   [신규] PHP판에 없던 기능들입니다:
     · 비밀번호 변경 (기존엔 로그인 상태에서 바꿀 방법이 없었음)
     · 데이터 내보내기
     · 본인 탈퇴 (개인정보처리방침엔 있는데 기능이 없었음)
   ═══════════════════════════════════════════════════════════ */
const Settings = (() => {
  const load = async () => {
    const p = App.getProfile();
    const r = await App.rules();

    App.$('#setNickname').value   = p.nickname;
    App.$('#setEmail').textContent = p.email;
    App.$('#setJoined').textContent = App.fmtDate(p.created_at);
    App.$('#setBalance').textContent = `${p.balance.toLocaleString()}원`;

    // 포인트 규칙 안내 (온보딩 역할)
    App.$('#setRules').innerHTML = [
      ['🎁', '가입 보너스', `+${r.join_bonus}원`],
      ['📖', '대출 보증금', `-${r.loan_deposit}원 (반납 시 환급)`],
      ['✅', '정시 반납',   `+${r.return_bonus}원`],
      ['⏰', '연체',        `하루 -${r.overdue_fee}원`],
      ['📅', '대출 연장',   `-${r.extend_fee}원 (${r.extend_days}일)`],
      ['🏠', '서재 방 추가', `-${r.room_fee}원`],
    ].map(([i, n, v]) => App.h`
      <div class="rule-row">
        <span class="rule-icon" aria-hidden="true">${i}</span>
        <span class="rule-name">${n}</span>
        <span class="rule-value">${v}</span>
      </div>`).join('');

    await loadMyRequests();
    await Themes.load();
  };

  /* ── 문의하기 ── */
  const submitRequest = async (e) => {
    e?.preventDefault();
    App.clearErrors('[data-form="request"]');
    const content = App.$('#requestContent').value.trim();
    if (!content) return App.fieldError('#requestContent', '문의 내용을 입력해주세요.');

    const { error } = await db.rpc('submit_request', { p_content: content });
    if (error) return App.showToast(App.errMsg(error, '문의 전송 실패'), 'error');

    App.$('#requestContent').value = '';
    App.showToast('문의를 보냈습니다. 관리자 답변을 기다려주세요.', 'success');
    await loadMyRequests();
  };

  const loadMyRequests = async () => {
    const box = App.$('#myRequests');
    if (!box) return;
    const { data, error } = await db.from('requests')
      .select('id,content,status,reply,replied_at,created_at')
      .order('created_at', { ascending: false }).limit(20);

    if (error || !data?.length) { box.innerHTML = ''; return; }

    box.innerHTML = data.map(r => {
      const answered = r.status === 'answered';
      return App.h`
        <div class="request-card">
          <div class="request-head">
            <span class="request-meta">${App.fmtDate(r.created_at)} 문의</span>
            <span class="badge badge-${App.raw(answered ? 'ok' : 'warn')}">${answered ? '답변 완료' : '답변 대기'}</span>
          </div>
          <div class="request-body">${r.content}</div>
          ${answered ? App.h`
            <div class="request-reply">
              <span class="request-reply-label">관리자 답변</span>${r.reply}
            </div>` : App.raw('')}
        </div>`;
    }).join('');
  };

  /* ── 닉네임 변경 ── */
  const saveNickname = async (e) => {
    e?.preventDefault();
    App.clearErrors('[data-form="nickname"]');
    const nick = App.$('#setNickname').value.trim();
    if (nick.length < 2 || nick.length > 20)
      return App.fieldError('#setNickname', '닉네임은 2~20자로 입력해주세요.');

    const p = App.getProfile();
    const { error } = await db.from('profiles').update({ nickname: nick }).eq('id', p.id);
    if (error) {
      if (/duplicate/i.test(error.message))
        return App.fieldError('#setNickname', '이미 사용 중인 닉네임입니다.');
      return App.showToast(App.errMsg(error), 'error');
    }
    App.showToast('닉네임이 변경되었습니다.', 'success');
    await App.loadProfile(); await App.refreshHeader();
  };

  /* ── 비밀번호 변경 ── */
  const changePassword = async (e) => {
    e?.preventDefault();
    App.clearErrors('[data-form="password"]');
    const pw1 = App.$('#setNewPassword').value;
    const pw2 = App.$('#setNewPassword2').value;
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pw1))
      return App.fieldError('#setNewPassword', '비밀번호는 영문+숫자 포함 8자 이상이어야 합니다.');
    if (pw1 !== pw2)
      return App.fieldError('#setNewPassword2', '두 비밀번호가 일치하지 않습니다.');

    const { error } = await db.auth.updateUser({ password: pw1 });
    if (error) return App.showToast(App.errMsg(error), 'error');

    App.$('#setNewPassword').value = '';
    App.$('#setNewPassword2').value = '';
    App.showToast('비밀번호가 변경되었습니다.', 'success');
  };

  /* ── 데이터 내보내기 ── */
  const exportData = async () => {
    const { data, error } = await db.rpc('export_my_data');
    if (error) return App.showToast(App.errMsg(error, '내보내기 실패'), 'error');

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `독서통장_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    App.showToast('내 데이터를 내려받았습니다.', 'success');
  };

  /* ── 탈퇴 ── */
  const openDeleteModal = () => {
    App.$('#delConfirm').value = '';
    App.openModal('deleteAccountModal');
  };

  const deleteAccount = async (e) => {
    e?.preventDefault();
    App.clearErrors('#deleteAccountModal');
    if (App.$('#delConfirm').value.trim() !== '탈퇴합니다')
      return App.fieldError('#delConfirm', '확인 문구를 정확히 입력해주세요.');

    const { error } = await db.rpc('delete_my_account');
    if (error) return App.showToast(App.errMsg(error, '탈퇴 처리 실패'), 'error');

    App.closeModal('deleteAccountModal');
    App.showToast('탈퇴가 완료되었습니다. 그동안 이용해주셔서 감사합니다.', 'success');
    await db.auth.signOut();
    setTimeout(() => location.reload(), 1500);
  };

  return { load, saveNickname, changePassword, exportData, openDeleteModal, deleteAccount,
           submitRequest };
})();
