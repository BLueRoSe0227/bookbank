/* ═══════════════════════════════════════════════════════════
   bookshelf.js — 나의 서재 (방 + 3D 책장)
   ═══════════════════════════════════════════════════════════ */
const Bookshelf = (() => {
  let _roomId = null, _color = '#5B8FBF', _icon = '📚', _selLoan = null;
  const COLORS = ['#5B8FBF','#D4848C','#6BA883','#D9A85B','#8B7BB8','#C97070'];
  const ICONS  = ['📚','📖','📕','📗','📘','🎭','🔬','🎨','💼','🌍'];

  const _spineColor = (title) => {
    let h = 0;
    for (const c of String(title)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h}, 45%, 42%)`;
  };
  const _spineWidth = (pages) => Math.max(18, Math.min(46, Math.round((pages || 300) / 12)));

  const load = async () => {
    const p = App.getProfile();
    const { data: rooms } = await db.from('bookshelf_rooms')
      .select('id,name,description,icon,color,bookshelf_books(id,books(title,total_pages))')
      .eq('user_id', p.id).order('sort_order').order('created_at');

    const el = App.$('#bsRooms');
    if (!rooms?.length) {
      el.innerHTML = '<p class="empty-msg">아직 서재 방이 없습니다. 방을 만들어 완독한 책을 꽂아보세요!</p>';
      return;
    }
    el.innerHTML = rooms.map(r => {
      const books = r.bookshelf_books ?? [];
      const mini = books.slice(0, 12).map(b => App.raw(
        `<div class="bs-mini-book" style="width:${_spineWidth(b.books.total_pages)/2}px;
              height:${40 + (b.books.total_pages||300)%20}px;
              background:${_spineColor(b.books.title)}"></div>`)).join('');
      return App.h`
        <div class="bs-room-card" role="button" tabindex="0" data-room="${r.id}"
             aria-label="${r.name} 방 열기">
          <div class="bs-room-header">
            <div class="bs-room-icon" style="background:${App.raw(App.escapeHtml(r.color))}22"
                 aria-hidden="true">${r.icon}</div>
            <div class="bs-room-info">
              <h3>${r.name}</h3>
              <p>${r.description || ''}</p>
            </div>
            <div class="bs-room-count">${books.length}권</div>
          </div>
          <div class="bs-mini-shelf">
            ${books.length
              ? App.raw(`<div class="bs-mini-shelf-floor">${mini}</div>`)
              : App.raw('<div class="bs-empty-shelf">책을 꽂아보세요</div>')}
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-room]').forEach(c => {
      const open = () => openRoom(Number(c.dataset.room));
      c.addEventListener('click', open);
      c.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  };

  const openRoom = async (id) => {
    _roomId = id;
    const { data: room } = await db.from('bookshelf_rooms')
      .select('name').eq('id', id).single();
    App.$('#bsRoomTitle').textContent = room?.name ?? '서재';

    const { data: books } = await db.from('bookshelf_books')
      .select('id,note,books(title,author,cover_url,total_pages),loans(rating,return_date,memo)')
      .eq('room_id', id).order('added_at', { ascending: false });

    const shelf = App.$('#bsShelfContainer');
    if (!books?.length) {
      shelf.innerHTML = '<p class="empty-msg">이 방은 비어 있습니다.</p>';
    } else {
      // 한 선반에 8권씩
      const rows = [];
      for (let i = 0; i < books.length; i += 8) rows.push(books.slice(i, i + 8));
      shelf.innerHTML = rows.map(row => `
        <div class="bs-shelf">
          <div class="bs-shelf-books">
            ${row.map(b => App.h`
              <div class="bs-book" data-book="${b.id}" role="button" tabindex="0"
                   aria-label="${b.books.title} 상세">
                <div class="bs-book-spine"
                     style="width:${App.raw(_spineWidth(b.books.total_pages))}px;
                            height:${App.raw(120 + (b.books.total_pages||300)%40)}px;
                            background:${App.raw(_spineColor(b.books.title))}">
                  <span class="bs-book-title-spine">${b.books.title}</span>
                </div>
                <div class="bs-book-tooltip">
                  <div class="bs-book-tooltip-title">${b.books.title}</div>
                  <div class="bs-book-tooltip-meta">${b.books.author || ''}</div>
                </div>
              </div>`).join('')}
          </div>
          <div class="bs-shelf-floor"></div>
        </div>`).join('');

      shelf.querySelectorAll('[data-book]').forEach(el => {
        const open = () => showDetail(books.find(b => b.id === Number(el.dataset.book)));
        el.addEventListener('click', open);
        el.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }
    App.openModal('bsRoomModal');
  };

  const showDetail = (b) => {
    if (!b) return;
    App.$('#bsBookDetail').innerHTML = App.h`
      <div class="bs-book-detail">
        ${App.genCover(b.books.title, 'bs-book-detail-cover')}
        <div class="bs-book-detail-info">
          <h3 class="bs-book-detail-title">${b.books.title}</h3>
          <p class="bs-book-detail-author">${b.books.author || '저자 미상'}</p>
          <div class="bs-book-detail-meta">
            <span>⭐ <span class="bs-book-detail-rating">${App.raw('★'.repeat(b.loans?.rating || 0))}</span></span>
            <span>📅 ${App.fmtDate(b.loans?.return_date)} 완독</span>
            <span>📄 ${b.books.total_pages || 300}쪽</span>
          </div>
          ${b.loans?.memo ? App.raw(`<div class="bs-book-detail-note">${App.escapeHtml(b.loans.memo)}</div>`) : App.raw('')}
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="bsRemoveBtn" data-id="${b.id}">서재에서 빼기</button>`;
    App.$('#bsRemoveBtn').addEventListener('click', () => removeBook(b.id));
    App.openModal('bsBookModal');
  };

  /* ── 방 추가 ── */
  const openRoomForm = async () => {
    const r = await App.rules();
    App.$('#bsRoomFee').textContent = `${r.room_fee}원`;
    App.$('#bsRoomName').value = '';
    App.$('#bsRoomDesc').value = '';
    _color = COLORS[0]; _icon = ICONS[0];

    App.$('#bsColorPicker').innerHTML = COLORS.map((c, i) => App.h`
      <button type="button" class="bs-color-option ${App.raw(i===0?'selected':'')}"
              data-color="${c}" style="background:${App.raw(c)}"
              aria-label="색상 ${App.raw(i+1)}"></button>`).join('');
    App.$('#bsIconPicker').innerHTML = ICONS.map((ic, i) => App.h`
      <button type="button" class="bs-icon-option ${App.raw(i===0?'selected':'')}"
              data-icon="${ic}" aria-label="아이콘 ${ic}">${ic}</button>`).join('');

    App.$$('#bsColorPicker .bs-color-option').forEach(b =>
      b.addEventListener('click', () => {
        _color = b.dataset.color;
        App.$$('#bsColorPicker .bs-color-option').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      }));
    App.$$('#bsIconPicker .bs-icon-option').forEach(b =>
      b.addEventListener('click', () => {
        _icon = b.dataset.icon;
        App.$$('#bsIconPicker .bs-icon-option').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
      }));

    App.openModal('bsRoomFormModal');
  };

  const submitRoom = async (e) => {
    e?.preventDefault();
    const name = App.$('#bsRoomName').value.trim();
    if (!name) return App.showToast('방 이름을 입력해주세요.', 'error');
    const { data, error } = await db.rpc('create_room', {
      p_name: name, p_desc: App.$('#bsRoomDesc').value.trim(),
      p_icon: _icon, p_color: _color,
    });
    if (error) return App.showToast(App.errMsg(error, '방 추가 실패'), 'error');
    App.closeModal('bsRoomFormModal');
    App.showToast('방이 만들어졌습니다!', 'success');
    await App.loadProfile(); await App.refreshHeader(); await load();
  };

  const deleteRoom = async () => {
    if (!confirm('방을 삭제하면 꽂아둔 책 정보도 함께 사라집니다.\n(대출 기록은 남습니다) 삭제할까요?')) return;
    const { error } = await db.from('bookshelf_rooms').delete().eq('id', _roomId);
    if (error) return App.showToast(App.errMsg(error), 'error');
    App.closeModal('bsRoomModal');
    App.showToast('방이 삭제되었습니다.', 'success');
    await load();
  };

  /* ── 책 꽂기 ── */
  const openAddBook = async () => {
    const p = App.getProfile();
    const { data: shelved } = await db.from('bookshelf_books')
      .select('loan_id').eq('user_id', p.id);
    const used = new Set((shelved ?? []).map(s => s.loan_id));

    const { data: done } = await db.from('loans')
      .select('id,return_date,books(title,author)')
      .eq('user_id', p.id).eq('status', 'returned')
      .order('return_date', { ascending: false });

    const avail = (done ?? []).filter(l => !used.has(l.id));
    const el = App.$('#bsAddBookList');
    if (!avail.length) {
      el.innerHTML = '<p class="empty-msg">꽂을 수 있는 완독 도서가 없습니다.</p>';
    } else {
      _selLoan = null;
      el.innerHTML = avail.map(l => App.h`
        <div class="bs-add-book-item" data-loan="${l.id}" role="button" tabindex="0">
          ${App.genCover(l.books.title, 'bs-add-book-cover')}
          <div class="bs-add-book-info">
            <h4>${l.books.title}</h4>
            <p>${l.books.author || ''}</p>
          </div>
        </div>`).join('');
      el.querySelectorAll('[data-loan]').forEach(it =>
        it.addEventListener('click', () => {
          _selLoan = Number(it.dataset.loan);
          el.querySelectorAll('.bs-add-book-item').forEach(x => x.classList.remove('selected'));
          it.classList.add('selected');
        }));
    }
    App.openModal('bsAddBookModal');
  };

  const submitAddBook = async () => {
    if (!_selLoan) return App.showToast('꽂을 책을 선택해주세요.', 'error');
    const p = App.getProfile();
    const { data: loan } = await db.from('loans').select('book_id').eq('id', _selLoan).single();
    const { error } = await db.from('bookshelf_books').insert({
      room_id: _roomId, user_id: p.id, loan_id: _selLoan, book_id: loan.book_id,
    });
    if (error) return App.showToast(App.errMsg(error, '책을 꽂지 못했습니다.'), 'error');
    App.closeModal('bsAddBookModal');
    App.showToast('책이 서재에 꽂혔습니다!', 'success');
    await openRoom(_roomId); await load();
  };

  const removeBook = async (id) => {
    const { error } = await db.from('bookshelf_books').delete().eq('id', id);
    if (error) return App.showToast(App.errMsg(error), 'error');
    App.closeModal('bsBookModal');
    App.showToast('책을 뺐습니다.', 'success');
    await openRoom(_roomId); await load();
  };

  return { load, openRoom, openRoomForm, submitRoom, deleteRoom, openAddBook, submitAddBook };
})();
