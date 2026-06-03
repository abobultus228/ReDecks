// ─── API types ───────────────────────────────────────────────────────────────

export interface CardCover {
  mid?: string;
  high?: string;
}

export interface Card {
  id: number | string;
  score?: number;
  rank?: number;
  cover?: {
    mid?: string;
    high?: string;
  };
  name?: string;
}

export interface Collection {
  id: number | string;
  name?: string;
  title?: string;
  percent?: number;
  cards?: CollectionCard[];
}

export interface CollectionCard {
  id: number | string;
  has?: boolean;
}

export interface DeckType {
  id: number;
  name: string;
  count: number;
  inventory_ids: number[];
  deck?: Record<string, unknown>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface RunConfig {
  token: string;
  userId: number;
  collection: Collection;
  targetDeckId: number;
  openCount: number;
  priorityOwnedRule: 1 | 2;
  sameOrPriorityRule: 1 | 2;
  allOwnedRule: 1 | 2 | 3;
  noPriorityRule: 1 | 2;
  isPremium: boolean;
}

// ─── Settings (persisted) ────────────────────────────────────────────────────

export interface SavedSettings {
  token: string;
  userId: string;
  isPremium: boolean;
  deckId: string;
  openCount: number;
  priorityOwnedRule: number;
  sameOrPriorityRule: number;
  allOwnedRule: number;
  noPriorityRule: number;
  collectionId?: number | string | null;
}

// ─── Process ─────────────────────────────────────────────────────────────────

export interface OpenResult {
  openedTotal: number;
  stopReason?: string;
}

export type StopReason = string;

export interface ManualChoicePayload {
  cards: Card[];
  priorityIds: Set<number>;
  ownedIds: Set<number>;
  reason: string;
  resolve: (cardId: number | null) => void;
}

// ─── Logic helpers ───────────────────────────────────────────────────────────

export type SelectionReason =
  | 'priority_new'
  | 'no_priority_new_any'
  | 'new_any'
  | 'priority_duplicate'
  | 'duplicate_random'
  | 'priority_owned_non_priority_new'
  | 'priority_owned_duplicate';
