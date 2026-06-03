import type { Card, Collection, DeckType } from '../types';
import { CapacitorHttp } from '@capacitor/core';

const API_BASE = 'https://api.remanga.org/api/v2';

export class DecksLogicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecksLogicError';
  }
}

export class StopReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StopReasonError';
  }
}

// ─── Headers ─────────────────────────────────────────────────────────────────

export function makeHeaders(token: string, withContentType = false): HeadersInit {
  const headers: Record<string, string> = {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9,ru;q=0.8',
    authorization: `Bearer ${token}`,
    origin: 'https://remanga.org',
    referer: 'https://remanga.org/',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'user-agent':
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  };
  if (withContentType) headers['content-type'] = 'application/json';
  return headers;
}

// ─── Request helper ───────────────────────────────────────────────────────────

async function requestOrThrow<T>(
  response: Awaited<ReturnType<typeof CapacitorHttp.get>>,
  action: string
): Promise<T> {
  if (response.status >= 400) {
    throw new DecksLogicError(
      `Ошибка: ${action}\nHTTP ${response.status}\n${JSON.stringify(response.data)}`
    );
  }

  if (response.data == null || response.data === '') {
    return null as T;
  }

  if (typeof response.data === 'string') {
    try {
      return JSON.parse(response.data) as T;
    } catch {
      throw new DecksLogicError(`Сервер вернул не JSON при: ${action}\n${response.data}`);
    }
  }

  return response.data as T;
}

// ─── Collections ─────────────────────────────────────────────────────────────

export async function getRareCollections(token: string, userId: number): Promise<Collection[]> {
  let page = 1;
  const collections: Collection[] = [];

  while (true) {
    const params = new URLSearchParams({ count: '20', page: String(page), ordering: '-percent' });
    const url = `${API_BASE}/inventory/${userId}/rare-collections/?${params}`;
    const response = await CapacitorHttp.get({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
    const data = await requestOrThrow<{ results: Collection[]; next?: string }>(
      response,
      `получение коллекций page=${page}`
    );
    collections.push(...(data?.results ?? []));
    if (!data?.next) break;
    page++;
  }

  return collections;
}

// ─── Card ownership ───────────────────────────────────────────────────────────

export async function getOwnedIds(token: string, ids: Set<number>): Promise<Set<number>> {
  if (!ids.size) return new Set();

  const owned = new Set<number>();
  const sortedIds = [...ids].sort((a, b) => a - b);

  for (let start = 0; start < sortedIds.length; start += 250) {
    const chunk = sortedIds.slice(start, start + 250);
    const params = new URLSearchParams();
    chunk.forEach((id) => params.append('card_id', String(id)));
    const url = `${API_BASE}/inventory/cards/has_cards/?${params}`;
    const response = await CapacitorHttp.get({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
    const data = await requestOrThrow<Array<{ card_id: number; stack_count: number }>>(
      response,
      'получение имеющихся карт'
    );
    (data ?? []).forEach((item) => {
      if (item.stack_count > 0) owned.add(item.card_id);
    });
  }

  return owned;
}

// ─── Decks ────────────────────────────────────────────────────────────────────

export async function getInventoryDecks(
  token: string,
  userId: number,
  targetDeckId: number
): Promise<number[]> {
  let page = 1;
  const inventoryIds: number[] = [];

  while (true) {
    const params = new URLSearchParams({ is_opened: 'false', user_id: String(userId), page: String(page) });
    const url = `${API_BASE}/inventory/decks/?${params}`;
    const response = await CapacitorHttp.get({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
    const data = await requestOrThrow<{ results: Array<{ id: number; deck?: { id: number } }>; next?: string }>(
      response,
      `получение доступных колод page=${page}`
    );
    for (const item of data?.results ?? []) {
      if (item.deck?.id === targetDeckId) inventoryIds.push(item.id);
    }
    if (!data?.next) break;
    page++;
  }

  return inventoryIds;
}

export async function getAvailableDeckTypes(token: string, userId: number): Promise<DeckType[]> {
  let page = 1;
  const grouped = new Map<number, DeckType>();

  while (true) {
    const params = new URLSearchParams({ is_opened: 'false', user_id: String(userId), page: String(page) });
    const url = `${API_BASE}/inventory/decks/?${params}`;
    const response = await CapacitorHttp.get({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
    const data = await requestOrThrow<{
      results: Array<{ id: number; deck?: { id: number; name?: string } }>;
      next?: string;
    }>(response, `получение типов колод page=${page}`);

    for (const item of data?.results ?? []) {
      const deck = item.deck;
      if (!deck?.id) continue;
      const deckId = deck.id;

      if (!grouped.has(deckId)) {
        grouped.set(deckId, {
          id: deckId,
          name: deck.name ?? `Колода id=${deckId}`,
          count: 0,
          inventory_ids: [],
          deck: deck as Record<string, unknown>,
        });
      }

      const entry = grouped.get(deckId)!;
      entry.count++;
      if (item.id) entry.inventory_ids.push(item.id);
    }

    if (!data?.next) break;
    page++;
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

// ─── Open / Choose ────────────────────────────────────────────────────────────

export async function openDeck(token: string, inventoryId: number): Promise<Card[]> {
  const url = `${API_BASE}/inventory/decks/${inventoryId}/open/`;
  const response = await CapacitorHttp.post({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
  return requestOrThrow<Card[]>(response, `открытие колоды inventory_id=${inventoryId}`);
}

export async function chooseCard(token: string, inventoryId: number, cardId: number): Promise<unknown> {
  const url = `${API_BASE}/inventory/decks/${inventoryId}/choose/`;
  const response = await CapacitorHttp.post({
      url,
      headers: makeHeaders(token, true) as Record<string, string>,
      data: { card_id: cardId },
    });
  return requestOrThrow(response, `выбор карты card_id=${cardId}`);
}
