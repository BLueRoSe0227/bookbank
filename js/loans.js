/* ═══════════════════════════════════════════════════════════
   loans.js — 홈 요약 / 대출 목록 / 반납 / 연장 / 통장 내역

   [수정] 반납 별점 버튼이 어디서도 생성되지 않아 별점을 고를 수 없었고,
          그 결과 반납이 항상 실패하던 버그를 고쳤습니다. (X6)
          이제 키보드(←→ 화살표)로도 별점을 줄 수 있습니다.
   [변경] 표지 이미지가 없어졌으므로 제목 기반 생성형 표지를 씁니다. (X2/D10)
   ═══════════════════════════════════════════════════════════ */
const Loans = (() => {
  let _returnId = null, _rating = 0, _returnTitle = '';

  const _statusIcon = (cls) => cls === 'danger' ? '⏰ ' : cls === 'warning' ? '⚠ ' : '';

  /* ── 홈 ── */
  const loadSummary = async () => {
    const p = App.getProfile();
    const r = await App.rules();

    await _loadReminders(p);

    const [{ count: active }, { count: returned }] = await Promise.all([
      db.from('loans').select('*', { count: 'exact', head: true })
        .eq('user_id', p.id).in('status', ['active', 'overdue']),
      db.from('loans').select('*', { count: 'exact', head: true })
        .eq('user_id', p.id).eq('status', 'returned'),
    ]);

    App.$('#statActiveLoans').textContent   = active ?? 0;
    App.$('#statTotalReturned').textContent = returned ?? 0;
    App.$('#statBalance').textContent       = `${p.balance.toLocaleString()}원`;

    const capacity = r.loan_deposit > 0 ? Math.floor(p.balance / r.loan_deposit) : 0;
    App.$('#statCapacity').textContent = `${capacity}권`;

    App.$('#passbookBalance').textContent = `${p.balance.toLocaleString()}원`;
    App.$('#passbookOwner').textContent   = `${p.nickname}님의 독서 통장`;

    // 반납 임박 (3일 이내) — [D5] 로컬 기준 날짜
    const { data: urgent } = await db
      .from('loans')
      .select('id,target_end_date,status,books(title,author)')
      .eq('user_id', p.id).in('status', ['active', 'overdue'])
      .lte('target_end_date', App.addDays(3))
      .order('target_end_date').limit(5);

    const el = App.$('#urgentLoans');
    if (!urgent?.length) {
      el.innerHTML = '<p class="empty-msg">반납 임박한 책이 없습니다 👍</p>';
      return;
    }
    el.innerHTML = `<div class="loan-cards">${urgent.map(l => {
      const d = App.daysLeft(l.target_end_date);
      const label = d < 0 ? `${Math.abs(d)}일 연체` : d === 0 ? '오늘 반납' : `${d}일 남음`;
      const cls   = d < 0 ? 'danger' : d <= 1 ? 'warning' : 'info';
      return App.h`
        <div class="loan-card loan-card-${App.raw(cls)}">
          <div class="loan-card-title">${l.books.title}</div>
          <div class="loan-card-meta">
            <span class="badge badge-${App.raw(cls)}">${App.raw(_statusIcon(cls))}${label}</span>
            <span>${App.fmtDate(l.target_end_date)}</span>
          </div>
        </div>`;
    }).join('')}</div>`;
  };

  /* ── 알림 배너 (P3) ── */
  const _loadReminders = async (p) => {
    const el = App.$('#reminderBanner');
    if (!el) return;
    const { data } = await db.from('notifications')
      .select('id,title,kind').is('read_at', null)
      .eq('user_id', p.id).order('created_at', { ascending: false }).limit(1);
    const n = data?.[0];
    if (!n) { el.innerHTML = ''; return; }

    const icon = n.kind === 'overdue' ? '⏰' : '🔔';
    el.innerHTML = App.h`
      <div class="reminder-banner">
        <span class="reminder-icon" aria-hidden="true">${App.raw(icon)}</span>
        <div class="reminder-body">${n.title}</div>
        <button type="button" data-dismiss="${App.raw(String(n.id))}">확인</button>
      </div>`;
    el.querySelector('[data-dismiss]').addEventListener('click', async () => {
      await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
      await _loadReminders(p);
    });
  };

  /* ── 대출 목록 ── */
  const loadList = async (status = 'active') => {
    App.$$('.loan-tab').forEach(t => {
      const on = t.dataset.status === status;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    App.showLoading('#loanList');

    const p = App.getProfile();
    const filter = status === 'active' ? ['active', 'overdue'] : [status];
    const { data, error } = await db
      .from('loans')
      .select('id,loan_date,target_end_date,return_date,status,rating,memo,deposit,extend_count,books(title,author,publisher,total_pages)')
      .eq('user_id', p.id).in('status', filter)
      .order('created_at', { ascending: false });

    const el = App.$('#loanList');
    if (error) {
      el.innerHTML = App.emptyState('⚠️', '목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!data.length) {
      el.innerHTML = status === 'active'
        ? App.emptyState('📚', '대출 중인 책이 없습니다. 읽고 싶은 책을 등록해보세요.',
                         { label: '책 등록하기', page: 'register' })
        : App.emptyState('✅', '아직 반납한 책이 없습니다.');
      App.wireEmptyCta(el);
      return;
    }

    const r = await App.rules();
    el.innerHTML = data.map(l => {
      const d    = App.daysLeft(l.target_end_date);
      const over = l.status === 'overdue';
      const cls  = over ? 'danger' : d <= 1 ? 'warning' : 'info';
      const label = l.status === 'returned'
        ? `${App.fmtDate(l.return_date)} 반납`
        : over ? `${Math.abs(d)}일 연체 중` : d === 0 ? '오늘 반납' : `${d}일 남음`;
      const canExtend = l.status === 'active' && l.extend_count < r.extend_max;
      const badgeIcon = l.status === 'returned' ? '' : _statusIcon(cls);

      return App.h`
        <div class="loan-item">
          ${App.genCover(l.books.title, 'loan-cover')}
          <div class="loan-body">
            <h3 class="loan-title">${l.books.title}</h3>
            <p class="loan-author">${l.books.author || '저자 미상'}</p>
            <div class="loan-meta">
              <span class="badge badge-${App.raw(cls)}">${App.raw(badgeIcon)}${label}</span>
              ${l.rating ? App.raw(`<span class="loan-rating">${'★'.repeat(l.rating)}</span>`) : App.raw('')}
            </div>
            ${l.status !== 'returned' ? App.raw(`
              <div class="loan-actions">
                <button class="btn btn-sm btn-primary" data-return="${l.id}">반납하기</button>
                ${canExtend ? `<button class="btn btn-sm btn-ghost" data-extend="${l.id}">
                    ${r.extend_days}일 연장 (-${r.extend_fee}원)</button>` : ''}
              </div>`) : App.raw('')}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-return]').forEach(b =>
      b.addEventListener('click', () => openReturnModal(Number(b.dataset.return), b.closest('.loan-item').querySelector('.loan-title').textContent)));
    el.querySelectorAll('[data-extend]').forEach(b =>
      b.addEventListener('click', () => extend(Number(b.dataset.extend))));
  };

  /* ── 반납: 별점 (X6 — 기존엔 별이 아예 생성되지 않았음) ── */
  const _buildStars = () => {
    const wrap = App.$('#returnStars');
    wrap.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'star';
      b.textContent = '★';
      b.dataset.n = String(i);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-label', `${i}점`);
      b.tabIndex = i === 1 ? 0 : -1;   // roving tabindex
      b.addEventListener('click', () => setRating(i));
      b.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault(); setRating(Math.min(5, (_rating || 0) + 1)); _focusStar();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault(); setRating(Math.max(1, (_rating || 1) - 1)); _focusStar();
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault(); setRating(i);
        }
      });
      wrap.appendChild(b);
    }
  };
  const _focusStar = () => { App.$$('#returnStars .star')[Math.max(0, _rating - 1)]?.focus(); };

  const openReturnModal = (id, title = '') => {
    _returnId = id; _rating = 0; _returnTitle = title;
    _buildStars();
    App.$('#returnStarsStatus').textContent = '';
    App.$('#returnMemo').value = '';
    App.openModal('returnModal');
  };

  const setRating = (n) => {
    _rating = n;
    App.$$('#returnStars .star').forEach((s, i) => {
      s.classList.toggle('on', i < n);
      s.setAttribute('aria-checked', i + 1 === n ? 'true' : 'false');
      s.tabIndex = i + 1 === n ? 0 : -1;
    });
    // aria-label 을 여기에 걸면 "별점" 이름표를 덮어써 버립니다.
    // 선택 결과는 별도 live 영역으로 알립니다.
    App.$('#returnStarsStatus').textContent = `${n}점 선택됨`;
  };

  const submitReturn = async (e) => {
    e?.preventDefault();
    App.clearErrors('#returnModal');
    if (!_rating) return App.fieldError('#returnStars', '별점을 선택해주세요.');
    const btn = App.$('#returnSubmitBtn');
    btn.disabled = true;
    try {
      const { data, error } = await db.rpc('return_loan', {
        p_loan: _returnId, p_rating: _rating, p_memo: App.$('#returnMemo').value.trim(),
      });
      if (error) return App.showToast(App.errMsg(error, '반납 처리 중 오류'), 'error');

      App.logEvent('loan_return', { rating: _rating, on_time: data.bonus > 0 });
      App.closeModal('returnModal');
      App.showToast(
        data.bonus > 0
          ? `반납 완료! 보증금 ${data.refund}원 + 보너스 ${data.bonus}원을 받았어요 🎉`
          : `반납 완료! 보증금 ${data.refund}원을 돌려받았어요.`,
        'success');
      await App.loadProfile();
      await App.refreshHeader();
      await loadList('active');
    } finally { btn.disabled = false; }
  };

  /* ── 연장 ── */
  const extend = async (id) => {
    const r = await App.rules();
    const ok = await App.confirmDialog(
      `${r.extend_fee}원을 사용해 ${r.extend_days}일 연장할까요? 연장 수수료는 돌려받지 못합니다.`,
      { okText: '연장하기' });
    if (!ok) return;
    const { data, error } = await db.rpc('extend_loan', { p_loan: id });
    if (error) return App.showToast(App.errMsg(error, '연장 실패'), 'error');
    App.logEvent('loan_extend', {});
    App.showToast(`${App.fmtDate(data.new_date)}까지 연장되었습니다.`, 'success');
    await App.loadProfile();
    await App.refreshHeader();
    await loadList('active');
  };

  /* ── 통장 내역 ── */
  const loadTransactions = async () => {
    const p = App.getProfile();
    App.$('#passbookBalance').textContent = `${p.balance.toLocaleString()}원`;
    App.$('#passbookOwner').textContent   = `${p.nickname}님의 독서 통장`;

    const { data } = await db.from('transactions')
      .select('type,amount,balance,description,created_at')
      .eq('user_id', p.id).order('created_at', { ascending: false }).limit(100);

    const names = {
      join_bonus: '가입 보너스', return_bonus: '반납 보너스', overdue_fee: '연체 수수료',
      room_fee: '서재 방 추가', admin_adjust: '관리자 조정',
      loan_deposit: '대출 보증금', deposit_refund: '보증금 환급', extend_fee: '대출 연장',
    };
    const tbody = App.$('#passbookBody');
    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">거래 내역이 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(t => App.h`
      <tr>
        <td class="td-date">${App.fmtDate(t.created_at)}</td>
        <td>${names[t.type] || t.type}<br><span class="td-desc">${t.description || ''}</span></td>
        <td class="td-amount ${App.raw(t.amount >= 0 ? 'amount-plus' : 'amount-minus')}">
          ${(t.amount >= 0 ? '+' : '') + t.amount.toLocaleString()}
        </td>
        <td class="td-balance">${t.balance.toLocaleString()}</td>
      </tr>`).join('');
  };

  return { loadSummary, loadList, openReturnModal, setRating, submitReturn, extend, loadTransactions };
})();
