import { StopReasonError } from '../api/remanga';
import type { Card, SelectionReason } from '../types';

function cardId(card: Card): number {
  return Number(card.id);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Порядок приоритетов:
 * 1. Ровно 1 новая приоритетная → авто (вне зависимости от настроек)
 * 2. 2+ новых приоритетных → правило 2 (sameOrPriorityRule)
 * 3. Все приоритетные уже в наличии (0 новых, 1+ owned) → правило 1 (priorityOwnedRule)
 * 4. Нет приоритетных вообще → правило 3 (noPriorityRule)
 */
export function chooseBestCard(
  openedCards: Card[],
  priorityIds: Set<number>,
  ownedIds: Set<number>,
  sameOrPriorityRule: 1 | 2,
  noPriorityRule: 1 | 2,
  priorityOwnedRule: 1 | 2 | 3,
): [Card, SelectionReason] {
  const priorityCards = openedCards.filter((c) => priorityIds.has(cardId(c)));
  const priorityNew   = priorityCards.filter((c) => !ownedIds.has(cardId(c)));
  const priorityOwned = priorityCards.filter((c) =>  ownedIds.has(cardId(c)));
  const nonPriorityNew = openedCards.filter(
    (c) => !priorityIds.has(cardId(c)) && !ownedIds.has(cardId(c))
  );

  // ── Шаг 1: ровно 1 новая приоритетная → всегда авто ──────────────────────
  if (priorityNew.length === 1) {
    return [priorityNew[0], 'priority_new'];
  }

  // ── Шаг 2: 2+ новых приоритетных → правило 2 ──────────────────────────────
  if (priorityNew.length >= 2) {
    if (sameOrPriorityRule === 1) {
      const ids = priorityNew.map((c) => cardId(c)).join(', ');
      throw new StopReasonError(`выпало несколько отсутствующих приоритетных карт: ${ids}`);
    }
    // sameOrPriorityRule === 2: рандом среди новых приоритетных
    return [randomChoice(priorityNew), 'priority_new_random'];
  }

  // Дальше priorityNew.length === 0

  // ── Шаг 3: есть приоритетные, но все уже в наличии → правило 1 ───────────
  if (priorityOwned.length > 0) {
    // Правило 1 = стоп
    if (priorityOwnedRule === 1) {
      const ids = priorityOwned.map((c) => cardId(c)).join(', ');
      throw new StopReasonError(`приоритетные карты выпали, но уже есть в наличии: ${ids}`);
    }

    // Правило 1 = взять неприоритетную новую, иначе приоритетную (owned)
    if (priorityOwnedRule === 2) {
      if (nonPriorityNew.length > 0) {
        return [randomChoice(nonPriorityNew), 'priority_owned_non_priority_new'];
      }
      // Нет неприоритетных новых → берём owned приоритетную
      // Но сначала проверяем правило 2 (если owned приоритетных 2+)
      if (priorityOwned.length >= 2) {
        if (sameOrPriorityRule === 1) {
          const ids = priorityOwned.map((c) => cardId(c)).join(', ');
          throw new StopReasonError(`нет новых карт; выпало несколько приоритетных, которые уже есть: ${ids}`);
        }
        return [randomChoice(priorityOwned), 'priority_owned_fallback'];
      }
      return [priorityOwned[0], 'priority_owned_fallback'];
    }

    // Правило 1 = всё равно взять приоритетную (owned)
    if (priorityOwnedRule === 3) {
      // Если owned приоритетных 2+ → правило 2
      if (priorityOwned.length >= 2) {
        if (sameOrPriorityRule === 1) {
          const ids = priorityOwned.map((c) => cardId(c)).join(', ');
          throw new StopReasonError(`нет новых приоритетных; выпало несколько приоритетных, которые уже есть: ${ids}`);
        }
        return [randomChoice(priorityOwned), 'priority_owned_force'];
      }
      return [priorityOwned[0], 'priority_owned_force'];
    }
  }

  // ── Шаг 4: нет приоритетных вообще → правило 3 ───────────────────────────
  if (noPriorityRule === 1) {
    throw new StopReasonError('среди выпавших карт нет ни одной приоритетной');
  }
  // noPriorityRule === 2: взять новую неприоритетную, иначе рандом
  if (nonPriorityNew.length > 0) {
    return [randomChoice(nonPriorityNew), 'no_priority_new'];
  }
  return [randomChoice(openedCards), 'no_priority_random'];
}

export function reasonText(reason: SelectionReason): string {
  const map: Record<SelectionReason, string> = {
    priority_new:
      'Выбираю единственную новую приоритетную карту.',
    priority_new_random:
      'Выпало несколько новых приоритетных. Выбираю случайную из них.',
    priority_owned_non_priority_new:
      'Приоритетные выпали, но уже есть. Выбираю новую неприоритетную карту.',
    priority_owned_fallback:
      'Приоритетные выпали, но уже есть; новых неприоритетных нет. Выбираю приоритетную повторку.',
    priority_owned_force:
      'Приоритетные выпали, но уже есть. Всё равно выбираю приоритетную карту.',
    no_priority_new:
      'Приоритетных нет. Выбираю новую неприоритетную карту.',
    no_priority_random:
      'Приоритетных и новых нет. Выбираю случайную карту из выпавших.',
  };
  return map[reason] ?? 'Выбираю карту.';
}

export function filterCardsForAccount(cards: Card[], isPremium: boolean): Card[] {
  if (isPremium) return cards;
  return cards.slice(0, 3);
}

export function getCollectionCardIds(collection: { cards?: Array<{ id: number | string }> }): Set<number> {
  return new Set((collection.cards ?? []).map((c) => Number(c.id)));
}
