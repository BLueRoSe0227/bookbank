/* ═══════════════════════════════════════════════════════════
   admin.js — 관리자 대시보드
   ═══════════════════════════════════════════════════════════ */
const Admin = (() => {
  let _tab = 'pending';

  const load = async () => switchTab(_tab);

  const switchTab = async (tab, btn) => {
    _tab = tab;
    App.$$('#page-admin .tab').forEach(t => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const el = App.$('#adminContent');
    el.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
    if (tab === 'pending') return _pending(el);
    if (tab === 'members') return _members(el);
    if (tab === 'loans')   return _loans(el);
  };

  /* ── 승인 대기 ── */
  const _pending = async (el) => {
    const { data } = await db.from('profiles')
      .select('id,nickname,created_at').eq('role', 'pending')
      .order('created_at');

    if (!data?.length) {
      el.innerHTML = '<p class="empty-msg">승인 대기 중인 회원이 없습니다.</p>';
      return;
    }
    el.innerHTML = data.map(u => App.h`
      <div class="admin-row">
        <div class="admin-row-info">
          <b>${u.nickname}</b>
          <span class="admin-row-sub">${App.fmtDate(u.created_at)} 신청</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn btn-sm btn-primary" data-approve="${u.id}">승인</button>
          <button class="btn btn-sm btn-danger"  data-reject="${u.id}">거절</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('[data-approve]').forEach(b =>
      b.addEventListener('click', () => _approve(b.dataset.approve)));
    el.querySelectorAll('[data-reject]').forEach(b =>
      b.addEventListener('click', () => _reject(b.dataset.reject)));
  };

  const _approve = async (id) => {
    const { data, error } = await db.rpc('approve_member', { p_user: id });
    if (error) return App.showToast(App.errMsg(error, '승인 실패'), 'error');
    App.showToast(`승인 완료! ${data.balance}원이 지급되었습니다.`, 'success');
    await switchTab('pending');
  };

  const _reject = async (id) => {
    const ok = await App.confirmDialog('거절하면 이 가입 신청이 삭제됩니다. 계속할까요?',
      { okText: '거절', danger: true, title: '가입 거절' });
    if (!ok) return;
    const { error } = await db.from('profiles').delete().eq('id', id);
    if (error) return App.showToast(App.errMsg(error, '거절 실패'), 'error');
    App.showToast('거절 처리했습니다.', 'success');
    await switchTab('pending');
  };

  /* ── 회원 목록 ── */
  const _members = async (el) => {
    const { data } = await db.from('profiles')
      .select('id,nickname,role,balance,created_at,approved_at')
      .in('role', ['member', 'admin']).order('created_at', { ascending: false });

    if (!data?.length) { el.innerHTML = '<p class="empty-msg">회원이 없습니다.</p>'; return; }
    el.innerHTML = data.map(u => App.h`
      <div class="admin-row">
        <div class="admin-row-info">
          <b>${u.nickname}</b>
          ${u.role === 'admin' ? App.raw('<span class="badge badge-info">관리자</span>') : App.raw('')}
          <span class="admin-row-sub">잔액 ${u.balance.toLocaleString()}원 · ${App.fmtDate(u.created_at)} 가입</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn btn-sm btn-ghost" data-adjust="${u.id}" data-nick="${u.nickname}">
            포인트 조정
          </button>
        </div>
      </div>`).join('');

    el.querySelectorAll('[data-adjust]').forEach(b =>
      b.addEventListener('click', () => _openAdjust(b.dataset.adjust, b.dataset.nick)));
  };

  const _openAdjust = (id, nick) => {
    App.$('#adjUserId').value = id;
    App.$('#adjUserNick').textContent = nick;
    App.$('#adjAmount').value = '';
    App.$('#adjReason').value = '';
    App.openModal('adjustModal');
  };

  const submitAdjust = async (e) => {
    e?.preventDefault();
    const amount = parseInt(App.$('#adjAmount').value, 10);
    const reason = App.$('#adjReason').value.trim();
    if (!amount) return App.showToast('조정 금액을 입력해주세요.', 'error');
    if (!reason) return App.showToast('조정 사유를 입력해주세요.', 'error');

    const { data, error } = await db.rpc('admin_adjust_points', {
      p_user: App.$('#adjUserId').value, p_amount: amount, p_reason: reason,
    });
    if (error) return App.showToast(App.errMsg(error, '조정 실패'), 'error');
    App.closeModal('adjustModal');
    App.showToast(`조정 완료. 잔액 ${data.balance}원`, 'success');
    await switchTab('members');
  };

  /* ── 대출 현황 ── */
  const _loans = async (el) => {
    const { data } = await db.from('loans')
      .select('id,loan_date,target_end_date,status,profiles(nickname),books(title)')
      .in('status', ['active', 'overdue'])
      .order('target_end_date').limit(50);

    if (!data?.length) { el.innerHTML = '<p class="empty-msg">대출 중인 책이 없습니다.</p>'; return; }
    el.innerHTML = data.map(l => {
      const d = App.daysLeft(l.target_end_date);
      const cls = l.status === 'overdue' ? 'danger' : d <= 1 ? 'warning' : 'info';
      const label = l.status === 'overdue' ? `${Math.abs(d)}일 연체` : `${d}일 남음`;
      return App.h`
        <div class="admin-row">
          <div class="admin-row-info">
            <b>${l.books.title}</b>
            <span class="admin-row-sub">${l.profiles.nickname} · ${App.fmtDate(l.target_end_date)}까지</span>
          </div>
          <span class="badge badge-${App.raw(cls)}">${label}</span>
        </div>`;
    }).join('');
  };

  return { load, switchTab, submitAdjust };
})();
