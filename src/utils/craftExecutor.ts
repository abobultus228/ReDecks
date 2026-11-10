import type { TitleCard, CraftInventoryGroup } from '../api/extra';
import { CRAFT_RANKS, cardRank } from './craftCalculator';

export type CraftTargetRank = 'E' | 'D' | 'C' | 'B';

interface CardState {
  id: number;
  rankIndex: number;
  total: number;
  eligible: number[];
}

interface Simulation {
  cards: CardState[];
  nextVirtualId: number;
}

export interface CraftStep {
  from: string;
  to: CraftTargetRank;
  instanceIds: [number, number];
  /** Сколько уникальных карт источника временно теряется и подлежит восстановлению. */
  restoreCount: number;
  /** Число операций всей цепочки, включая обязательное восстановление. */
  totalSteps: number;
}

function clone(state: Simulation): Simulation {
  return { nextVirtualId: state.nextVirtualId, cards: state.cards.map((card) => ({ ...card, eligible: [...card.eligible] })) };
}

function hasMissing(state: Simulation, rankIndex: number): boolean {
  return state.cards.some((card) => card.rankIndex === rankIndex && card.total === 0);
}

function choosePair(state: Simulation, sourceIndex: number): [number, number] | null {
  const safe: number[] = [];
  const last: number[] = [];
  for (const card of state.cards) {
    if (card.rankIndex !== sourceIndex) continue;
    // Даже если часть копий защищена, можно тратить только явные eligible ID.
    const safeCount = Math.min(card.eligible.length, Math.max(0, card.total - 1));
    safe.push(...card.eligible.slice(0, safeCount));
    last.push(...card.eligible.slice(safeCount));
  }
  if (safe.length >= 2) return [safe[0], safe[1]];
  if (sourceIndex === 0) return null; // Последние F никогда не тратим.
  if (safe.length === 1 && last.length) return [safe[0], last[0]];
  if (last.length >= 2) return [last[0], last[1]];
  return null;
}

/** Виртуально выполняет один крафт и все необходимые восстановления снизу. */
function virtualCraft(state: Simulation, targetIndex: number): { state: Simulation; pair: [number, number]; lost: number; totalSteps: number } | null {
  if (targetIndex < 1 || !hasMissing(state, targetIndex)) return null;
  const sourceIndex = targetIndex - 1;
  const pair = choosePair(state, sourceIndex);
  if (!pair) return null;
  let next = clone(state);
  let lost = 0;
  for (const id of pair) {
    const card = next.cards.find((item) => item.rankIndex === sourceIndex && item.eligible.includes(id));
    if (!card || card.total <= 0) return null;
    card.eligible.splice(card.eligible.indexOf(id), 1);
    card.total--;
    if (card.total === 0) lost++;
  }
  const output = next.cards.find((card) => card.rankIndex === targetIndex && card.total === 0);
  if (!output) return null;
  output.total = 1;
  output.eligible.push(next.nextVirtualId--);

  let totalSteps = 1;
  for (let i = 0; i < lost; i++) {
    const repaired = virtualCraft(next, sourceIndex);
    if (!repaired) return null;
    next = repaired.state;
    totalSteps += repaired.totalSteps;
  }
  return { state: next, pair, lost, totalSteps };
}

/**
 * Следующее безопасное действие. Ранги закрываются по порядку E→D→C→B;
 * виртуальная проверка не допускает потери уникальных карт без ресурса на ремонт.
 */
export function planNextCraft(
  catalog: TitleCard[],
  ownedCounts: Map<number, number>,
  inventory: CraftInventoryGroup[],
  maxRank: CraftTargetRank,
): CraftStep | null {
  const maxIndex = CRAFT_RANKS.indexOf(maxRank);
  if (maxIndex < 1) throw new Error('Недопустимый максимальный ранг крафта.');
  const uniqueCatalog = [...new Map(catalog.map((card) => [card.id, card])).values()];
  const known = new Map(uniqueCatalog.map((card) => [card.id, card]));
  const eligible = new Map<number, number[]>();
  const seenInstances = new Set<number>();
  for (const group of inventory) {
    const catalogCard = known.get(group.cardId);
    if (!catalogCard || cardRank(catalogCard.rank) !== cardRank(group.rank)) {
      throw new Error(`Инвентарь и каталог расходятся по карте ${group.cardId}.`);
    }
    const ids: number[] = [];
    for (const id of group.instanceIds) {
      if (!Number.isInteger(id) || id <= 0 || seenInstances.has(id)) throw new Error('Некорректный или повторяющийся ID экземпляра карты.');
      seenInstances.add(id);
      ids.push(id);
    }
    eligible.set(group.cardId, ids);
  }
  const state: Simulation = {
    nextVirtualId: -1,
    cards: uniqueCatalog.map((card) => {
      const rankIndex = CRAFT_RANKS.indexOf(cardRank(card.rank) as typeof CRAFT_RANKS[number]);
      const total = Math.max(0, Math.floor(Number(ownedCounts.get(card.id) ?? 0)));
      const available = eligible.get(card.id) ?? [];
      if (available.length > total) throw new Error(`Инвентарь и количество карты ${card.id} расходятся.`);
      return { id: card.id, rankIndex, total, eligible: available };
    }),
  };

  for (let targetIndex = 1; targetIndex <= maxIndex; targetIndex++) {
    if (!hasMissing(state, targetIndex)) continue;
    const simulation = virtualCraft(state, targetIndex);
    if (!simulation) return null; // Следующий ранг нельзя пропускать.
    return {
      from: CRAFT_RANKS[targetIndex - 1],
      to: CRAFT_RANKS[targetIndex] as CraftTargetRank,
      instanceIds: simulation.pair,
      restoreCount: simulation.lost,
      totalSteps: simulation.totalSteps,
    };
  }
  return null;
}

/** Все ранги E..rank восстановлены (F не крафтится и не расходуется до нуля). */
export function ranksCompleteThrough(catalog: TitleCard[], counts: Map<number, number>, rank: CraftTargetRank): boolean {
  const maxIndex = CRAFT_RANKS.indexOf(rank);
  return catalog.every((card) => {
    const index = CRAFT_RANKS.indexOf(cardRank(card.rank) as typeof CRAFT_RANKS[number]);
    return index < 1 || index > maxIndex || (counts.get(card.id) ?? 0) > 0;
  });
}
