import { Capacitor, registerPlugin } from '@capacitor/core';

export interface ChapterReadState {
  running: boolean;
  branchId: number;
  target: number;
  readsDone: number;
  coins: number;
  cards: number;
  rewardCards: { mid: string; high: string }[];
  stoppedReason: string;
}

export interface StartChapterReadOpts {
  token: string;
  branchId: number;
  target: number;
  /** Задержка между главами, мс (300..1000). По умолчанию 1000. */
  delayMs?: number;
  /** Лайкать ли главы (POST votes/). По умолчанию true. */
  like?: boolean;
  /** Повторять ту же главу через 3 с после HTTP 502. По умолчанию false. */
  ignore502?: boolean;
}

interface ChapterReadNativePlugin {
  start(opts: StartChapterReadOpts): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<ChapterReadState>;
  testViews(opts: { token: string; chapterId: number }): Promise<{ log: string }>;
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
  await Native.start(opts);
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

/** Тестовый запрос views/ на одну главу; возвращает полный лог запроса и ответа. */
export async function testViews(
  token: string,
  chapterId: number,
): Promise<string> {
  if (!available()) throw new Error('Тестовый запрос недоступен на этой платформе.');
  const r = await Native.testViews({ token, chapterId });
  return r?.log ?? '';
}
