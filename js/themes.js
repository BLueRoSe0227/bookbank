/* ═══════════════════════════════════════════════════════════
   themes.js — 코인으로 잠금 해제하는 색 테마

   존재 여부·가격·이름은 DB(palettes)가, 실제 색상 값은 이 파일이
   관리합니다(장르 방식과 동일). 선택한 팔레트는 localStorage(lb_palette)에
   저장하고, 라이트/다크 어느 쪽이든 현재 테마에 맞는 색을 CSS 변수로 덮어씁니다.
   ═══════════════════════════════════════════════════════════ */
const Themes = (() => {
  // 각 팔레트의 라이트/다크 색.  p=primary, d=primary-dark, l=primary-light, bg=primary-bg
  const COLORS = {
    default:   { light:{p:'#2C5F8A',d:'#1F4664',l:'#E8F0F7',bg:'#E8F0F7'}, dark:{p:'#7FB3DB',d:'#A9CDE8',l:'#1B2C3C',bg:'#16283A'} },
    cobalt:    { light:{p:'#1E5FBF',d:'#154A97',l:'#E4EDFB',bg:'#E4EDFB'}, dark:{p:'#6FA8F0',d:'#9AC4F6',l:'#152238',bg:'#16233A'} },
    ruby:      { light:{p:'#C02444',d:'#961B34',l:'#FBE4EA',bg:'#FBE4EA'}, dark:{p:'#F07996',d:'#F6A3B6',l:'#2E1620',bg:'#331A22'} },
    emerald:   { light:{p:'#0E8A5F',d:'#0A6B4A',l:'#E0F5EC',bg:'#E0F5EC'}, dark:{p:'#4FC79A',d:'#8CE0BF',l:'#12261F',bg:'#123026'} },
    violet:    { light:{p:'#6D3BC0',d:'#552E97',l:'#EFE7FB',bg:'#EFE7FB'}, dark:{p:'#A98BEA',d:'#C4B0F2',l:'#20182E',bg:'#231A33'} },
    tangerine: { light:{p:'#C25A16',d:'#984612',l:'#FBEDE0',bg:'#FBEDE0'}, dark:{p:'#F0A05A',d:'#F6C293',l:'#2E2016',bg:'#33261A'} },
    lavender:  { light:{p:'#7A6FB0',d:'#5F568C',l:'#EEEBF7',bg:'#EEEBF7'}, dark:{p:'#B7ADE0',d:'#CFC8EC',l:'#211E2E',bg:'#242233'} },
    mint:      { light:{p:'#3E9A86',d:'#2F7768',l:'#E4F4F0',bg:'#E4F4F0'}, dark:{p:'#7FD3C0',d:'#A9E2D6',l:'#14261F',bg:'#153028'} },
    peach:     { light:{p:'#C06B6B',d:'#985353',l:'#F9EAEA',bg:'#F9EAEA'}, dark:{p:'#EDA0A0',d:'#F3BEBE',l:'#2C1C1C',bg:'#331F1F'} },
    sky:       { light:{p:'#3D82B8',d:'#2E6592',l:'#E5F0F8',bg:'#E5F0F8'}, dark:{p:'#84B9E4',d:'#A8CFEE',l:'#17232E',bg:'#182838'} },
    rose:      { light:{p:'#B85C86',d:'#93476A',l:'#F9E9F0',bg:'#F9E9F0'}, dark:{p:'#E99BBD',d:'#F0BAD1',l:'#2C1B23',bg:'#331F28'} },
    charcoal:  { light:{p:'#4A5560',d:'#333B44',l:'#EDEEF0',bg:'#EDEEF0'}, dark:{p:'#A6B2BD',d:'#C3CCD4',l:'#1E242A',bg:'#222831'} },
    sand:      { light:{p:'#6E6153',d:'#544A3F',l:'#F1EDE7',bg:'#F1EDE7'}, dark:{p:'#BBAB98',d:'#D2C6B7',l:'#241F19',bg:'#2B2820'} },
  };
  const VAR = { p:'--primary', d:'--primary-dark', l:'--primary-light', bg:'--primary-bg' };
  const CAT_KO = { vivid:'비비드', pastel:'파스텔', mono:'모노' };

  let _palettes = [];         // DB 가격표
  let _owned    = new Set();  // 보유한 palette_id
  let _preview  = 'light';    // 갤러리 미리보기 테마
  let _filter   = 'all';      // 분류 필터

  const _theme = () =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const current = () => localStorage.getItem('lb_palette') || 'default';

  /* 저장된 팔레트를 현재(라이트/다크) 테마에 맞춰 CSS 변수로 적용.
     기본(default)은 인라인 오버라이드를 지워 스타일시트 기본값을 씁니다. */
  const apply = (id) => {
    const rootStyle = document.documentElement.style;
    if (id === 'default' || !COLORS[id]) {
      Object.values(VAR).forEach(v => rootStyle.removeProperty(v));
    } else {
      const c = COLORS[id][_theme()];
      rootStyle.setProperty(VAR.p, c.p);
      rootStyle.setProperty(VAR.d, c.d);
      rootStyle.setProperty(VAR.l, c.l);
      rootStyle.setProperty(VAR.bg, c.bg);
    }
    // 모바일 주소창 색을 실제 primary 로 맞춤
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const p = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
      if (p) meta.setAttribute('content', p);
    }
  };
  const applySaved = () => apply(current());

  /* ── 설정 갤러리 ── */
  const load = async () => {
    const gallery = App.$('#paletteGallery');
    if (!gallery) return;
    _preview = _theme();   // 처음엔 현재 테마로 미리보기
    _syncPreviewButtons();

    const [pals, owned] = await Promise.all([
      db.from('palettes').select('id,name,category,price,sort').order('sort'),
      db.from('theme_unlocks').select('palette_id'),
    ]);
    _palettes = [{ id:'default', name:'기본', category:'mono', price:0 }, ...(pals.data || [])];
    _owned = new Set((owned.data || []).map(o => o.palette_id));

    _wireFilters();
    _render();
  };

  const _syncPreviewButtons = () => {
    App.$$('[data-ppreview]').forEach(b =>
      b.classList.toggle('active', b.dataset.ppreview === _preview));
  };

  const _wireFilters = () => {
    App.$$('[data-pfilter]').forEach(b => b.onclick = () => {
      _filter = b.dataset.pfilter;
      App.$$('[data-pfilter]').forEach(x => x.classList.toggle('active', x === b));
      _render();
    });
    App.$$('[data-ppreview]').forEach(b => b.onclick = () => {
      _preview = b.dataset.ppreview;
      _syncPreviewButtons();
      _render();
    });
  };

  const _render = () => {
    const gallery = App.$('#paletteGallery');
    const cur = current();
    const list = _palettes.filter(p => _filter === 'all' || p.category === _filter);

    gallery.innerHTML = list.map(p => {
      const c = (COLORS[p.id] || COLORS.default)[_preview];
      const owned  = p.price === 0 || _owned.has(p.id);
      const active = p.id === cur;
      const btn = active
        ? '<button class="btn btn-sm btn-secondary" disabled type="button">사용 중</button>'
        : owned
          ? App.h`<button class="btn btn-sm btn-primary" data-use="${p.id}" type="button">사용</button>`
          : App.h`<button class="btn btn-sm btn-ghost" data-buy="${p.id}" type="button">구매 · ${p.price}원</button>`;
      return App.h`
        <div class="palette-card ${App.raw(active ? 'active' : '')}">
          <div class="palette-swatch" style="background:${App.raw(c.bg)}">
            <span class="palette-dot" style="background:${App.raw(c.p)}"></span>
            <span class="palette-dot" style="background:${App.raw(c.d)}"></span>
            ${owned ? App.raw('') : App.raw('<span class="palette-lock" aria-hidden="true">🔒</span>')}
          </div>
          <div class="palette-meta">
            <span class="palette-name">${p.name}</span>
            <span class="palette-cat">${App.raw(CAT_KO[p.category] || '')}</span>
          </div>
          ${App.raw(btn)}
        </div>`;
    }).join('');

    gallery.querySelectorAll('[data-use]').forEach(b =>
      b.addEventListener('click', () => _use(b.dataset.use)));
    gallery.querySelectorAll('[data-buy]').forEach(b =>
      b.addEventListener('click', () => _buy(b.dataset.buy)));
  };

  const _use = (id) => {
    localStorage.setItem('lb_palette', id);
    apply(id);
    _render();
    App.showToast('테마를 적용했습니다.', 'success');
  };

  const _buy = async (id) => {
    const p = _palettes.find(x => x.id === id);
    if (!p) return;
    const ok = await App.confirmDialog(
      `'${p.name}' 테마를 ${p.price}원에 구매할까요?`, { okText: '구매' });
    if (!ok) return;

    const { data, error } = await db.rpc('unlock_theme', { p_palette: id });
    if (error) return App.showToast(App.errMsg(error, '구매 실패'), 'error');

    _owned.add(id);
    localStorage.setItem('lb_palette', id);
    apply(id);
    await App.loadProfile();
    await App.refreshHeader();
    _render();
    App.showToast(`구매 완료! 바로 적용했어요. 잔액 ${data.balance.toLocaleString()}원`, 'success');
  };

  return { apply, applySaved, load, current };
})();
