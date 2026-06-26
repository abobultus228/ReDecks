import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useAppStore } from '../store';

/**
 * Мост к нативному фоновому уведомителю (WorkManager + NotificationManager).
 *
 * Гибрид: разрешение POST_NOTIFICATIONS просим из UI через
 * @capacitor/local-notifications, а сам опрос rooms/ и показ уведомлений
 * при закрытом приложении делает нативный Worker.
 */

interface NotifierPlugin {
  /** Записывает конфиг в нативное хранилище и включает/выключает периодическую задачу. */
  setConfig(opts: {
    token: string;
    enabled: boolean;
    vibrate: boolean;
    mutedRooms: number[];
  }): Promise<void>;
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

/**
 * Синхронизирует нативную часть с текущими настройками из стора.
 * Вызывать после входа и при любом изменении: общий рубильник, вибрация,
 * мьют комнаты.
 */
export async function syncNotifier(): Promise<void> {
  if (!available()) return;
  const s = useAppStore.getState();
  try {
    await Notifier.setConfig({
      token: s.token,
      enabled: s.notificationsEnabled && Boolean(s.token),
      vibrate: s.vibrationEnabled,
      mutedRooms: s.mutedRoomIds,
    });
  } catch {
    // плагин может отсутствовать в вебе/деве — это нормально
  }
}
