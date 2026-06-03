import { useRef, useCallback } from 'react';
import { useAppStore } from '../store';
import {
  getOwnedIds,
  getInventoryDecks,
  openDeck,
  chooseCard,
  DecksLogicError,
  StopReasonError,
} from '../api/remanga';
import {
  chooseBestCard,
  filterCardsForAccount,
  getCollectionCardIds,
  reasonText,
} from '../utils/logic';
import type { Card, RunConfig, ManualChoicePayload } from '../types';

export function useOpeningProcess() {
  const store = useAppStore();
  const stopRef = useRef(false);

  const run = useCallback(async (config: RunConfig) => {
    stopRef.current = false;
    store.setIsRunning(true);
    store.resetStop();

    const log = (text: string) => store.addLog(text);

    try {
      const priorityIds = getCollectionCardIds(config.collection);
      let ownedIds = await getOwnedIds(config.token, priorityIds);
      const missingCount = [...priorityIds].filter((id) => !ownedIds.has(id)).length;

      const collectionName =
        config.collection.name ?? config.collection.title ?? `id=${config.collection.id}`;
      log(`Выбрана коллекция: ${collectionName}`);
      log(`Карт в коллекции: ${priorityIds.size}`);
      log(`Отсутствует: ${missingCount}`);

      let openedTotal = 0;
      const targetCount = config.openCount;

      outer: while (targetCount === 0 || openedTotal < targetCount) {
        if (stopRef.current) {
          log('Остановлено пользователем.');
          break;
        }

        const inventoryIds = await getInventoryDecks(
          config.token,
          config.userId,
          config.targetDeckId
        );

        const remaining = targetCount === 0 ? 'все доступные' : String(targetCount - openedTotal);
        log('');
        log(
          `Найдено колод deck.id=${config.targetDeckId}: ${inventoryIds.length}. Нужно открыть: ${remaining}.`
        );

        if (!inventoryIds.length) {
          log('Нет подходящих неоткрытых колод.');
          break;
        }

        for (const inventoryId of inventoryIds) {
          if (stopRef.current) {
            log('Остановлено пользователем.');
            break outer;
          }
          if (targetCount !== 0 && openedTotal >= targetCount) break outer;

          log('');
          log(`Открываю колоду inventory_id=${inventoryId}`);

          const rawCards = await openDeck(config.token, inventoryId);

          if (!config.isPremium && rawCards.length > 3) {
            log('Премиум аккаунт: нет. 4-я карта не учитывается.');
          }

          const cards = filterCardsForAccount(rawCards, config.isPremium);

          log('Выпали карты:');
          cards.forEach((card: Card) => {
            const id = Number(card.id);
            const marks: string[] = [];
            if (priorityIds.has(id)) marks.push('ПРИОРИТЕТ');
            marks.push(ownedIds.has(id) ? 'УЖЕ ЕСТЬ' : 'НЕТ');
            log(`  ID ${id}, score=${card.score ?? '?'}, rank=${card.rank ?? '?'} [${marks.join(' | ')}]`);
          });

          let selectedId: number;

          try {
            const [selectedCard, reason] = chooseBestCard(
              cards,
              priorityIds,
              ownedIds,
              config.sameOrPriorityRule,
              config.allOwnedRule,
              config.noPriorityRule,
              config.priorityOwnedRule
            );
            selectedId = Number(selectedCard.id);
            log(`${reasonText(reason)} ID: ${selectedId}`);
          } catch (err) {
            if (err instanceof StopReasonError) {
              const reason = err.message;

              log('');
              log(`Остановка по правилу: ${reason}`);
              log('Открываю окно ручного выбора карты...');

              // Ask user to pick manually
              const manualId = await new Promise<number | null>((resolve) => {
                const payload: ManualChoicePayload = {
                  cards,
                  priorityIds,
                  ownedIds,
                  reason,
                  resolve,
                };
                store.setManualChoicePayload(payload);
              });

              store.setManualChoicePayload(null);

              if (manualId === null) {
                openedTotal++;
                log('Ручной выбор отменён. Колода засчитана.');
                log(`Открыто суммарно: ${openedTotal}.`);
                break outer;
              }

              selectedId = manualId;
              log(`Выбрана карта вручную. ID: ${selectedId}`);
            } else {
              throw err;
            }
          }

          await chooseCard(config.token, inventoryId, selectedId);
          ownedIds = new Set([...ownedIds, selectedId]);
          openedTotal++;
          log(`Карта ${selectedId} выбрана. Открыто суммарно: ${openedTotal}.`);
        }
      }

      log('');
      log(`Готово. Открыто колод: ${openedTotal}.`);
    } catch (err) {
      const msg = err instanceof DecksLogicError ? err.message : `Ошибка: ${String(err)}`;
      log('');
      log(`❌ ${msg}`);
    } finally {
      store.setIsRunning(false);
    }
  }, [store]);

  const stop = useCallback(() => {
    stopRef.current = true;
    store.requestStop();
  }, [store]);

  return { run, stop };
}
