import { useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  getDeviceInfo,
  openAppSettings,
  requestIgnoreBatteryOptimizations,
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

// ─── Компонент ────────────────────────────────────────────────────────────────

/** Карточка управления фоновой работой (снятие ограничений батареи). */
export default function BackgroundAccessCard() {
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  const refresh = async () => setDevice(await getDeviceInfo());

  useEffect(() => {
    void refresh();
    // вернулись из системных настроек — обновим статус батареи
    const sub = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refresh();
    });
    return () => { void sub.then((h) => h.remove()); };
  }, []);

  const vendor = detectVendor(device?.manufacturer ?? '');
  const vendorInfo = VENDOR_STEPS[vendor];
  const battOk = device?.ignoringBatteryOptimizations ?? false;

  const fixBattery = async () => {
    await requestIgnoreBatteryOptimizations();
    await refresh();
  };

  return (
    <div style={c.card}>
      <div style={c.cardHeader}>
        <span style={c.cardTitle}>Работа в фоне</span>
        <span style={{ ...c.pill, ...(battOk ? c.pillOk : c.pillBad) }}>
          {battOk ? '✓ Без ограничений' : 'Ограничено'}
        </span>
      </div>
      <div style={c.cardBody}>
        <p style={c.text}>
          Чтобы фоновые задачи (уведомления, чтение и ивент при закрытом приложении)
          работали стабильно, системе нужно разрешить приложению работать в фоне.
        </p>

        {!battOk && (
          <button style={c.btnPrimary} onClick={fixBattery}>
            Снять ограничения батареи
          </button>
        )}
        <button style={c.btnSecondary} onClick={() => void openAppSettings()}>
          Открыть настройки приложения
        </button>

        {vendorInfo.name && <div style={c.vendorTag}>Похоже, у тебя {vendorInfo.name}</div>}
        <ol style={c.steps}>
          {vendorInfo.steps.map((step, i) => (
            <li key={i} style={c.step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const c: Record<string, React.CSSProperties> = {
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '12px 14px', borderBottom: '1px solid var(--border)' },
  cardTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.12em' },
  cardBody: { padding: '12px 14px 14px' },
  text: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 },

  btnPrimary: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: '#fff',
    background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '12px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  btnSecondary: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'var(--text)',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent', marginTop: '8px',
  },

  vendorTag: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '14px' },
  steps: { margin: '8px 0 0', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' },
  step: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text2)', lineHeight: 1.5 },

  pill: { fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '3px 8px', borderRadius: '999px', border: '1px solid', whiteSpace: 'nowrap', flexShrink: 0 },
  pillOk: { color: 'var(--green)', borderColor: 'var(--green)', background: 'rgba(34,197,94,0.08)' },
  pillBad: { color: 'var(--text3)', borderColor: 'var(--border)', background: 'var(--bg3)' },
};
