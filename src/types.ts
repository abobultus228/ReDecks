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
  priorityOwnedRule: 1 | 2 | 3;
  sameOrPriorityRule: 1 | 2;
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
  noPriorityRule: number;
  collectionId?: number | string | null;
  notificationsEnabled?: boolean;
  chatNotificationsEnabled?: boolean;
  exchangeNotificationsEnabled?: boolean;
  vibrationEnabled?: boolean;
  mutedRoomIds?: number[];
  onboardingDone?: boolean;
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
  | 'priority_new'            // 1 новая приоритетная — авто
  | 'priority_new_random'     // 2+ новых приоритетных — рандом (правило 2 = авто)
  | 'priority_owned_non_priority_new' // правило 1=2: взять неприоритетную новую
  | 'priority_owned_fallback' // правило 1=2: неприоритетных нет, берём owned приоритетную
  | 'priority_owned_force'    // правило 1=3: всё равно взять приоритетную
  | 'no_priority_new'         // правило 3=2: нет приоритетных, берём новую
  | 'no_priority_random';     // правило 3=2: нет ни приоритетных ни новых, рандом
