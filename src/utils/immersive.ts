import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

/**
 * Прячет системные панели Android, пока открыто приложение:
 *  - статус-бар (шторку уведомлений сверху)
 *  - панель навигации снизу
 *
 * JS-уровень убирает статус-бар и отдаёт WebView весь экран.
 * Полноценный immersive sticky (чтобы шторка не вытягивалась, а панель
 * навигации скрывалась) включается в нативном MainActivity.java —
 * см. native-android/MainActivity.java и инструкцию в README.
 */
async function applyImmersive(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await StatusBar.hide();
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // плагин может быть недоступен в вебе/при разработке — это нормально
  }
}

/**
 * Включает immersive-режим и переустанавливает его каждый раз, когда
 * приложение возвращается на передний план (Android сбрасывает флаги,
 * например после показа шторки или смены ориентации).
 *
 * Возвращает функцию отписки.
 */
export function setupImmersive(): () => void {
  void applyImmersive();

  let remove: (() => void) | undefined;

  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void applyImmersive();
  }).then((handle) => {
    remove = () => handle.remove();
  });

  return () => {
    remove?.();
  };
}
