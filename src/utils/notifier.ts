import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAppStore } from '../store';
import { getExchanges } from '../api/extra';

/**
 * Мост к нативному фоновому уведомителю (WorkManager + NotificationManager).
 *
 * Разрешение POST_NOTIFICATIONS просим из UI через @capacitor/local-notifications,
 * а сам опрос (чат + обмены) и показ уведомлений при закрытом приложении делает
 * нативный Worker.
 */

interface NotifierPlugin {
  /** Записывает конфиг в нативное хранилище и включает/выключает периодическую задачу. */
  setConfig(opts: {
    token: string;
    userId: string;
    enabled: boolean;        // общий рубильник
    chatEnabled: boolean;    // дочерний: уведомления чата
    exchangesEnabled: boolean; // дочерний: уведомления обменов
    vibrate: boolean;
    mutedRooms: number[];
  }): Promise<void>;

  /** Базовая линия обменов: id входящих wait-обменов, которые пользователь уже видел. */
  setExchangeBaseline(opts: { ids: number[] }): Promise<void>;

  getDeviceInfo(): Promise<{
    manufacturer: string;
    model: string;
    sdkInt: number;
    ignoringBatteryOptimizations: boolean;
  }>;
  openAppSettings(): Promise<void>;
  requestIgnoreBatteryOptimizations(): Promise<{ already: boolean }>;
}

const Notifier = registerPlugin<NotifierPlugin>('Notifier');

function available(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Notifier');
}

/** Запрашивает разрешение на уведомления (Android 13+). Возвращает true, если выдано. */
export async function requestNotifPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const res = await LocalNotifications.requestPermissions();
    return res.display === 'granted';
  } catch {
    return false;
  }
}

/** Текущий статус разрешения на уведомления, без запроса. */
export async function checkNotifPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  try {
    const res = await LocalNotifications.checkPermissions();
    return res.display === 'granted';
  } catch {
    return false;
  }
}

export interface DeviceInfo {
  manufacturer: string;
  model: string;
  sdkInt: number;
  ignoringBatteryOptimizations: boolean;
}

/** Инфо об устройстве для онбординга (вендор, статус батареи). */
export async function getDeviceInfo(): Promise<DeviceInfo | null> {
  if (!available()) return null;
  try {
    return await Notifier.getDeviceInfo();
  } catch {
    return null;
  }
}

/** Открывает системный экран «О приложении». */
export async function openAppSettings(): Promise<void> {
  if (!available()) return;
  try {
    await Notifier.openAppSettings();
  } catch {
    /* ignore */
  }
}

/** Системный диалог «без ограничений батареи». Возвращает already=true, если уже снято. */
export async function requestIgnoreBatteryOptimizations(): Promise<{ already: boolean }> {
  if (!available()) return { already: false };
  try {
    return await Notifier.requestIgnoreBatteryOptimizations();
  } catch {
    return { already: false };
  }
}

/**
 * Синхронизирует нативную часть с текущими настройками из стора.
 * Вызывать после входа и при любом изменении переключателей.
 */
export async function syncNotifier(): Promise<void> {
  if (!available()) return;
  const s = useAppStore.getState();
  const master = s.notificationsEnabled && Boolean(s.token);
  try {
    await Notifier.setConfig({
      token: s.token,
      userId: s.userId,
      enabled: master,
      chatEnabled: s.chatNotificationsEnabled,
      exchangesEnabled: s.exchangeNotificationsEnabled,
      vibrate: s.vibrationEnabled,
      mutedRooms: s.mutedRoomIds,
    });
  } catch {
    // плагин может отсутствовать в вебе/деве — это нормально
  }
}

/**
 * Засев базовой линии обменов: пока пользователь в приложении, запоминаем
 * текущие входящие wait-обмены как «уже виденные», чтобы воркер потом
 * уведомлял только о появившихся позже. Вызывать при входе и при возврате
 * приложения на передний план.
 */
export async function seedExchangeBaseline(): Promise<void> {
  if (!available()) return;
  const s = useAppStore.getState();
  if (!s.notificationsEnabled || !s.exchangeNotificationsEnabled) return;
  if (!s.token || !s.userId) return;

  const me = Number(s.userId);
  try {
    const { results } = await getExchanges(s.token, s.userId, 1);
    const ids = results
      .filter((e) => e.status === 'wait' && Number(e.creator?.id) !== me)
      .map((e) => e.id);
    await Notifier.setExchangeBaseline({ ids });
  } catch {
    // сеть/лимит — просто пропускаем, базовая линия обновится в следующий раз
  }
}
