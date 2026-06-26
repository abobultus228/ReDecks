import { useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import { requestNotifPermission, syncNotifier } from '../utils/notifier';

interface Props {
  onLogout: () => void;
}

export default function AppSettingsPage({ onLogout }: Props) {
  const store = useAppStore();
  const [confirmLogout, setConfirmLogout] = useState(false);

  const toggleNotifications = async (v: boolean) => {
    store.setNotificationsEnabled(v);
    if (v) await requestNotifPermission();
    await store.saveSettings();
    await syncNotifier();
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
              label="Уведомления о сообщениях"
              checked={store.notificationsEnabled}
              onChange={toggleNotifications}
            />
            <div style={p.divider} />
            <Toggle
              label="Вибрация"
              checked={store.vibrationEnabled}
              disabled={!store.notificationsEnabled}
              onChange={toggleVibration}
            />
            <p style={p.hint}>
              Приложение проверяет новые сообщения в фоне примерно раз в 15 минут
              и показывает уведомление. Звука нет.
            </p>
          </div>
        </div>

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

function Toggle({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div
      style={{ ...p.toggleRow, opacity: disabled ? 0.45 : 1 }}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span style={p.toggleLabel}>{label}</span>
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

  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  toggleLabel: { fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--text)' },
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
