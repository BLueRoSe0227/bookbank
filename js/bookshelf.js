/* ═══════════════════════════════════════════════════════════
   bookshelf.js — 나의 서재 (방 + 3D 책장)
   ═══════════════════════════════════════════════════════════ */
const Bookshelf = (() => {
  let _roomId = null, _color = '#5B8FBF', _icon = '📚', _selLoan = null;
  let _decorCache = [], _roomName = '서재', _roomBookCount = 0;
  const COLORS = ['#5B8FBF','#D4848C','#6BA883','#D9A85B','#8B7BB8','#C97070'];
  const ICONS  = ['📚','📖','📕','📗','📘','🎭','🔬','🎨','💼','🌍'];
  const DECOR_EMOJI = { door:'🚪', window:'🪟', plant:'🪴', frame:'🖼️', lamp:'💡', rug:'🟫' };

  const _spineColor = (title) => {
    let h = 0;
    for (const c of String(title)) h = (h * 31 + c.charCodeAt(0)) % 360;
    // 노랑~연두 구간은 같은 명도라도 밝게 보여 흰 글자가 안 읽힙니다.
    // (app.js 의 생성형 표지와 같은 보정)
    const l = (h >= 40 && h <= 170) ? 33 : 42;
    return `hsl(${h}, 45%, ${l}%)`;
  };
  const _spineWidth = (pages) => Math.max(18, Math.min(46, Math.round((pages || 300) / 12)));

  const load = async () => {
    App.showLoading('#bsRooms');

    const p = App.getProfile();
    const { data: rooms } = await db.from('bookshelf_rooms')
      .select('id,name,description,icon,color,bookshelf_books(id,books(title,total_pages))')
      .eq('user_id', p.id).order('sort_order').order('created_at');

    const el = App.$('#bsRooms');
    if (!rooms?.length) {
      el.innerHTML = App.emptyState('🏠',
        '아직 서재 방이 없습니다. 방을 만들어 완독한 책을 꽂아보세요.');
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
    _roomName = room?.name ?? '서재';
    App.$('#bsRoomTitle').textContent = _roomName;

    const { data: books } = await db.from('bookshelf_books')
      .select('id,note,books(title,author,cover_url,total_pages),loans(rating,return_date,memo)')
      .eq('room_id', id).order('added_at', { ascending: false });

    // 방 꾸미기(데코) — 건축 도면에 표시
    _roomBookCount = books?.length ?? 0;
    const { data: decor } = await db.from('room_decor').select('id,kind').eq('room_id', id);
    _decorCache = decor ?? [];
    _renderBlueprint();

    const shelf = App.$('#bsShelfContainer');
    if (!books?.length) {
      shelf.innerHTML = App.emptyState('📗', '이 방은 비어 있습니다. 완독한 책을 꽂아보세요.');
    } else {
      // 선반은 하나. 책이 많으면 CSS 가 알아서 줄바꿈합니다. (예전엔 8권씩 잘랐습니다)
      shelf.innerHTML = `
        <div class="bs-shelf">
          <div class="bs-shelf-books">
            ${books.map(b => App.h`
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
        </div>`;

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

  /* ── 건축 도면(설계도) ── */
  const _renderBlueprint = () => {
    const el = App.$('#bsBlueprint');
    if (!el) return;
    const doors   = _decorCache.filter(d => d.kind === 'door');
    const windows = _decorCache.filter(d => d.kind === 'window');
    const inside  = _decorCache.filter(d => !['door', 'window'].includes(d.kind));

    // 벽을 따라 균등 배치할 좌표(%)
    const spread = (arr, cls) => arr.map((_, i) =>
      `<span class="${cls}" style="left:${((i + 1) / (arr.length + 1) * 100).toFixed(1)}%"></span>`).join('');
    const doorHtml = spread(doors, 'bp-door');
    const winHtml  = spread(windows, 'bp-window');
    const inHtml   = inside.map(d =>
      `<span class="bp-item">${DECOR_EMOJI[d.kind] || '▫'}</span>`).join('');
    const area = 8 + _roomBookCount * 2;   // 완독 권수를 방 넓이처럼 표시

    el.innerHTML = App.h`
      <div class="blueprint" aria-label="방 설계도">
        <div class="blueprint-room">
          <div class="bp-titleblock">
            <b>${_roomName}</b><br>완독 ${_roomBookCount}권 · 약 ${area}㎡
          </div>
          ${App.raw(doorHtml)}
          ${App.raw(winHtml)}
          <div class="bp-items">${App.raw(inHtml)}</div>
        </div>
      </div>`;
  };

  const openDecor = async () => {
    const { data: items } = await db.from('decor_items')
      .select('kind,name,emoji,price,sort').order('sort');
    const shop = App.$('#decorShop');
    shop.innerHTML = (items ?? []).map(it => App.h`
      <div class="decor-item">
        <span class="decor-emoji" aria-hidden="true">${it.emoji}</span>
        <div class="decor-info">
          <span class="decor-name">${it.name}</span>
          <span class="decor-count">놓인 개수 ${App.raw(String(_decorCache.filter(d => d.kind === it.kind).length))}</span>
        </div>
        <button class="btn btn-sm btn-primary" data-decor="${it.kind}" type="button">설치 · ${it.price}원</button>
      </div>`).join('');
    shop.querySelectorAll('[data-decor]').forEach(b =>
      b.addEventListener('click', () => _buyDecor(b.dataset.decor)));
    App.openModal('decorModal');
  };

  const _buyDecor = async (kind) => {
    const { data, error } = await db.rpc('add_decor', { p_room: _roomId, p_kind: kind });
    if (error) return App.showToast(App.errMsg(error, '설치 실패'), 'error');

    _decorCache.push({ id: data.id, kind });
    _renderBlueprint();
    await App.loadProfile(); await App.refreshHeader();
    App.showToast(`설치 완료! 잔액 ${data.balance.toLocaleString()}원`, 'success');
    await openDecor();   // 상점의 '놓인 개수' 갱신
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

    // 부모가 role="radiogroup" 이므로 각 버튼은 role="radio" + aria-checked 를
    // 가져야 합니다. .selected 클래스만으로는 보조기기에 선택 상태가 전달되지 않습니다.
    App.$('#bsColorPicker').innerHTML = COLORS.map((c, i) => App.h`
      <button type="button" class="bs-color-option ${App.raw(i===0?'selected':'')}"
              role="radio" aria-checked="${App.raw(i===0?'true':'false')}"
              tabindex="${App.raw(i===0?'0':'-1')}"
              data-color="${c}" style="background:${App.raw(c)}"
              aria-label="색상 ${App.raw(i+1)}"></button>`).join('');
    App.$('#bsIconPicker').innerHTML = ICONS.map((ic, i) => App.h`
      <button type="button" class="bs-icon-option ${App.raw(i===0?'selected':'')}"
              role="radio" aria-checked="${App.raw(i===0?'true':'false')}"
              tabindex="${App.raw(i===0?'0':'-1')}"
              data-icon="${ic}" aria-label="아이콘 ${ic}">${ic}</button>`).join('');

    /* 선택 상태를 클래스·aria·tabindex 에 한꺼번에 반영합니다.
       roving tabindex: 그룹 전체가 Tab 한 번에 묶이고, 안에서는 화살표로 이동. */
    const _wirePicker = (sel, itemSel, onPick) => {
      const items = App.$$(`${sel} ${itemSel}`);
      const select = (i) => {
        items.forEach((x, j) => {
          const on = i === j;
          x.classList.toggle('selected', on);
          x.setAttribute('aria-checked', on ? 'true' : 'false');
          x.tabIndex = on ? 0 : -1;
        });
        onPick(items[i]);
      };
      items.forEach((b, i) => {
        b.addEventListener('click', () => select(i));
        b.addEventListener('keydown', (e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
                  : e.key === 'ArrowLeft'  || e.key === 'ArrowUp'   ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          const next = (i + d + items.length) % items.length;
          select(next);
          items[next].focus();
        });
      });
    };
    _wirePicker('#bsColorPicker', '.bs-color-option', (b) => { _color = b.dataset.color; });
    _wirePicker('#bsIconPicker',  '.bs-icon-option',  (b) => { _icon  = b.dataset.icon;  });

    App.openModal('bsRoomFormModal');
  };

  const submitRoom = async (e) => {
    e?.preventDefault();
    App.clearErrors('#bsRoomFormModal');
    const name = App.$('#bsRoomName').value.trim();
    if (!name) return App.fieldError('#bsRoomName', '방 이름을 입력해주세요.');
    const { error } = await db.rpc('create_room', {
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
      el.innerHTML = App.emptyState('📖',
        '꽂을 수 있는 완독 도서가 없습니다. 책을 반납하면 여기에 나타납니다.');
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

  return { load, openRoom, openRoomForm, submitRoom, deleteRoom, openAddBook, submitAddBook,
           openDecor };
})();
