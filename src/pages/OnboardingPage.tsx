import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useAppStore } from '../store';
import {
  requestNotifPermission,
  checkNotifPermission,
  getDeviceInfo,
  openAppSettings,
  requestIgnoreBatteryOptimizations,
  syncNotifier,
  seedExchangeBaseline,
  type DeviceInfo,
} from '../utils/notifier';

// ─── Инструкции по вендору ────────────────────────────────────────────────────

type Vendor = 'miui' | 'samsung' | 'huawei' | 'oppo' | 'vivo' | 'generic';

function detectVendor(manufacturer: string): Vendor {
  const m = (manufacturer || '').toLowerCase();
  if (/(xiaomi|redmi|poco)/.test(m)) return 'miui';
  if (/samsung/.test(m)) return 'samsung';
  if (/(huawei|honor)/.test(m)) return 'huawei';
  if (/(oppo|realme|oneplus)/.test(m)) return 'oppo';
  if (/(vivo|iqoo)/.test(m)) return 'vivo';
  return 'generic';
}

const VENDOR_STEPS: Record<Vendor, { name: string; steps: string[] }> = {
  miui: {
    name: 'Xiaomi / Redmi / POCO',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Выключи «Приостановить работу приложения, если оно не используется».',
      'Открой раздел «Батарея» и выбери «Без ограничений».',
      'Вернись и включи «Автозапуск», если он есть.',
    ],
  },
  samsung: {
    name: 'Samsung',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Открой «Батарея» и выбери «Без ограничений».',
      'Убедись, что приложение не в списке «спящих» в настройках обслуживания батареи.',
    ],
  },
  huawei: {
    name: 'Huawei / Honor',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Открой «Батарея» → «Запуск приложения», переключи на ручное управление.',
      'Разреши автозапуск, работу в фоне и вторичный запуск.',
    ],
  },
  oppo: {
    name: 'OPPO / realme / OnePlus',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Открой «Батарея» и выбери «Не ограничивать» / разреши фоновую активность.',
      'Включи «Автозапуск», если он есть.',
    ],
  },
  vivo: {
    name: 'vivo / iQOO',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Разреши высокое потребление батареи в фоне и автозапуск.',
    ],
  },
  generic: {
    name: '',
    steps: [
      'Нажми «Открыть настройки приложения».',
      'Открой «Батарея» и сними ограничения для фоновой работы.',
    ],
  },
};

// ─── Страница ─────────────────────────────────────────────────────────────────

export default function OnboardingPage({ onDone }: { onDone: () => void }) {
  const store = useAppStore();

  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [permGranted, setPermGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = async () => {
    setDevice(await getDeviceInfo());
    setPermGranted(await checkNotifPermission());
  };

  useEffect(() => {
    void refreshStatus();
    // вернулись из системных настроек — обновим статусы батареи/разрешения
    const sub = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refreshStatus();
    });
    return () => { void sub.then((h) => h.remove()); };
  }, []);

  const vendor = detectVendor(device?.manufacturer ?? '');
  const vendorInfo = VENDOR_STEPS[vendor];
  const battOk = device?.ignoringBatteryOptimizations ?? false;

  const apply = async () => {
    await store.saveSettings();
    await syncNotifier();
  };

  const toggleMaster = async (v: boolean) => {
    store.setNotificationsEnabled(v);
    if (v) {
      await requestNotifPermission();
      setPermGranted(await checkNotifPermission());
    }
    await apply();
  };

  const toggleChat = async (v: boolean) => {
    store.setChatNotificationsEnabled(v);
    await apply();
  };

  const toggleExchanges = async (v: boolean) => {
    store.setExchangeNotificationsEnabled(v);
    await apply();
  };

  const askPermission = async () => {
    await requestNotifPermission();
    setPermGranted(await checkNotifPermission());
  };

  const fixBattery = async () => {
    await requestIgnoreBatteryOptimizations();
    setDevice(await getDeviceInfo());
  };

  const finish = async () => {
    setBusy(true);
    store.setOnboardingDone(true);
    await store.saveSettings();
    await syncNotifier();
    if (store.notificationsEnabled && store.exchangeNotificationsEnabled) {
      await seedExchangeBaseline();
    }
    setBusy(false);
    onDone();
  };

  const master = store.notificationsEnabled;

  return (
    <div style={s.root}>
      <div style={s.scroll}>
        <div style={s.header}>
          <h1 style={s.h1}>Настройка уведомлений</h1>
          <p style={s.sub}>
            Пара шагов, чтобы уведомления о сообщениях и обменах приходили вовремя.
          </p>
        </div>

        {/* 1. Что уведомлять */}
        <div style={s.card}>
          <div style={s.cardTitle}>Что уведомлять</div>
          <Toggle label="Получать уведомления" checked={master} onChange={toggleMaster} />
          <div style={s.childGroup}>
            <Toggle
              label="Чат"
              checked={store.chatNotificationsEnabled}
              disabled={!master}
              onChange={toggleChat}
              child
            />
            <Toggle
              label="Обмены"
              checked={store.exchangeNotificationsEnabled}
              disabled={!master}
              onChange={toggleExchanges}
              child
            />
          </div>
        </div>

        {/* 2. Разрешение */}
        {master && (
          <div style={s.card}>
            <div style={s.cardTitleRow}>
              <span style={s.cardTitle}>Разрешение на уведомления</span>
              <StatusPill ok={permGranted === true} label={permGranted === true ? 'Выдано' : 'Нет'} />
            </div>
            {permGranted !== true && (
              <>
                <p style={s.cardText}>Без этого система не покажет уведомления.</p>
                <button style={s.btnPrimary} onClick={askPermission}>
                  Разрешить уведомления
                </button>
              </>
            )}
          </div>
        )}

        {/* 3. Работа в фоне */}
        {master && (
          <div style={s.card}>
            <div style={s.cardTitleRow}>
              <span style={s.cardTitle}>Работа в фоне</span>
              <StatusPill ok={battOk} label={battOk ? 'Без ограничений' : 'Ограничено'} />
            </div>
            <p style={s.cardText}>
              Чтобы уведомления приходили при закрытом приложении, системе нужно
              разрешить ему работать в фоне.
            </p>

            {!battOk && (
              <button style={s.btnPrimary} onClick={fixBattery}>
                Снять ограничения батареи
              </button>
            )}
            <button style={s.btnSecondary} onClick={() => void openAppSettings()}>
              Открыть настройки приложения
            </button>

            {vendorInfo.name && (
              <div style={s.vendorTag}>Похоже, у тебя {vendorInfo.name}</div>
            )}
            <ol style={s.steps}>
              {vendorInfo.steps.map((step, i) => (
                <li key={i} style={s.step}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div style={s.footer}>
        <button style={{ ...s.btnPrimary, ...s.doneBtn, ...(busy ? s.btnDisabled : {}) }} onClick={finish} disabled={busy}>
          {busy ? '…' : 'Готово'}
        </button>
      </div>
    </div>
  );
}

// ─── Мелкие компоненты ────────────────────────────────────────────────────────

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{ ...s.pill, ...(ok ? s.pillOk : s.pillBad) }}>
      {ok ? '✓ ' : ''}{label}
    </span>
  );
}

function Toggle({
  label, checked, onChange, disabled, child,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; child?: boolean }) {
  return (
    <div
      style={{ ...s.toggleRow, ...(child ? s.toggleRowChild : {}), opacity: disabled ? 0.45 : 1 }}
      onClick={() => { if (!disabled) onChange(!checked); }}
    >
      <span style={child ? s.toggleLabelChild : s.toggleLabel}>{label}</span>
      <div style={{ ...s.track, background: checked ? 'var(--accent)' : 'var(--bg3)' }}>
        <div style={{ ...s.thumb, transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
      </div>
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: '14px' },

  header: { marginBottom: '2px' },
  h1: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '24px', color: 'var(--text)', margin: 0, lineHeight: 1.2 },
  sub: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text3)', marginTop: '8px', lineHeight: 1.5 },

  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' },
  cardTitle: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)' },
  cardTitleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
  cardText: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', margin: '10px 0 12px', lineHeight: 1.5 },

  childGroup: { marginLeft: '14px', paddingLeft: '12px', borderLeft: '2px solid var(--border)', marginTop: '4px' },

  toggleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  toggleRowChild: { padding: '9px 0' },
  toggleLabel: { fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--text)' },
  toggleLabelChild: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },
  track: { width: '40px', height: '24px', borderRadius: '999px', position: 'relative', transition: 'background 0.15s', flexShrink: 0 },
  thumb: { width: '20px', height: '20px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '2px', left: 0, transition: 'transform 0.15s' },

  btnPrimary: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: '#fff',
    background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginTop: '4px',
  },
  btnSecondary: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'var(--text)',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginTop: '8px',
  },
  btnDisabled: { opacity: 0.5, cursor: 'default' },

  vendorTag: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '14px' },
  steps: { margin: '8px 0 0', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' },
  step: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text2)', lineHeight: 1.5 },

  pill: { fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '3px 8px', borderRadius: '999px', border: '1px solid', whiteSpace: 'nowrap' },
  pillOk: { color: 'var(--green)', borderColor: 'var(--green)', background: 'rgba(34,197,94,0.08)' },
  pillBad: { color: 'var(--text3)', borderColor: 'var(--border)', background: 'var(--bg3)' },

  footer: { padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg)' },
  doneBtn: { marginTop: 0 },
};
