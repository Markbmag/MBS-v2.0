import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { recentPages } from './recentPages';
import { ALL_CARDS, SECTIONS, favKeyOf, searchScore } from './pagesCatalog';

// Главная страница: «Недавно открытые» (для этого компьютера), поиск по-русски и
// по-английски с ключевыми словами (Enter — открыть первый результат), избранное,
// разделы с карточками страниц. Каталог страниц — в pagesCatalog.js.

const FAVORITES_KEY = 'home_favorites';

function timeAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d === 1 ? 'вчера' : `${d} дн назад`;
}

const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'reports', label: '📊 Отчеты' },
  { id: 'services', label: '🛠️ Сервисы' },
  { id: 'drr', label: '⚙️ Отчеты DRR' },
];

// ---------------------------------------------------------------- данные
// ---------------------------------------------------------------- стили
const CSS = `
.hn { max-width: 1440px; margin: 0 auto; padding: 28px 32px 48px; font-family: Inter, 'Segoe UI', Arial, sans-serif; color: #1F2937; }
.hn-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.hn-title { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.01em; }
.hn-sub { color: #6B7280; font-size: 14px; margin-top: 4px; }
.hn-panel { background: #FFFFFF; border: 1px solid #F0F0F5; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.04); padding: 22px 24px; margin-bottom: 24px; }
.hn-h2 { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700; margin: 0 0 16px; }
.hn-h2 .ic { padding: 6px 10px; border-radius: 8px; font-size: 16px; }
.hn-h2 .cnt { color: #9CA3AF; font-weight: 600; font-size: 15px; }
.hn-h2 .hint { margin-left: auto; color: #9CA3AF; font-size: 13px; font-weight: 500; }
.hn-recent { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.hn-rc { display: flex; align-items: center; gap: 10px; min-width: 0; text-decoration: none; color: inherit; border: 1px solid #EEF0F4; border-radius: 12px; padding: 8px; background: #FAFBFC; transition: border-color .2s, transform .2s; }
.hn-rc:hover { border-color: var(--accent); transform: translateY(-2px); }
.hn-rc img { width: 52px; height: 38px; object-fit: cover; object-position: top; border-radius: 6px; flex: none; border: 1px solid #EEF0F4; }
.hn-rc .tx { min-width: 0; }
.hn-rc .nm { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hn-rc .ago { font-size: 12px; color: #9CA3AF; }
@media (max-width: 1200px) { .hn-recent { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.hn-controls { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 22px; }
.hn-tabs { display: flex; gap: 6px; background: #E5E7EB; border-radius: 14px; padding: 6px; overflow-x: auto; max-width: 100%; }
.hn-tab { padding: 9px 22px; border-radius: 10px; border: none; font-weight: 600; font-size: 15px; cursor: pointer; white-space: nowrap; background: transparent; color: #6B7280; transition: all .25s; }
.hn-tab.on { background: #FFFFFF; color: #111827; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.hn-search { position: relative; flex: 1; min-width: 220px; max-width: 520px; }
.hn-search input { width: 100%; box-sizing: border-box; padding: 12px 40px 12px 44px; border-radius: 14px; border: 1px solid #E5E7EB; font-size: 15px; background: #FFFFFF; outline: none; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
.hn-search input:focus { border-color: #93C5FD; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
.hn-search .lens { position: absolute; left: 15px; top: 50%; transform: translateY(-50%); color: #9CA3AF; pointer-events: none; }
.hn-search .key { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); border: 1px solid #E5E7EB; border-radius: 6px; padding: 1px 7px; font-size: 12px; color: #9CA3AF; background: #F9FAFB; }
.hn-search .clr { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: #9CA3AF; font-size: 16px; cursor: pointer; padding: 4px 8px; }
.hn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.hn-card { position: relative; display: block; text-decoration: none; color: inherit; border-radius: 14px; overflow: hidden; background: #FFFFFF; border: 1px solid #F3F4F6; box-shadow: 0 4px 10px rgba(0,0,0,0.04); transition: transform .25s cubic-bezier(.25,.8,.25,1.2), box-shadow .25s, border-color .25s; }
.hn-card:hover { transform: translateY(-4px); box-shadow: 0 16px 26px -10px rgba(0,0,0,0.14); border-color: var(--accent); }
.hn-thumb { height: 108px; background: #F9FAFB; overflow: hidden; }
.hn-thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; transition: transform .4s; display: block; }
.hn-card:hover .hn-thumb img { transform: scale(1.04); }
.hn-cap { background: #35384F; color: #FFFFFF; font-weight: 600; font-size: 13.5px; padding: 9px 12px 8px; border-top: 3px solid var(--accent); }
.hn-cap .row { display: flex; align-items: center; gap: 6px; }
.hn-cap .ru { font-size: 12px; font-weight: 500; opacity: .72; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hn-cap .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hn-ext { flex: none; }
.hn-ext { opacity: .7; font-size: 12px; flex: none; }
.hn-star { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; border: none; cursor: pointer; font-size: 16px; line-height: 30px; background: rgba(255,255,255,0.92); color: #D1D5DB; box-shadow: 0 2px 6px rgba(0,0,0,0.12); opacity: 0; transition: opacity .2s, color .2s; }
.hn-card:hover .hn-star, .hn-star.on { opacity: 1; }
.hn-star.on { color: #F59E0B; }
.hn-empty { color: #6B7280; text-align: center; padding: 30px 0; }
@media (max-width: 700px) {
  .hn { padding: 16px 12px 32px; }
  .hn-title { font-size: 21px; }
  .hn-panel { padding: 16px 14px; border-radius: 16px; }
  .hn-recent { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hn-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .hn-thumb { height: 84px; }
  .hn-search .key { display: none; }
  .hn-star { opacity: 1; }
  .hn-h2 .hint { display: none; }
  .hn-cap .t { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
}
`;

// ---------------------------------------------------------------- части страницы
function RecentBlock() {
  const items = useMemo(() => recentPages()
    .map((r) => ({ ...r, card: ALL_CARDS.find((c) => c.to === r.path) }))
    .filter((r) => r.card)
    .slice(0, 6), []);
  if (!items.length) return null;
  return (
    <section className="hn-panel">
      <h2 className="hn-h2">
        <span className="ic" style={{ background: '#F3F4F6' }}>🕘</span>
        Недавно открытые
        <span className="hint">на этом компьютере</span>
      </h2>
      <div className="hn-recent">
        {items.map(({ card, at }) => (
          <Link key={card.to} to={card.to} className="hn-rc" style={{ '--accent': card.accent }} title={card.ru || card.caption}>
            <img src={card.img} alt="" loading="lazy" />
            <div className="tx">
              <div className="nm">{card.caption}</div>
              <div className="ago">{timeAgo(at)}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Card({ card, isFavorite, onToggleFavorite }) {
  const external = card.to.startsWith('http');
  const inner = (
    <>
      <button
        className={`hn-star${isFavorite ? ' on' : ''}`}
        title={isFavorite ? 'Убрать из избранного' : 'В избранное'}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleFavorite(favKeyOf(card)); }}
      >★</button>
      <div className="hn-thumb"><img src={card.img} alt="" loading="lazy" /></div>
      <div className="hn-cap" title={card.ru ? `${card.caption} — ${card.ru}` : card.caption}>
        <div className="row"><span className="t">{card.caption}</span>{external && <span className="hn-ext" title="Открывается в новой вкладке">↗</span>}</div>
        {card.ru && <div className="ru">{card.ru}</div>}
      </div>
    </>
  );
  const style = { '--accent': card.accent };
  return external
    ? <a href={card.to} target="_blank" rel="noopener noreferrer" className="hn-card" style={style}>{inner}</a>
    : <Link to={card.to} className="hn-card" style={style}>{inner}</Link>;
}

function Section({ title, icon, iconBg, cards, favorites, onToggleFavorite, hint }) {
  return (
    <section className="hn-panel">
      <h2 className="hn-h2"><span className="ic" style={{ background: iconBg }}>{icon}</span>{title}{!hint && <span className="cnt">{cards.length}</span>}{hint && <span className="hint">{hint}</span>}</h2>
      <div className="hn-grid">
        {cards.map((c) => <Card key={c.to} card={c} isFavorite={favorites.includes(favKeyOf(c))} onToggleFavorite={onToggleFavorite} />)}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- страница
export default function HomePage() {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
  });
  const searchRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* недоступно */ }
  }, [favorites]);

  // «/» — перейти к поиску; Esc — очистить поиск
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
      if (e.key === 'Escape' && document.activeElement === searchRef.current) { setSearch(''); searchRef.current.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFavorite = useCallback((key) => {
    setFavorites((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  }, []);

  const q = search.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => tab === 'all' || tab === s.id).map((s) => ({ ...s, cards: s.cards.filter((c) => searchScore(c, words) > 0) })).filter((s) => s.cards.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, q],
  );
  // При поиске — один общий список, лучшие совпадения первыми.
  const searchResults = useMemo(
    () => (words.length ? ALL_CARDS.map((c) => ({ c, s: searchScore(c, words) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.c) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q],
  );
  const favoriteCards = useMemo(
    () => ALL_CARDS.filter((c) => favorites.includes(favKeyOf(c))),
    [favorites],
  );
  const openCard = (c) => { if (c.to.startsWith('http')) window.open(c.to, '_blank', 'noopener'); else navigate(c.to); };

  return (
    <div className="hn">
      <style>{CSS}</style>
      <div className="hn-top">
        <div>
          <h1 className="hn-title">Панель качества</h1>
          <div className="hn-sub">Отчёты, дашборды и сервисы MBS Quality</div>
        </div>
      </div>

      {!q && <RecentBlock />}

      <div className="hn-controls">
        <div className="hn-tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`hn-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="hn-search">
          <span className="lens">🔍</span>
          <input
            ref={searchRef} type="text" placeholder="Поиск: по-русски или по-английски, например «гарантия»" value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && searchResults[0]) openCard(searchResults[0]); }}
          />
          {search ? <button className="clr" onClick={() => setSearch('')} title="Очистить">✕</button> : <span className="key" title="Нажмите / для поиска">/</span>}
        </div>
      </div>

      {words.length > 0 ? (
        searchResults.length > 0
          ? <Section title={`Найдено: ${searchResults.length}`} icon="🔍" iconBg="#EEF2FF" cards={searchResults} favorites={favorites} onToggleFavorite={toggleFavorite} hint="Enter — открыть первый" />
          : <div className="hn-panel hn-empty">Ничего не найдено по запросу «{search}»</div>
      ) : (
        <>
          {favoriteCards.length > 0 && (
            <Section title="Избранное" icon="⭐" iconBg="#FEF3C7" cards={favoriteCards} favorites={favorites} onToggleFavorite={toggleFavorite} />
          )}
          {visibleSections.map((s) => (
            <Section key={s.id} {...s} favorites={favorites} onToggleFavorite={toggleFavorite} />
          ))}
        </>
      )}
    </div>
  );
}
