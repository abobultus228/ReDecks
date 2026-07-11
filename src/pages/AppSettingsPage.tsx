import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import BackgroundAccessCard from '../components/BackgroundAccessCard';
import { requestNotifPermission, syncNotifier, seedExchangeBaseline } from '../utils/notifier';
import {
  mediaCacheAvailable,
  getMediaCacheConfig,
  setMediaCacheConfig,
  clearMediaCache,
  formatBytes,
  MEDIA_CACHE_MIN_MB,
  MEDIA_CACHE_MAX_MB,
} from '../utils/mediaCache';

interface Props {
  onLogout: () => void;
}

export default function AppSettingsPage({ onLogout }: Props) {
  const store = useAppStore();
  const [confirmLogout, setConfirmLogout] = useState(false);

  // ── кэш медиа ──
  const cacheAvailable = mediaCacheAvailable();
  const [cacheEnabled, setCacheEnabled] = useState(false);
  const [cacheLimit, setCacheLimit] = useState('500'); // строка для поля ввода
  const [cacheUsage, setCacheUsage] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!cacheAvailable) return;
    let alive = true;
    getMediaCacheConfig().then((c) => {
      if (!alive) return;
      setCacheEnabled(c.enabled);
      setCacheLimit(String(c.limitMb));
      setCacheUsage(c.usageBytes);
    });
    return () => { alive = false; };
  }, [cacheAvailable]);

  const toggleCache = async (v: boolean) => {
    setCacheEnabled(v);
    const limit = clampLimit(cacheLimit);
    const c = await setMediaCacheConfig(v, limit);
    setCacheLimit(String(c.limitMb));
    setCacheUsage(c.usageBytes);
  };

  const applyLimit = async () => {
    setApplying(true);
    setApplied(false);
    const limit = clampLimit(cacheLimit);
    const c = await setMediaCacheConfig(cacheEnabled, limit);
    setCacheLimit(String(c.limitMb));
    setCacheUsage(c.usageBytes);
    setApplying(false);
    setApplied(true);
    setTimeout(() => setApplied(false), 1500);
  };

  const clearCache = async () => {
    const usage = await clearMediaCache();
    setCacheUsage(usage);
  };

  const toggleMaster = async (v: boolean) => {
    store.setNotificationsEnabled(v);
    if (v) await requestNotifPermission(); // спрашиваем право на устройстве
    await store.saveSettings();
    await syncNotifier();
    if (v) await seedExchangeBaseline();
  };

  const toggleChat = async (v: boolean) => {
    store.setChatNotificationsEnabled(v);
    await store.saveSettings();
    await syncNotifier();
  };

  const toggleExchanges = async (v: boolean) => {
    store.setExchangeNotificationsEnabled(v);
    await store.saveSettings();
    await syncNotifier();
    if (v) await seedExchangeBaseline();
  };

  const toggleVibration = async (v: boolean) => {
    store.setVibrationEnabled(v);
    await store.saveSettings();
    await syncNotifier();
  };

  const doLogout = async () => {
    store.setToken('');
    store.setUserId('');
    store.setIsPremium(false);
    await store.saveSettings();
    await syncNotifier(); // токена нет -> воркер выключится
    onLogout();
  };

  return (
    <div style={p.root}>
      <PageHeader title="Настройки" />

      <div style={p.scroll}>
        <div style={p.card}>
          <div style={p.cardHeader}><span style={p.cardTitle}>Уведомления</span></div>
          <div style={p.cardBody}>
            <Toggle
              label="Уведомления"
              checked={store.notificationsEnabled}
              onChange={toggleMaster}
            />

            <div style={p.childGroup}>
              <Toggle
                label="Чат"
                checked={store.chatNotificationsEnabled}
                disabled={!store.notificationsEnabled}
                onChange={toggleChat}
                child
              />
              <Toggle
                label="Обмены"
                checked={store.exchangeNotificationsEnabled}
                disabled={!store.notificationsEnabled}
                onChange={toggleExchanges}
                child
              />
            </div>

            <div style={p.divider} />
            <Toggle
              label="Вибрация"
              checked={store.vibrationEnabled}
              disabled={!store.notificationsEnabled}
              onChange={toggleVibration}
            />
            <p style={p.hint}>
              В фоне примерно раз в 15 минут приложение проверяет новые сообщения
              в чате и новые входящие обмены и показывает уведомление. Уведомления
              приходят, только когда приложение закрыто.
            </p>
          </div>
        </div>

        <BackgroundAccessCard />

        {cacheAvailable && (
          <div style={p.card}>
            <div style={p.cardHeader}><span style={p.cardTitle}>Кэш медиа</span></div>
            <div style={p.cardBody}>
              <Toggle
                label="Кэшировать фото и видео"
                checked={cacheEnabled}
                onChange={toggleCache}
              />

              {cacheEnabled && (
                <>
                  <div style={p.divider} />
                  <div style={p.fieldRow}>
                    <span style={p.fieldLabel}>Лимит, МБ</span>
                    <input
                      style={p.numInput}
                      value={cacheLimit}
                      onChange={(e) => setCacheLimit(e.target.value.replace(/[^\d]/g, ''))}
                      inputMode="numeric"
                      placeholder="500"
                    />
                  </div>
                  <button
                    style={{ ...p.applyBtn, ...(applying ? p.applyDisabled : {}) }}
                    onClick={applyLimit}
                    disabled={applying}
                  >
                    {applying ? 'Применяю…' : applied ? '✓ Применено' : 'Применить'}
                  </button>
                  <p style={p.hint}>
                    От {MEDIA_CACHE_MIN_MB} до {MEDIA_CACHE_MAX_MB} МБ. Занято: {formatBytes(cacheUsage)}.
                  </p>
                  <button style={p.clearBtn} onClick={clearCache}>Очистить кэш</button>
                </>
              )}

              <p style={p.hint}>
                Скачанные картинки и видео карт, аватарок и обложек хранятся на устройстве,
                чтобы не загружать их повторно. При превышении лимита удаляются самые старые.
              </p>
            </div>
          </div>
        )}

        <button style={p.logoutBtn} onClick={() => setConfirmLogout(true)}>
          Выйти из аккаунта
        </button>
      </div>

      {confirmLogout && (
        <div style={p.backdrop} onClick={() => setConfirmLogout(false)}>
          <div style={p.modal} onClick={(e) => e.stopPropagation()}>
            <div style={p.modalTitle}>Выйти из аккаунта?</div>
            <div style={p.modalText}>Токен будет удалён, уведомления отключатся.</div>
            <div style={p.modalRow}>
              <button style={p.modalCancel} onClick={() => setConfirmLogout(false)}>Отмена</button>
              <button style={p.modalConfirm} onClick={doLogout}>Выйти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clampLimit(value: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MEDIA_CACHE_MIN_MB;
  return Math.max(MEDIA_CACHE_MIN_MB, Math.min(MEDIA_CACHE_MAX_MB, n));
}

function Toggle({
  label, checked, onChange, disabled, child,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; child?: boolean }) {
  return (
    <div
      style={{ ...p.toggleRow, ...(child ? p.toggleRowChild : {}), opacity: disabled ? 0.45 : 1 }}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span style={child ? p.toggleLabelChild : p.toggleLabel}>{label}</span>
      <div style={{ ...p.track, background: checked ? 'var(--accent)' : 'var(--bg3)' }}>
        <div style={{ ...p.thumb, transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
      </div>
    </div>
  );
}

const p: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' },
  cardHeader: { padding: '12px 14px', borderBottom: '1px solid var(--border)' },
  cardTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.12em' },
  cardBody: { padding: '6px 14px 14px' },
  divider: { height: '1px', background: 'var(--border)', margin: '2px 0' },
  hint: { fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--text3)', lineHeight: 1.5, marginTop: '10px' },

  fieldRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 0' },
  fieldLabel: { fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--text)' },
  numInput: {
    width: '110px', textAlign: 'right', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '15px',
    padding: '10px 12px', outline: 'none',
  },
  applyBtn: {
    width: '100%', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '12px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
    marginTop: '4px', WebkitTapHighlightColor: 'transparent',
  },
  applyDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  clearBtn: {
    width: '100%', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 600,
    fontSize: '13px', cursor: 'pointer', marginTop: '10px', WebkitTapHighlightColor: 'transparent',
  },

  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  toggleRowChild: { padding: '9px 0' },
  childGroup: {
    marginLeft: '14px',
    paddingLeft: '12px',
    borderLeft: '2px solid var(--border)',
  },
  toggleLabel: { fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--text)' },
  toggleLabelChild: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },
  track: { width: '40px', height: '24px', borderRadius: '12px', position: 'relative', transition: 'background 0.2s', flexShrink: 0 },
  thumb: { width: '20px', height: '20px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', transition: 'transform 0.2s' },

  logoutBtn: { width: '100%', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '15px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },

  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  modal: { width: '100%', maxWidth: '320px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px' },
  modalTitle: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '18px', color: 'var(--text)' },
  modalText: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.5 },
  modalRow: { display: 'flex', gap: '10px', marginTop: '20px' },
  modalCancel: { flex: 1, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  modalConfirm: { flex: 1, background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
};
