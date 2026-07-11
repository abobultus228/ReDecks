import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ChapterReadState {
  running: boolean;
  target: number;
  readsDone: number;
  coins: number;
  cards: number;
  stoppedReason: string;
}

export interface StartChapterReadOpts {
  token: string;
  cookie: string;
  branchId: number;
  target: number;
  /**
   * Слать ли Cookie-заголовок в запросах чтения/сброса.
   * false → «голый токен»: уходит только Authorization: Bearer, без кук
   * (для проверки гипотезы, что куки мешают начислению карт).
   * По умолчанию true — прежнее поведение.
   */
  sendCookies?: boolean;
}

interface ChapterReadNativePlugin {
  start(opts: StartChapterReadOpts): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<ChapterReadState>;
  getNativeCookies(): Promise<{ cookie: string }>;
  testViews(opts: { token: string; chapterId: number; sendCookies: boolean }): Promise<{ log: string }>;
}

const Native = registerPlugin<ChapterReadNativePlugin>('ChapterRead');

function available(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ChapterRead');
}

export function chapterReadAvailable(): boolean {
  return available();
}

export async function startChapterRead(opts: StartChapterReadOpts): Promise<void> {
  if (!available()) throw new Error('Фоновый режим недоступен на этой платформе.');
  // sendCookies по умолчанию true, если не задан
  await Native.start({ sendCookies: true, ...opts });
}

export async function stopChapterRead(): Promise<void> {
  if (!available()) return;
  try {
    await Native.stop();
  } catch {
    /* ignore */
  }
}

export async function getChapterReadState(): Promise<ChapterReadState | null> {
  if (!available()) return null;
  try {
    return await Native.getState();
  } catch {
    return null;
  }
}

/** Куки из нативного CookieManager (те, что реально уходят в запрос, вкл. HttpOnly). */
export async function getNativeCookies(): Promise<string> {
  if (!available()) return '';
  try {
    const r = await Native.getNativeCookies();
    return r?.cookie ?? '';
  } catch {
    return '';
  }
}

/** Тестовый запрос views/ на одну главу; возвращает полный лог запроса и ответа. */
export async function testViews(
  token: string,
  chapterId: number,
  sendCookies: boolean,
): Promise<string> {
  if (!available()) throw new Error('Тестовый запрос недоступен на этой платформе.');
  const r = await Native.testViews({ token, chapterId, sendCookies });
  return r?.log ?? '';
}
