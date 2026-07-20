/* ═══════════════════════════════════════════════════════════
   admin.js — 관리자 대시보드
   ═══════════════════════════════════════════════════════════ */
const Admin = (() => {
  let _tab = 'pending';

  const load = async () => switchTab(_tab);

  /* ── 승인 대기 배지 (PM2) ──────────────────────────────────
     관리자가 관리 화면을 열어보지 않으면 신규 가입자가 무기한 대기하게 됩니다.
     하단 탭바의 '관리' 아이콘과 '승인 대기' 탭에 건수를 띄워 눈에 띄게 합니다. */
  const refreshPendingBadge = (count) => {
    const n = Number(count) || 0;
    [['#adminNavItem', '.nav-badge'], ['#adminTabPending', '.tab-badge']].forEach(([host, cls]) => {
      const parent = App.$(host);
      if (!parent) return;
      let badge = parent.querySelector(cls);
      if (!n) { badge?.remove(); return; }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = cls.slice(1);
        parent.appendChild(badge);
      }
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.setAttribute('aria-label', `승인 대기 ${n}명`);
    });
  };

  /* 관리자로 로그인했을 때 화면 진입 없이도 건수를 미리 세어둡니다. */
  const checkPending = async () => {
    if (App.getProfile()?.role !== 'admin') return;
    const { count } = await db.from('profiles')
      .select('*', { count: 'exact', head: true }).eq('role', 'pending');
    refreshPendingBadge(count ?? 0);
  };

  // 두 번째 인자(누른 버튼)는 events.js 가 넘겨주지만 여기선 쓰지 않습니다.
  const switchTab = async (tab, _btn) => {
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
    if (tab === 'stats')   return _stats(el);
  };

  /* ── 승인 대기 ── */
  const _pending = async (el) => {
    const { data } = await db.from('profiles')
      .select('id,nickname,created_at').eq('role', 'pending')
      .order('created_at');

    refreshPendingBadge(data?.length ?? 0);

    if (!data?.length) {
      el.innerHTML = App.emptyState('☕', '승인 대기 중인 회원이 없습니다.');
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

    if (!data?.length) { el.innerHTML = App.emptyState('👤', '아직 회원이 없습니다.'); return; }
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
    App.clearErrors('#adjustModal');
    const amount = parseInt(App.$('#adjAmount').value, 10);
    const reason = App.$('#adjReason').value.trim();
    if (!amount) return App.fieldError('#adjAmount', '조정 금액을 입력해주세요. (0은 안 됩니다)');
    if (!reason) return App.fieldError('#adjReason', '조정 사유를 입력해주세요.');

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

    if (!data?.length) { el.innerHTML = App.emptyState('📕', '대출 중인 책이 없습니다.'); return; }
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

  /* ── 통계 (PM6) + 연체 처리 감시 (PM3) ── */
  const EVENT_NAMES = {
    loan_create: '대출 신청', loan_return: '반납', loan_extend: '연장',
  };

  const _stats = async (el) => {
    const { data: s, error } = await db.rpc('admin_stats');
    if (error) {
      el.innerHTML = App.emptyState('⚠️',
        '통계를 불러오지 못했습니다. 004 마이그레이션이 적용되었는지 확인해주세요.');
      return;
    }

    // 연체 처리가 멈췄는지 판단: 부과됐어야 할 건이 남아 있으면 경고
    const stuck = (s.overdue_pending ?? 0) > 0;
    const lastRun = s.overdue_last_run ? App.fmtDate(s.overdue_last_run) : '기록 없음';

    const tiles = [
      ['📖', s.returned_this_month, '이번 달 완독'],
      ['👥', s.readers_this_month,  '이번 달 완독자'],
      ['✅', `${s.completion_rate}%`, '완독률'],
      ['📕', s.loans_active,        '대출 중'],
      ['⏰', s.loans_overdue,       '연체 중'],
      ['🙋', s.members_total,       '회원 수'],
    ].map(([i, n, l]) => App.h`
      <div class="pf-summary-card">
        <div class="pf-summary-icon" aria-hidden="true">${i}</div>
        <div class="pf-summary-num">${n}</div>
        <div class="pf-summary-label">${l}</div>
      </div>`).join('');

    const events = (s.events_14d ?? []);
    const eventRows = events.length
      ? events.map(e => App.h`
          <div class="rule-row">
            <span class="rule-name">${EVENT_NAMES[e.type] || e.type}</span>
            <span class="rule-value">${e.n}건</span>
          </div>`).join('')
      : '<p class="empty-msg">최근 14일간 기록된 활동이 없습니다.</p>';

    el.innerHTML = `
      <div class="pf-summary">${tiles}</div>

      <div class="card">
        <h2 class="card-title">연체 처리 상태</h2>
        <div class="${stuck ? 'notice notice-warning' : 'notice'}">
          ${App.escapeHtml(
            stuck
              ? `아직 부과되지 않은 연체가 ${s.overdue_pending}건 있습니다. `
                + '자동 처리(pg_cron)가 멈췄을 수 있으니 아래 버튼으로 실행해주세요.'
              : '정상입니다. 밀린 연체 부과가 없습니다.')}
        </div>
        <p class="card-desc">마지막 부과일: ${App.escapeHtml(lastRun)}</p>
        <button class="btn btn-secondary btn-sm" id="runOverdueBtn" type="button">
          지금 연체 처리 실행
        </button>
      </div>

      <div class="card">
        <h2 class="card-title">최근 14일 활동</h2>
        ${eventRows}
      </div>`;

    App.$('#runOverdueBtn').addEventListener('click', _runOverdue);
  };

  const _runOverdue = async () => {
    const ok = await App.confirmDialog(
      '밀린 연체료를 지금 부과합니다. 이미 부과된 날짜는 중복되지 않습니다. 계속할까요?',
      { okText: '실행' });
    if (!ok) return;

    const btn = App.$('#runOverdueBtn');
    btn.disabled = true; btn.textContent = '실행 중...';
    try {
      const { data, error } = await db.rpc('admin_run_overdue');
      if (error) return App.showToast(App.errMsg(error, '실행 실패'), 'error');
      App.showToast(`연체 처리 완료. ${data.charged}건 부과되었습니다.`, 'success');
      await switchTab('stats');
    } finally {
      btn.disabled = false; btn.textContent = '지금 연체 처리 실행';
    }
  };

  return { load, switchTab, submitAdjust, refreshPendingBadge, checkPending };
})();
