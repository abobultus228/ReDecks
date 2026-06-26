import { CapacitorHttp } from '@capacitor/core';
import { makeHeaders } from './remanga';

const API_V2 = 'https://api.remanga.org/api/v2';
const VIEWS_URL = 'https://api.remanga.org/api/activity/views/';

export const MANGA_URL = (slug: string) => `https://remanga.org/manga/${slug}`;
export const CHARACTER_URL = (id: number | string) => `https://remanga.org/character/${id}`;

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface TitleSearchResult {
  dir: string;
  main_name?: string;
  secondary_name?: string;
  issue_year?: string | number;
  type?: { name?: string };
  translate_status?: { name?: string };
}

export interface RemangaCharacter {
  id: number;
  name?: string;
}

export interface TitleContent {
  id: number;
  active_branch?: number;
  characters?: RemangaCharacter[];
}

export interface ViewedChapter {
  id: number;
  tome?: number | string;
  chapter?: number | string;
  name?: string;
}

export class ExtraApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtraApiError';
  }
}

/** Ошибка 429 — превышен лимит запросов. Выделена отдельно, чтобы вызывающий
 *  код мог сделать паузу и повторить запрос. */
export class RateLimitError extends ExtraApiError {
  constructor(message = 'Ошибка 429: слишком много запросов.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

// ─── Общий разбор ответа ─────────────────────────────────────────────────────

function parse<T>(response: { status: number; data: unknown }, action: string): T {
  if (response.status === 401) {
    throw new ExtraApiError('Ошибка 401: токен недействителен или истёк.');
  }
  if (response.status === 429) {
    throw new RateLimitError();
  }
  if (response.status >= 400) {
    throw new ExtraApiError(`Ошибка (${action}): HTTP ${response.status}`);
  }
  let data = response.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      throw new ExtraApiError(`Сервер вернул не JSON при: ${action}`);
    }
  }
  return data as T;
}

async function get<T>(token: string, url: string, action: string): Promise<T> {
  let response;
  try {
    response = await CapacitorHttp.get({
      url,
      headers: makeHeaders(token) as Record<string, string>,
    });
  } catch (e) {
    // На некоторых платформах CapacitorHttp бросает исключение вместо
    // возврата статуса — ловим 429 и здесь.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('429')) throw new RateLimitError();
    throw e;
  }
  return parse<T>(response, action);
}

// ─── slug из ссылки ──────────────────────────────────────────────────────────

export function extractSlugFromUrl(url: string): string {
  const parts = url.replace(/\/+$/, '').split('/');
  const idx = parts.indexOf('manga');
  if (idx === -1 || idx + 1 >= parts.length) {
    throw new ExtraApiError(`Не удалось извлечь slug из ссылки: ${url}`);
  }
  return parts[idx + 1];
}

// ─── Поиск тайтлов ───────────────────────────────────────────────────────────

export async function searchTitles(token: string, query: string): Promise<TitleSearchResult[]> {
  const params = new URLSearchParams({
    count: '10',
    field: 'titles',
    page: '1',
    query,
  });
  const data = await get<{ results?: TitleSearchResult[] }>(
    token,
    `${API_V2}/search/?${params}`,
    'поиск тайтлов'
  );
  return data?.results ?? [];
}

// ─── Данные тайтла ───────────────────────────────────────────────────────────

export async function getTitleContent(token: string, slug: string): Promise<TitleContent> {
  const data = await get<{ content?: TitleContent } & Partial<TitleContent>>(
    token,
    `${API_V2}/titles/${slug}/`,
    'получение тайтла'
  );
  const content = (data?.content ?? data) as TitleContent;
  if (content?.id == null) {
    throw new ExtraApiError("В ответе нет поля 'id' тайтла.");
  }
  return content;
}

// ─── Главы (glavy) ───────────────────────────────────────────────────────────

export async function collectViewedChapters(
  token: string,
  branchId: number,
  onProgress?: (page: number, found: number) => void
): Promise<ViewedChapter[]> {
  const viewed: ViewedChapter[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      branch_id: String(branchId),
      chapter: '',
      ordering: 'index',
      page: String(page),
      user_data: '1',
    });
    const data = await get<{ results?: any[]; next?: number | string | null }>(
      token,
      `${API_V2}/titles/chapters/?${params}`,
      `получение глав page=${page}`
    );

    for (const ch of data?.results ?? []) {
      if (ch?.viewed === true) {
        viewed.push({
          id: ch.id,
          tome: ch.tome,
          chapter: ch.chapter,
          name: ch.name || '',
        });
      }
    }

    onProgress?.(page, viewed.length);

    const next = data?.next;
    if (!next || !(data?.results?.length)) break;
    page = typeof next === 'number' ? next : page + 1;
  }

  return viewed;
}

export async function markChaptersUnread(token: string, chapterIds: number[]): Promise<void> {
  if (!chapterIds.length) return;
  const response = await CapacitorHttp.delete({
    url: VIEWS_URL,
    headers: makeHeaders(token, true) as Record<string, string>,
    data: { chapter_ids: chapterIds },
  });
  if (response.status >= 400) {
    throw new ExtraApiError(`Не удалось сбросить главы: HTTP ${response.status}`);
  }
}

// ─── Персонажи и карты (spisok) ──────────────────────────────────────────────

export async function getCharacters(token: string, content: TitleContent): Promise<RemangaCharacter[]> {
  if (content.characters && content.characters.length) {
    return content.characters;
  }
  const data = await get<RemangaCharacter[] | { results?: RemangaCharacter[] }>(
    token,
    `${API_V2}/titles/${content.id}/characters/`,
    'получение персонажей'
  );
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

export async function getCardsTotal(token: string, characterId: number): Promise<number> {
  const params = new URLSearchParams({ character_id: String(characterId) });
  const data = await get<{ total?: number }>(
    token,
    `${API_V2}/inventory/cards/album/?${params}`,
    'получение карт персонажа'
  );
  return Number(data?.total ?? 0);
}

// ─── Чат ─────────────────────────────────────────────────────────────────────

export interface ChatRoom {
  id: number;
  type: string;
  name: string;
  last_read_dt: string | null;
  last_update_dt: string | null;
  cover?: { url?: string }[];
}

export interface ChatMessage {
  uuid: string;
  type: string;
  room_id: number;
  author_id: number | null;
  data: { text?: string; attachment?: unknown; id?: number; username?: string };
  created_at: string;
  is_deleted: boolean;
  localUuid?: string; // для сшивки оптимистичного сообщения с эхом сервера
  pending?: boolean;  // ещё не подтверждено сервером
}

export interface ChatAvatar {
  low?: string | null;
  mid?: string | null;
  high?: string | null;
}

export interface ChatMember {
  id: number;
  username?: string;
  avatar?: ChatAvatar;
}

export interface ChatUser {
  id: number;
  username: string;
  avatarUrl: string;
}

/** Выбирает url аватара: сначала low, потом mid, потом high. */
export function pickAvatarUrl(av?: ChatAvatar): string {
  if (!av) return '';
  return resolveMediaUrl(av.low || av.mid || av.high || '');
}

/** Приводит относительный путь медиа remanga к абсолютному URL. */
export function resolveMediaUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `https://remanga.org${url}`;
  return `https://remanga.org/media/${url}`;
}

/** true, если в комнате есть непрочитанные сообщения. */
export function roomHasUnread(room: ChatRoom): boolean {
  if (!room.last_update_dt) return false;
  if (!room.last_read_dt) return true;
  return room.last_update_dt > room.last_read_dt;
}

export async function getChatRooms(token: string, name = ''): Promise<ChatRoom[]> {
  const params = new URLSearchParams({ name });
  const data = await get<ChatRoom[] | { results?: ChatRoom[] }>(
    token,
    `${API_V2}/chat/rooms/?${params}`,
    'список чатов'
  );
  return Array.isArray(data) ? data : (data?.results ?? []);
}

/**
 * Сообщения комнаты, новейшие первыми (как отдаёт API).
 * Для подгрузки истории передай created_at самого старого сообщения в beforeCreatedAt.
 */
export async function getChatMessages(
  token: string,
  roomId: number,
  beforeCreatedAt?: string
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: '50', room_id: String(roomId) });
  if (beforeCreatedAt) params.set('created_at__lt', beforeCreatedAt);
  const data = await get<{ results?: ChatMessage[] }>(
    token,
    `${API_V2}/chat/messages/?${params}`,
    'сообщения чата'
  );
  return data?.results ?? [];
}

/** Участники комнаты (с аватарами) — берём из детального ответа по комнате. */
export async function getRoomMembers(token: string, roomId: number): Promise<ChatMember[]> {
  const data = await get<{ members?: ChatMember[] }>(
    token,
    `${API_V2}/chat/rooms/${roomId}/`,
    'участники чата'
  );
  return data?.members ?? [];
}

/** Профиль пользователя (имя + аватар). Парсим защитно — структура может отличаться. */
export async function getUserProfile(token: string, userId: number): Promise<ChatUser> {
  const data = await get<any>(token, `${API_V2}/users/${userId}/`, 'профиль пользователя');
  const c = (data?.content ?? data) ?? {};
  const username = c.username ?? c.name ?? '';
  const av = c.avatar;
  let avatarUrl = '';
  if (typeof av === 'string') avatarUrl = resolveMediaUrl(av);
  else if (av && typeof av === 'object') avatarUrl = resolveMediaUrl(av.url ?? av.mid ?? av.high ?? '');
  return { id: userId, username, avatarUrl };
}

// ─── WebSocket чата ──────────────────────────────────────────────────────────

export const CHAT_WS_URL = (token: string) =>
  `wss://chat.remanga.org/ws/?token=${encodeURIComponent(token)}`;

export interface ChatWsEvent {
  room_id: number;
  discriminator?: string;
  uuid: string;
  local_uuid?: string | null;
  text?: string;
  user_id: number;
  created_at: string;
}

/** Приводит входящее WS-событие к виду ChatMessage, как из REST. */
export function wsEventToMessage(ev: ChatWsEvent): ChatMessage {
  return {
    uuid: ev.uuid,
    type: 'message',
    room_id: ev.room_id,
    author_id: ev.user_id,
    data: { text: ev.text ?? '', attachment: null },
    created_at: ev.created_at,
    is_deleted: false,
    localUuid: ev.local_uuid ?? undefined,
  };
}
