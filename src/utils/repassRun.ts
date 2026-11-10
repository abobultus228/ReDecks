import { Preferences } from '@capacitor/preferences';
import { markChapterUnread, readChapter } from '../api/extra';

const KEY = 'repass_pending_restore';

export interface RepassPendingRestore {
  userId: string;
  chapterId: number;
  titleName: string;
  originallyViewed: boolean;
}

export async function getPendingRepassRestore(userId: string): Promise<RepassPendingRestore | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  try {
    const pending = JSON.parse(value) as RepassPendingRestore;
    if (!Number.isInteger(pending.chapterId) || typeof pending.userId !== 'string' || typeof pending.originallyViewed !== 'boolean') {
      throw new Error('Сохранённая отметка Re:pass повреждена.');
    }
    if (pending.userId !== userId) {
      throw new Error('Есть незавершённое восстановление Re:pass для другого аккаунта. Войдите в него для восстановления.');
    }
    return pending;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Есть незавершённое')) throw error;
    throw new Error('Не удалось прочитать сохранённое состояние Re:pass. Проверьте отметки глав вручную.');
  }
}

async function savePending(pending: RepassPendingRestore): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(pending) });
}

function ensureRead(status: number, chapterId: number): void {
  if (![200, 201, 204].includes(status)) throw new Error(`Глава ${chapterId}: чтение вернуло HTTP ${status}.`);
}

/** Возвращает отметку главы к состоянию до запуска; журнал остаётся при ошибке. */
export async function restoreRepassChapter(token: string, pending: RepassPendingRestore): Promise<void> {
  if (pending.originallyViewed) {
    const result = await readChapter(token, '', pending.chapterId);
    ensureRead(result.status, pending.chapterId);
  } else {
    await markChapterUnread(token, pending.chapterId);
  }
  await Preferences.remove({ key: KEY });
}

/** Восстановление после прерывания приложения или неудачного запроса. */
export async function recoverRepassChapter(token: string, userId: string): Promise<RepassPendingRestore | null> {
  const pending = await getPendingRepassRestore(userId);
  if (pending) await restoreRepassChapter(token, pending);
  return pending;
}

/** Одна глава: прочитать и в любом случае восстановить исходную отметку. */
export async function runRepassChapter(
  token: string,
  pending: RepassPendingRestore,
): Promise<void> {
  await savePending(pending);
  let readError: unknown;
  let restoreError: unknown;
  try {
    if (pending.originallyViewed) await markChapterUnread(token, pending.chapterId);
    const result = await readChapter(token, '', pending.chapterId);
    ensureRead(result.status, pending.chapterId);
  } catch (error) {
    readError = error;
  } finally {
    try {
      if (pending.originallyViewed && !readError) {
        // Успешный POST уже вернул главу в исходное прочитанное состояние.
        await Preferences.remove({ key: KEY });
      } else {
        await restoreRepassChapter(token, pending);
      }
    } catch (error) {
      restoreError = error;
    }
  }
  if (restoreError) {
    const detail = restoreError instanceof Error ? restoreError.message : String(restoreError);
    throw new Error(`Не удалось восстановить отметку главы ${pending.chapterId}: ${detail}. Откройте Re:pass повторно для восстановления.`);
  }
  if (readError) throw readError;
}
