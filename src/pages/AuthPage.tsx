import { useState } from 'react';
import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser';
import { Preferences } from '@capacitor/preferences';
import { useAppStore } from '../store';
import { CapacitorHttp } from '@capacitor/core';

interface Props {
  onAuth: () => void;
}

export default function AuthPage({ onAuth }: Props) {
  const { setToken, setUserId, saveSettings } = useAppStore();
  const [manualToken, setManualToken] = useState('');
  const [manualUserId, setManualUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'choice' | 'manual'>('choice');

  // Авторизация через Browser (InAppBrowser) — пользователь логинится,
  // потом вручную вставляет токен из cookie/localStorage remanga.org
  
const handleBrowserAuth = async () => {
  setError('');

  try {
    const browser = InAppBrowser.create(
      'https://remanga.org/',
      '_blank',
      'location=yes,clearcache=no,clearsessioncache=no'
    );

    browser.on('loadstop').subscribe(async () => {
      try {
        const result = await browser.executeScript({
          code: 'document.cookie',
        });

        const cookies = Array.isArray(result) ? String(result[0] ?? '') : '';
        const tokenMatch = cookies.match(/(?:^|;\s*)token=([^;]+)/);
        const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : '';

        if (!token) return;

        setToken(token);

        // userId пока оставляем вручную, потому что в твоём API он нужен отдельно
        setMode('manual');
        setManualToken(token);

        browser.close();
      } catch {
        // Пока пользователь не залогинен, token может отсутствовать — это нормально
      }
    });
  } catch {
    setError('Не удалось открыть окно авторизации');
  }
};

  const handleManualSave = async () => {
    const token = manualToken.replace(/^Bearer\s+/i, '').trim();
    const uid = manualUserId.trim();

    if (!token) { setError('Введи токен'); return; }
    if (!uid || isNaN(Number(uid))) { setError('Введи числовой User ID'); return; }

    setLoading(true);
    try {
      // Быстрая проверка токена — попытка получить коллекции
      const res = await CapacitorHttp.get({
          url: `https://api.remanga.org/api/v2/inventory/${uid}/rare-collections/?count=1&page=1`,
          headers: {
            authorization: `Bearer ${token}`,
            accept: '*/*',
            origin: 'https://remanga.org',
            referer: 'https://remanga.org/',
          },
        });

        if (res.status === 401 || res.status === 403) {
        setError('Неверный токен или User ID');
        return;
      }
      setToken(token);
      setUserId(uid);
      await saveSettings();
      onAuth();
    } catch (err) {
      console.error('AUTH ERROR:', err);

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <div style={styles.root}>
      {/* Background decoration */}
      <div style={styles.bgOrb} />

      <div style={styles.header}>
        <div style={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect x="2" y="2" width="28" height="28" rx="8" fill="rgba(139,92,246,0.15)" stroke="rgba(139,92,246,0.4)" stroke-width="1"/>
              <path d="M10 22 V10 H16 C18 10 18 14 16 14 L22 22" stroke="#8b5cf6" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 style={styles.title}>ReDecks</h1>
        <p style={styles.subtitle}>авторизация</p>
      </div>

      {mode === 'choice' ? (
        <div style={styles.card}>
          <button style={styles.primaryBtn} onClick={handleBrowserAuth}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            Войти через браузер
          </button>

          <div style={styles.divider}>
            <span style={styles.dividerText}>или</span>
          </div>

          <button style={styles.ghostBtn} onClick={() => setMode('manual')}>
            Ввести токен вручную
          </button>

          <p style={styles.hint}>
            Откроется браузер → войди в аккаунт → скопируй токен из cookie «token» на remanga.org
          </p>
        </div>
      ) : (
        <div style={styles.card}>
          <p style={styles.instructions}>
            1. Войди на <b style={{ color: 'var(--accent)' }}>remanga.org</b> в браузере<br/>
            2. Открой DevTools → Application → Cookies<br/>
            3. Скопируй значение cookie <code style={styles.code}>token</code><br/>
            4. Вставь сюда 👇
          </p>

          <label style={styles.label}>Bearer Token</label>
          <input
            style={styles.input}
            type="password"
            placeholder="eyJ0eXAiOiJKV1Qi..."
            value={manualToken}
            onChange={e => setManualToken(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />

          <label style={styles.label}>User ID</label>
          <input
            style={styles.input}
            type="number"
            inputMode="numeric"
            placeholder="123456"
            value={manualUserId}
            onChange={e => setManualUserId(e.target.value)}
          />

          {error && <p style={styles.error}>{error}</p>}

          <button
            style={{ ...styles.primaryBtn, opacity: loading ? 0.6 : 1 }}
            onClick={handleManualSave}
            disabled={loading}
          >
            {loading ? 'Проверяю...' : 'Войти'}
          </button>

          <button style={styles.backBtn} onClick={() => { setMode('choice'); setError(''); }}>
            ← назад
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '24px 20px',
    position: 'relative',
    overflow: 'hidden',
  },
  bgOrb: {
    position: 'absolute',
    top: '-80px',
    right: '-80px',
    width: '300px',
    height: '300px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px',
  },
  logo: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '28px',
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
    marginBottom: '6px',
  },
  subtitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--accent)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  },
  card: {
    width: '100%',
    maxWidth: '360px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  primaryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 20px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '15px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  ghostBtn: {
    background: 'transparent',
    color: 'var(--text2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 20px',
    fontFamily: 'var(--font-display)',
    fontWeight: 600,
    fontSize: '14px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  backBtn: {
    background: 'transparent',
    color: 'var(--text3)',
    border: 'none',
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px',
    WebkitTapHighlightColor: 'transparent',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  dividerText: {
    color: 'var(--text3)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    flex: 1,
    textAlign: 'center',
    borderTop: '1px solid var(--border)',
    paddingTop: '0',
    position: 'relative',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    marginBottom: '-4px',
  },
  input: {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 14px',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s',
  },
  instructions: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    color: 'var(--text2)',
    lineHeight: 1.7,
    background: 'var(--bg3)',
    padding: '14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    background: 'rgba(139,92,246,0.15)',
    color: 'var(--accent)',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  hint: {
    fontFamily: 'var(--font-display)',
    fontSize: '12px',
    color: 'var(--text3)',
    lineHeight: 1.6,
    textAlign: 'center',
  },
  error: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--red)',
    background: 'rgba(239,68,68,0.08)',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(239,68,68,0.2)',
  },
};
