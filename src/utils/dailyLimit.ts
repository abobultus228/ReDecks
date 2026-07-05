import { Preferences } from '@capacitor/preferences';

const KEY = 'limited:daily';
export const DAILY_MAX = 500;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Сколько прочтений уже сделано сегодня (0, если день сменился). */
export async function getDailyRead(): Promise<number> {
  try {
    const r = await Preferences.get({ key: KEY });
    if (!r.value) return 0;
    const o = JSON.parse(r.value) as { date?: string; count?: number };
    return o.date === today() ? (o.count ?? 0) : 0;
  } catch {
    return 0;
  }
}

/** Сколько ещё можно прочитать сегодня (0..DAILY_MAX). */
export async function getDailyRemaining(): Promise<number> {
  return Math.max(0, DAILY_MAX - (await getDailyRead()));
}

/** Прибавляет n к сегодняшнему счётчику. */
export async function addDailyRead(n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const cur = await getDailyRead();
    await Preferences.set({ key: KEY, value: JSON.stringify({ date: today(), count: cur + n }) });
  } catch {
    /* ignore */
  }
}
