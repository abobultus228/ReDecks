import type { TitleCard } from '../api/extra';

export const CRAFT_RANKS = ['F', 'E', 'D', 'C', 'B'] as const;
const DISPLAY_RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'] as const;

export interface CraftRankSummary {
  rank: string;
  total: number;
  current: number;
  projected: number;
  crafts: number;
}

export interface CraftProjection {
  totalCards: number;
  currentOwned: number;
  physicalOwned: number;
  projectedOwned: number;
  projectedCopies: number;
  ranks: CraftRankSummary[];
  ownedCards: { card: TitleCard; count: number }[];
  missingCards: TitleCard[];
  missingF: number;
  /** Дополнительные расходные F-карты для завершения E–B, сверх недостающих уникальных F. */
  extraFNeeded: number | null;
  blockedAt: string | null;
  completeThroughB: boolean;
  surplusFEquivalent: number;
}

interface State {
  catalog: number[];
  unique: number[];
  copies: number[];
  crafts: number[];
}

function clone(state: State): State {
  return {
    catalog: state.catalog,
    unique: [...state.unique],
    copies: [...state.copies],
    crafts: [...state.crafts],
  };
}

export function cardRank(raw: string | undefined): string {
  const match = /^(?:rank_)?([fedcbas])$/i.exec(raw ?? '');
  return match ? match[1].toUpperCase() : (raw || 'Неизвестный');
}

/**
 * Создаёт одну новую, гарантированно отсутствующую карту ранга target.
 * Дубли расходуются первыми. Последние F неприкосновенны; потерянные
 * уникальные карты других рангов немедленно восстанавливаются снизу.
 * Вызывающий откатывает всю операцию, если любой шаг восстановления не удался.
 */
function craftOne(state: State, target: number): boolean {
  if (target < 1 || target >= CRAFT_RANKS.length || state.unique[target] >= state.catalog[target]) return false;
  const source = target - 1;
  if (state.copies[source] < 2) return false;

  const spare = state.copies[source] - state.unique[source];
  const lostUnique = Math.max(0, 2 - spare);
  if (source === 0 && lostUnique > 0) return false;

  state.copies[source] -= 2;
  state.unique[source] -= lostUnique;
  state.copies[target] += 1;
  state.unique[target] += 1;
  state.crafts[target] += 1;

  for (let i = 0; i < lostUnique; i++) {
    if (!craftOne(state, source)) return false;
  }
  return true;
}

function simulate(base: State, extraF: number): { state: State; blockedAt: string | null } {
  let state = clone(base);
  state.copies[0] += extraF;

  // Сначала закрываем E, затем D, C и B. В неполном ранге останавливаемся.
  for (let target = 1; target < CRAFT_RANKS.length; target++) {
    while (state.unique[target] < state.catalog[target]) {
      const trial = clone(state);
      if (!craftOne(trial, target)) {
        return { state, blockedAt: CRAFT_RANKS[target] };
      }
      state = trial;
    }
  }
  return { state, blockedAt: null };
}

function requiredExtraF(base: State, cardCount: number): number | null {
  if (simulate(base, 0).blockedAt === null) return 0;
  if (base.catalog[0] === 0) return null;

  // Для пяти рангов на одну недостающую карту требуется не более 16 F;
  // запас 64 × число карт также покрывает восстановление промежуточных рангов.
  const limit = Math.max(64, cardCount * 64);
  let high = 1;
  while (high < limit && simulate(base, high).blockedAt !== null) high = Math.min(high * 2, limit);
  if (simulate(base, high).blockedAt !== null) return null;

  let low = 0;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (simulate(base, mid).blockedAt === null) high = mid;
    else low = mid;
  }
  return high;
}

export function calculateCrafts(cards: TitleCard[], stacks: Map<number, number>): CraftProjection {
  const uniqueCards = [...new Map(cards.map((card) => [card.id, card])).values()];
  const base: State = {
    catalog: CRAFT_RANKS.map(() => 0),
    unique: CRAFT_RANKS.map(() => 0),
    copies: CRAFT_RANKS.map(() => 0),
    crafts: CRAFT_RANKS.map(() => 0),
  };
  const totals = new Map<string, number>();
  const current = new Map<string, number>();
  const ownedCards: { card: TitleCard; count: number }[] = [];
  const missingCards: TitleCard[] = [];
  let physicalOwned = 0;
  let otherPhysical = 0;

  for (const card of uniqueCards) {
    const rank = cardRank(card.rank);
    const count = Math.max(0, Math.floor(Number(stacks.get(card.id) ?? 0) || 0));
    physicalOwned += count;
    totals.set(rank, (totals.get(rank) ?? 0) + 1);
    if (count > 0) {
      current.set(rank, (current.get(rank) ?? 0) + 1);
      ownedCards.push({ card, count });
    }
    else missingCards.push(card);

    const index = CRAFT_RANKS.indexOf(rank as typeof CRAFT_RANKS[number]);
    if (index !== -1) {
      base.catalog[index] += 1;
      base.unique[index] += Number(count > 0);
      base.copies[index] += count;
    } else otherPhysical += count;
  }

  const { state, blockedAt } = simulate(base, 0);
  const ranks = [...DISPLAY_RANKS, ...[...totals.keys()].filter((r) => !DISPLAY_RANKS.includes(r as typeof DISPLAY_RANKS[number])).sort()]
    .filter((rank) => (totals.get(rank) ?? 0) > 0)
    .map((rank): CraftRankSummary => {
      const index = CRAFT_RANKS.indexOf(rank as typeof CRAFT_RANKS[number]);
      return {
        rank,
        total: totals.get(rank) ?? 0,
        current: current.get(rank) ?? 0,
        projected: index === -1 ? (current.get(rank) ?? 0) : state.unique[index],
        crafts: index === -1 ? 0 : state.crafts[index],
      };
    });

  const completeThroughB = CRAFT_RANKS.every((_, i) => state.unique[i] === state.catalog[i]);
  const surplusFEquivalent = completeThroughB
    ? CRAFT_RANKS.reduce((sum, _, i) => sum + (state.copies[i] - state.unique[i]) * 2 ** i, 0)
    : 0;

  return {
    totalCards: uniqueCards.length,
    currentOwned: [...current.values()].reduce((sum, n) => sum + n, 0),
    physicalOwned,
    projectedOwned: ranks.reduce((sum, r) => sum + r.projected, 0),
    projectedCopies: state.copies.reduce((sum, n) => sum + n, 0) + otherPhysical,
    ranks,
    ownedCards,
    missingCards,
    missingF: base.catalog[0] - base.unique[0],
    extraFNeeded: requiredExtraF(base, uniqueCards.length),
    blockedAt,
    completeThroughB,
    surplusFEquivalent,
  };
}
