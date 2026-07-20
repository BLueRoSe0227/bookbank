/* ═══════════════════════════════════════════════════════════
   portfolio.js — 독서 통계 / 업적
   PHP판은 서버에서 10여 개 쿼리를 돌렸지만, 여기서는 완독 목록 한 번만
   받아와 브라우저에서 계산합니다. (개인 데이터라 양이 작습니다)
   ═══════════════════════════════════════════════════════════ */
const Portfolio = (() => {
  const ACHIEVEMENTS = [
    { id:'first_book',  icon:'🌱', name:'첫 걸음',   desc:'첫 책 완독' },
    { id:'ten_books',   icon:'📚', name:'열 권 돌파', desc:'10권 완독' },
    { id:'fifty_books', icon:'🏆', name:'오십 권',   desc:'50권 완독' },
    { id:'speed_reader',icon:'⚡', name:'속독가',    desc:'하루 평균 50쪽' },
    { id:'genre_master',icon:'🎭', name:'장르 탐험가',desc:'5개 장르 완독' },
    { id:'no_overdue',  icon:'⏰', name:'약속 지킴이', desc:'연체 없음' },
    { id:'author_fan',  icon:'💝', name:'작가 팬',   desc:'한 작가 3권' },
    { id:'monthly_3',   icon:'🔥', name:'월 3권',    desc:'한 달 3권 완독' },
  ];

  const load = async () => {
    const p = App.getProfile();
    const { data: books } = await db.from('loans')
      .select('loan_date,return_date,read_pages,rating,books(title,author,publisher,genre,total_pages)')
      .eq('user_id', p.id).eq('status', 'returned')
      .order('return_date', { ascending: false });

    const { count: overdueCount } = await db.from('loans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', p.id).eq('status', 'overdue');

    const list = books ?? [];
    const total = list.length;

    // [P5] 페이지 수를 모르는 책(추정 기본값)은 통계에서 제외해 지표 오염 방지.
    //   total_pages 가 NULL 이면 "미상"으로 보고 합산하지 않습니다.
    const pageOf = (b) => b.read_pages || b.books.total_pages || null;
    const knownPages = list.map(pageOf).filter(Boolean);
    const pages = knownPages.reduce((s, n) => s + n, 0);

    const first = list.length ? new Date(list[list.length - 1].return_date) : new Date();
    const days  = Math.max(1, Math.round((Date.now() - first) / 86400000));
    const ratings = list.map(b => b.rating).filter(Boolean);
    const avgRating = ratings.length ? (ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(1) : 0;
    // 하루 평균 쪽수: 페이지를 아는 책만으로 계산 (모르면 0)
    const dailyPages = knownPages.length ? Math.round(pages / days) : 0;

    // 요약
    App.$('#pfSummary').innerHTML = [
      ['📖', total, '완독한 책'],
      ['📄', pages.toLocaleString(), '읽은 쪽수'],
      ['⚡', dailyPages, '하루 평균 쪽'],
      ['⭐', avgRating, '평균 별점'],
    ].map(([i, n, l]) => App.h`
      <div class="pf-summary-card">
        <div class="pf-summary-icon" aria-hidden="true">${i}</div>
        <div class="pf-summary-num">${n}</div>
        <div class="pf-summary-label">${l}</div>
      </div>`).join('');

    const groupCount = (arr, keyFn) => {
      const m = new Map();
      arr.forEach(x => { const k = keyFn(x) || '미상'; m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };

    const genres  = groupCount(list, b => b.books.genre || '기타');
    const authors = groupCount(list, b => b.books.author).slice(0, 8);
    const pubs    = groupCount(list, b => b.books.publisher).slice(0, 8);

    const bars = (rows) => {
      if (!rows.length) return '<p class="empty-msg">아직 데이터가 없습니다.</p>';
      const max = rows[0][1];
      return `<div class="pf-bar-list">${rows.map(([name, n]) => App.h`
        <div class="pf-bar-item">
          <div class="pf-bar-label">
            <span class="pf-bar-name">${name}</span>
            <span class="pf-bar-count">${n}권</span>
          </div>
          <div class="pf-bar-track">
            <div class="pf-bar-fill" style="width:${App.raw(Math.round(n/max*100))}%"></div>
          </div>
        </div>`).join('')}</div>`;
    };
    App.$('#pfGenres').innerHTML     = bars(genres);
    App.$('#pfAuthors').innerHTML    = bars(authors);
    App.$('#pfPublishers').innerHTML = bars(pubs);

    // 업적
    const earned = new Set();
    if (total >= 1)  earned.add('first_book');
    if (total >= 10) earned.add('ten_books');
    if (total >= 50) earned.add('fifty_books');
    if (dailyPages >= 50) earned.add('speed_reader');
    if (genres.length >= 5) earned.add('genre_master');
    if ((overdueCount ?? 0) === 0 && total > 0) earned.add('no_overdue');
    if (authors.some(([, n]) => n >= 3)) earned.add('author_fan');
    const byMonth = groupCount(list, b => (b.return_date || '').slice(0, 7));
    if (byMonth.some(([, n]) => n >= 3)) earned.add('monthly_3');

    App.$('#pfAchievements').innerHTML = ACHIEVEMENTS.map(a => App.h`
      <div class="pf-achievement ${App.raw(earned.has(a.id) ? 'earned' : 'locked')}">
        <div class="pf-achievement-icon" aria-hidden="true">${a.icon}</div>
        <div class="pf-achievement-name">${a.name}</div>
        <div class="pf-achievement-desc">${a.desc}</div>
      </div>`).join('');

    // 완독 목록
    App.$('#pfBooks').innerHTML = total
      ? list.map(b => App.h`
          <div class="pf-book-item">
            ${App.genCover(b.books.title, 'pf-book-cover')}
            <div class="pf-book-title">${b.books.title}</div>
            <div class="pf-book-rating">${App.raw('★'.repeat(b.rating || 0))}</div>
          </div>`).join('')
      : '<p class="empty-msg">아직 완독한 책이 없습니다.</p>';
  };

  return { load };
})();
