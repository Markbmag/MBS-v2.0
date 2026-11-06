import React from 'react';

// Защита экранов (в том числе ТВ) от «белого экрана».
// Если страница упала с ошибкой, вместо пустого экрана показывается короткое сообщение,
// и страница сама перезагружается. Пока ошибок нет, этот компонент ничего не показывает
// и ни на что не влияет.
//
// Если ошибка повторяется сразу после перезагрузки, пауза растёт: 10 с, 30 с, 1 мин,
// затем каждые 5 мин — чтобы ТВ восстановился, как только неполадка будет устранена
// (например, после обновления программы или перезапуска сервера).

const DELAYS_SEC = [10, 30, 60, 300];
const KEY = 'page_error_reloads';
const QUIET_MS = 5 * 60 * 1000; // если 5 минут без ошибок — счётчик сбрасывается

function readAttempts() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (s && Date.now() - s.at < QUIET_MS + 300 * 1000) return s.n;
  } catch { /* недоступно — считаем с нуля */ }
  return 0;
}

function saveAttempts(n) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ n, at: Date.now() })); } catch { /* ничего */ }
}

const boxStyle = {
  margin: '60px auto',
  maxWidth: 520,
  padding: '28px 32px',
  borderRadius: 16,
  background: '#FFFFFF',
  border: '1px solid #F0F0F5',
  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.06)',
  textAlign: 'center',
  color: '#1F2937',
  fontFamily: 'inherit',
};

export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, secondsLeft: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[Страница] ошибка, будет перезагрузка:', error);
    const attempts = readAttempts();
    const delay = DELAYS_SEC[Math.min(attempts, DELAYS_SEC.length - 1)];
    saveAttempts(attempts + 1);
    this.setState({ secondsLeft: delay });
    this.timer = setInterval(() => {
      this.setState((s) => {
        if (s.secondsLeft <= 1) { clearInterval(this.timer); window.location.reload(); return { secondsLeft: 0 }; }
        return { secondsLeft: s.secondsLeft - 1 };
      });
    }, 1000);
  }

  componentDidMount() {
    // Страница проработала без ошибок — сбрасываем счётчик повторных перезагрузок.
    this.quietTimer = setTimeout(() => { try { sessionStorage.removeItem(KEY); } catch { /* ничего */ } }, QUIET_MS);
  }

  componentWillUnmount() {
    clearInterval(this.timer);
    clearTimeout(this.quietTimer);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={boxStyle}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>Страница временно не отвечает</div>
        <div style={{ fontSize: 16, color: '#6B7280' }}>
          Автоматическая перезагрузка через {this.state.secondsLeft} с
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 18, padding: '10px 22px', borderRadius: 10, border: 'none', background: '#35384F', color: '#FFFFFF', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
        >
          Перезагрузить сейчас
        </button>
      </div>
    );
  }
}
