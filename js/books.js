/* ═══════════════════════════════════════════════════════════
   books.js — 책 등록 + 대출 신청

   [변경] 도서 검색 API(네이버)를 걷어냈습니다. 사용자가 직접 입력합니다.
     · 장르 필드 추가 (P2: 장르 통계/업적이 다시 살아납니다)
     · 도서명 자동완성 — 이미 등록된 책을 재사용 (P1: 중복/오타 감소)
     · 인라인 오류 표시 (X3: 사라지는 토스트 대신 필드 옆 고정)
     · 대출 전 확인 요약 (X7: 오제출로 보증금이 잘못 빠지는 것 방지)
   ═══════════════════════════════════════════════════════════ */
const Books = (() => {
  let _inited = false;
  let _acItems = [], _acIndex = -1;

  const FIELDS = ['#bookTitle', '#bookAuthor', '#bookPublisher', '#bookGenre',
                  '#bookPubDate', '#bookPages', '#bookDesc', '#loanMemo'];

  const init = async () => {
    if (!_inited) {
      _inited = true;
      _resetDates();
      App.$('#bookPubDate').max = App.today();          // 출간일은 미래 불가
      _wireAutocomplete();
      await _fillGenres();
    }
    _clearErrors();
    await _renderDeposit();
  };

  /* 장르 <select> 를 genres 테이블로 채웁니다.
     "선택 안 함" 첫 항목은 index.html 에 이미 있으므로 뒤에 붙이기만 합니다. */
  const _fillGenres = async () => {
    const list = await App.genres();
    if (!list.length) return;
    const sel = App.$('#bookGenre');
    sel.insertAdjacentHTML('beforeend',
      list.map(g => App.h`<option value="${g.name}">${g.name}</option>`).join(''));
  };

  const _resetDates = () => {
    App.$('#loanTargetDate').value = App.addDays(14);   // 기본 2주 뒤 (로컬 기준)
    App.$('#loanTargetDate').min   = App.addDays(1);    // 최소 내일
  };

  /* ── 인라인 오류 (X3) — 구현은 App 으로 옮겼습니다 (모든 폼이 공유) ── */
  const _fieldError  = (sel, msg) => App.fieldError(sel, msg);
  const _clearErrors = () => App.clearErrors('#registerForm');

  /* ── 보증금 안내 (잔액이 모자라면 미리 알려줌) ── */
  const _renderDeposit = async () => {
    const r = await App.rules();
    const p = App.getProfile();
    if (!p) return false;

    // 관리자는 잔액과 상관없이 대출/연장/방 추가가 가능합니다.
    const isAdmin = p.role === 'admin';
    const enough = isAdmin || p.balance >= r.loan_deposit;
    App.$('#loanDepositInfo').innerHTML = App.h`
      <div class="deposit-box ${enough ? '' : 'deposit-box-warn'}">
        <div class="deposit-row">
          <span>대출 보증금</span><b>${r.loan_deposit}원</b>
        </div>
        <div class="deposit-row deposit-row-sub">
          <span>반납하면 그대로 돌려받아요</span>
          <span>정시 반납 시 +${r.return_bonus}원</span>
        </div>
        <div class="deposit-row deposit-row-sub">
          <span>내 잔액</span><span>${p.balance}원</span>
        </div>
        ${enough ? App.raw('') : App.raw(
          '<p class="deposit-warn">잔액이 부족합니다. 빌린 책을 반납하면 보증금이 돌아옵니다.</p>')}
      </div>`;
    App.$('#loanSubmitBtn').disabled = !enough;
    return enough;
  };

  const _reset = () => {
    FIELDS.forEach(s => { App.$(s).value = ''; });
    _resetDates();
    _clearErrors();
  };

  const _collect = () => ({
    title:     App.$('#bookTitle').value.trim(),
    author:    App.$('#bookAuthor').value.trim(),
    publisher: App.$('#bookPublisher').value.trim(),
    genre:     App.$('#bookGenre').value.trim(),
    pubDate:   App.$('#bookPubDate').value,
    pagesRaw:  App.$('#bookPages').value,
    desc:      App.$('#bookDesc').value.trim(),
    target:    App.$('#loanTargetDate').value,
    memo:      App.$('#loanMemo').value.trim(),
  });

  /* ── 자동완성 (P1) — 이미 등록된 책을 재사용 ── */
  const _wireAutocomplete = () => {
    const input = App.$('#bookTitle');
    const box   = App.$('#titleSuggest');
    let timer = null;

    const close = () => {
      box.classList.add('hidden'); box.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      _acItems = []; _acIndex = -1;
    };

    input.addEventListener('input', () => {
      _clearErrors();
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) return close();
      timer = setTimeout(async () => {
        const { data } = await db.from('books')
          .select('title,author,publisher,genre,total_pages,description,pub_date')
          .ilike('title', `%${q}%`).limit(6);
        _acItems = data ?? [];
        if (!_acItems.length) return close();
        box.innerHTML = _acItems.map((b, i) => App.h`
          <button type="button" class="autocomplete-item" role="option"
                  id="ac-${App.raw(String(i))}" data-i="${App.raw(String(i))}">
            ${b.title}${b.author ? App.raw(`<small>${App.escapeHtml(b.author)}</small>`) : App.raw('')}
          </button>`).join('');
        box.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        box.querySelectorAll('.autocomplete-item').forEach(el =>
          el.addEventListener('click', () => _pick(Number(el.dataset.i))));
      }, 200);
    });

    input.addEventListener('keydown', (e) => {
      if (box.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); _move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); _move(-1); }
      else if (e.key === 'Enter' && _acIndex >= 0) { e.preventDefault(); _pick(_acIndex); }
      else if (e.key === 'Escape') { close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 150));

    const _move = (d) => {
      const items = box.querySelectorAll('.autocomplete-item');
      if (!items.length) return;
      _acIndex = (_acIndex + d + items.length) % items.length;
      // style 을 직접 만지면 테마·토큰 체계 밖으로 나갑니다. 색은 CSS 에서.
      items.forEach((el, i) => el.classList.toggle('is-active', i === _acIndex));
      input.setAttribute('aria-activedescendant', `ac-${_acIndex}`);
    };
    const _pick = (i) => {
      const b = _acItems[i]; if (!b) return;
      App.$('#bookTitle').value     = b.title || '';
      App.$('#bookAuthor').value    = b.author || '';
      App.$('#bookPublisher').value = b.publisher || '';
      // 목록에 없는 예전 장르 값이면 <select> 가 조용히 ''가 되므로 그대로 둡니다.
      App.$('#bookGenre').value     = b.genre || '';
      App.$('#bookPubDate').value   = /^\d{4}-\d{2}-\d{2}$/.test(b.pub_date || '') ? b.pub_date : '';
      App.$('#bookPages').value     = b.total_pages || '';
      App.$('#bookDesc').value      = b.description || '';
      close();
      App.$('#bookAuthor').focus();
    };
  };

  /* ── 제출: 검증 → 확인 요약(X7) → RPC ── */
  const submitLoan = (e) => {
    e?.preventDefault();
    _clearErrors();
    const v = _collect();

    if (!v.title)  return _fieldError('#bookTitle', '도서명을 입력해주세요.');
    if (!v.target) return _fieldError('#loanTargetDate', '반납 예정일을 선택해주세요.');

    let pages = null;
    if (v.pagesRaw) {
      pages = parseInt(v.pagesRaw, 10);
      if (isNaN(pages) || pages < 1 || pages > 10000)
        return _fieldError('#bookPages', '페이지 수는 1~10000 사이로 입력해주세요.');
    }
    v.pages = pages;

    _showConfirm(v);
  };

  const _showConfirm = async (v) => {
    const r = await App.rules();
    App.$('#loanConfirmBody').innerHTML = App.h`
      <div class="loan-confirm-book">${v.title}</div>
      <div class="loan-confirm-sub">${v.author || '저자 미상'}${v.publisher ? App.raw(` · ${App.escapeHtml(v.publisher)}`) : App.raw('')}</div>
      <div class="loan-confirm-row"><span>반납 예정일</span><b>${App.fmtDate(v.target)}</b></div>
      <div class="loan-confirm-row"><span>대출 보증금</span><b>-${r.loan_deposit}원 (반납 시 환급)</b></div>
      ${v.pages ? App.raw(`<div class="loan-confirm-row"><span>페이지</span><b>${v.pages}쪽</b></div>`) : App.raw('')}`;
    App.openModal('loanConfirmModal');
    const btn = App.$('#loanConfirmBtn');
    btn.onclick = () => _doLoan(v);
  };

  const _doLoan = async (v) => {
    const btn = App.$('#loanConfirmBtn');
    btn.disabled = true; btn.textContent = '신청 중...';
    try {
      const { data, error } = await db.rpc('create_loan', {
        p_title:     v.title,
        p_author:    v.author,
        p_publisher: v.publisher,
        p_pub_date:  v.pubDate,
        p_pages:     v.pages,
        p_genre:     v.genre,
        p_desc:      v.desc,
        p_target:    v.target,
        p_memo:      v.memo,
      });
      if (error) {
        App.closeModal('loanConfirmModal');
        return App.showToast(App.errMsg(error, '대출 처리 중 오류'), 'error');
      }
      App.logEvent('loan_create', { pages: v.pages, has_genre: !!v.genre });
      App.closeModal('loanConfirmModal');
      App.showToast(`대출 완료! 보증금 ${data.deposit}원이 잡혔습니다.`, 'success');
      _reset();
      await App.loadProfile();
      await App.refreshHeader();
      await _renderDeposit();
    } finally {
      btn.disabled = false; btn.textContent = '대출 신청';
    }
  };

  return { init, submitLoan };
})();
