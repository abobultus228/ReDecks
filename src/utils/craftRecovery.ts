import { Preferences } from '@capacitor/preferences';
import type { CraftTargetRank } from './craftExecutor';

const KEY = 'craft_pending_recovery';

export interface PendingCraftRecovery {
  userId: string;
  titleId: number;
  titleLabel: string;
  repairThrough: CraftTargetRank;
}

export async function getPendingCraftRecovery(): Promise<PendingCraftRecovery | null> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return null;
  let item: PendingCraftRecovery;
  try { item = JSON.parse(value) as PendingCraftRecovery; }
  catch { throw new Error('Журнал восстановления крафта повреждён. Проверьте коллекцию вручную.'); }
  if (!item || typeof item.userId !== 'string' || !Number.isInteger(item.titleId) || !['E', 'D', 'C'].includes(item.repairThrough)) {
    throw new Error('Журнал восстановления крафта повреждён. Проверьте коллекцию вручную.');
  }
  return item;
}

export async function savePendingCraftRecovery(item: PendingCraftRecovery): Promise<void> {
  if (await getPendingCraftRecovery()) throw new Error('Есть незавершённое восстановление предыдущего крафта.');
  await Preferences.set({ key: KEY, value: JSON.stringify(item) });
}

export async function clearPendingCraftRecovery(): Promise<void> {
  await Preferences.remove({ key: KEY });
}
