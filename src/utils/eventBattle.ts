import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Мост к нативному foreground-сервису, который в цикле проводит PvP-дуэли
 * ивента и показывает постоянное уведомление. Цикл живёт в сервисе, поэтому
 * работает и при свёрнутом/закрытом приложении.
 */

export interface EventBattleState {
  running: boolean;
  battlesDone: number;
  wins: number;
  total: number; // 0 = бесконечно
  nextBattleAtMs: number; // когда запланирована следующая дуэль (epoch ms), 0 если нет
  waitMs: number; // длительность текущей паузы между дуэлями
  stoppedReason: string; // причина остановки (для показа в UI), '' пока идёт
}

export interface StartOpts {
  token: string;
  repetitions: number; // 0 = бесконечно
  delaySeconds: number; // ≥ 40
  deviationSeconds: number; // 0..10
}

interface EventBattleNativePlugin {
  start(opts: StartOpts): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<EventBattleState>;
}

const Native = registerPlugin<EventBattleNativePlugin>('EventBattle');

function available(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('EventBattle');
}

export function eventBattleAvailable(): boolean {
  return available();
}

export async function startBattles(opts: StartOpts): Promise<void> {
  if (!available()) throw new Error('Фоновый режим недоступен на этой платформе.');
  await Native.start(opts);
}

export async function stopBattles(): Promise<void> {
  if (!available()) return;
  try {
    await Native.stop();
  } catch {
    /* ignore */
  }
}

export async function getBattleState(): Promise<EventBattleState | null> {
  if (!available()) return null;
  try {
    return await Native.getState();
  } catch {
    return null;
  }
}
