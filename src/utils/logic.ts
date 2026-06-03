import { StopReasonError } from '../api/remanga';
import type { Card, SelectionReason } from '../types';

function cardId(card: Card): number {
  return Number(card.id);
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function chooseBestCard(
  openedCards: Card[],
  priorityIds: Set<number>,
  ownedIds: Set<number>,
  sameOrPriorityRule: 1 | 2,
  allOwnedRule: 1 | 2 | 3,
  noPriorityRule: 1 | 2,
  priorityOwnedRule: 1 | 2
): [Card, SelectionReason] {
  const priorityCards = openedCards.filter((c) => priorityIds.has(cardId(c)));
  const priorityNew = priorityCards.filter((c) => !ownedIds.has(cardId(c)));
  const priorityOwned = priorityCards.filter((c) => ownedIds.has(cardId(c)));
  const newAny = openedCards.filter((c) => !ownedIds.has(cardId(c)));
  const nonPriorityNew = openedCards.filter(
    (c) => !priorityIds.has(cardId(c)) && !ownedIds.has(cardId(c))
  );

  // Есть приоритетные новые карты
  if (priorityNew.length > 0) {
    if (priorityNew.length > 1 && sameOrPriorityRule === 1) {
      const ids = priorityNew.map((c) => cardId(c)).join(', ');
      throw new StopReasonError(`выпало несколько отсутствующих приоритетных карт: ${ids}`);
    }
    return [randomChoice(priorityNew), 'priority_new'];
  }

  // Приоритетные есть, но все уже в наличии
  if (priorityCards.length > 0 && priorityNew.length === 0) {
    if (priorityOwnedRule === 1 && nonPriorityNew.length > 0) {
      return [randomChoice(nonPriorityNew), 'priority_owned_non_priority_new'];
    }
    if (priorityOwnedRule === 2) {
      if (priorityOwned.length > 1 && sameOrPriorityRule === 1) {
        const ids = priorityOwned.map((c) => cardId(c)).join(', ');
        throw new StopReasonError(`выпало несколько уже имеющихся приоритетных карт: ${ids}`);
      }
      return [randomChoice(priorityOwned), 'priority_owned_duplicate'];
    }
  }

  // Нет приоритетных карт вообще
  if (priorityCards.length === 0) {
    if (noPriorityRule === 1) {
      throw new StopReasonError('среди выпавших карт нет ни одной приоритетной');
    }
    if (newAny.length > 0) {
      return [randomChoice(newAny), 'no_priority_new_any'];
    }
  }

  // Есть новые карты (не приоритетные)
  if (newAny.length > 0) {
    return [randomChoice(newAny), 'new_any'];
  }

  // Все карты уже есть
  if (allOwnedRule === 1) {
    throw new StopReasonError('все выпавшие карты уже имеются');
  }
  if (allOwnedRule === 2 && priorityCards.length > 0) {
    if (priorityCards.length > 1 && sameOrPriorityRule === 1) {
      const ids = priorityCards.map((c) => cardId(c)).join(', ');
      throw new StopReasonError(`выпало несколько уже имеющихся приоритетных карт: ${ids}`);
    }
    return [randomChoice(priorityCards), 'priority_duplicate'];
  }

  return [randomChoice(openedCards), 'duplicate_random'];
}

export function reasonText(reason: SelectionReason): string {
  const map: Record<SelectionReason, string> = {
    priority_new: 'Выбираю случайную отсутствующую карту из приоритетных.',
    no_priority_new_any: 'Приоритетных карт нет. Выбираю случайную карту, которой ещё нет.',
    new_any: 'Приоритетных отсутствующих нет. Выбираю случайную отсутствующую карту из выпавших.',
    priority_duplicate: 'Все карты уже есть. Выбираю повторку из приоритетных.',
    duplicate_random: 'Все карты уже есть. Выбираю случайную повторку.',
    priority_owned_non_priority_new: 'Приоритетные выпали, но уже есть. Выбираю неприоритетную новую карту.',
    priority_owned_duplicate: 'Приоритетные выпали, но уже есть. Всё равно выбираю приоритетную повторку.',
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
