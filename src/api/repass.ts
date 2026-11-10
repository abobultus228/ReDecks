import { CapacitorHttp } from '@capacitor/core';
import { makeHeaders } from './remanga';
import {
  buildRepassVariants,
  extractRepassGroups,
  matchesRepassGroups,
  normalizeTag,
  type RepassTag,
  type RepassTaskGroup,
  type RepassTitle,
  type TagKind,
} from '../utils/repassLogic';

const API = 'https://remanga.org/api';
const PAGE_SIZE = 30;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(token: string, path: string, params?: URLSearchParams): Promise<T> {
  const url = `${API}${path}${params ? `?${params}` : ''}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await CapacitorHttp.get({ url, headers: makeHeaders(token) as Record<string, string>, connectTimeout: 20000, readTimeout: 20000 });
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep((attempt + 1) * 1000);
      continue;
    }
    if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
      await sleep((attempt + 1) * 1000);
      continue;
    }
    if (response.status === 401) throw new Error('Токен ReManga не принят (HTTP 401).');
    if (response.status === 403) throw new Error('ReManga запретила доступ (HTTP 403).');
    if (response.status >= 400) throw new Error(`Ошибка ReManga: HTTP ${response.status} при ${path}`);
    if (typeof response.data === 'string') {
      try { return JSON.parse(response.data) as T; }
      catch { throw new Error(`ReManga вернула не JSON при ${path}`); }
    }
    return response.data as T;
  }
  throw new Error(`Не удалось получить ${path}`);
}

export async function getActiveRepassGroups(token: string): Promise<RepassTaskGroup[]> {
  const payload = await getJson<unknown>(token, '/battlepass/tasks/');
  const groups = extractRepassGroups(payload);
  if (!groups.length) throw new Error('Сегодня нет активных заданий со списками жанров или категорий.');
  return groups;
}

async function getTagLookup(token: string, kind: TagKind): Promise<Map<string, number>> {
  const data = await getJson<RepassTag[]>(token, `/v2/titles/${kind}/`);
  if (!Array.isArray(data)) throw new Error(`Неожиданный формат справочника ${kind}.`);
  return new Map(data.filter((tag) => tag && typeof tag.name === 'string' && Number.isFinite(Number(tag.id)))
    .map((tag) => [normalizeTag(tag.name), Number(tag.id)]));
}

export interface MatchedRepassTitle { title: RepassTitle; matches: string[] }

/** Порт поиска из remanga_picker.py: OR в задании, AND между заданиями. */
export async function* findRepassTitles(
  token: string,
  groups: RepassTaskGroup[],
  onProgress?: (message: string) => void,
  shouldContinue?: () => boolean,
): AsyncGenerator<MatchedRepassTitle> {
  const kinds = new Set(groups.map((group) => group.kind));
  const lookups: Record<TagKind, Map<string, number>> = {
    genres: kinds.has('genres') ? await getTagLookup(token, 'genres') : new Map(),
    categories: kinds.has('categories') ? await getTagLookup(token, 'categories') : new Map(),
  };
  const variants = buildRepassVariants(groups, lookups);
  const yielded = new Set<number>();

  for (let variantIndex = 0; variantIndex < variants.length; variantIndex++) {
    const variant = variants[variantIndex];
    let page = 1;
    while (true) {
      if (shouldContinue && !shouldContinue()) return;
      onProgress?.(`Поиск тайтлов: вариант ${variantIndex + 1}/${variants.length}, страница ${page}…`);
      const params = new URLSearchParams({ page: String(page), count: String(PAGE_SIZE), ordering: '-score' });
      variant.genres.forEach((id) => params.append('genres', String(id)));
      variant.categories.forEach((id) => params.append('categories', String(id)));
      // API принимает значения отдельно; "genres,categories" даёт HTTP 400 invalid_choice.
      variant.unstrict.split(',').filter(Boolean).forEach((field) => params.append('unstrict_search_fields', field));
      const data = await getJson<{ results?: RepassTitle[]; next?: string | number | null }>(token, '/v2/search/catalog/', params);
      if (!Array.isArray(data?.results)) throw new Error('Неожиданный формат ответа каталога ReManga.');
      for (const title of data.results) {
        if (!title || title.is_forbidden || !Number.isInteger(Number(title.id)) || typeof title.dir !== 'string') continue;
        const matches = matchesRepassGroups(title, groups);
        const id = Number(title.id);
        if (!matches || yielded.has(id)) continue;
        yielded.add(id);
        yield { title, matches };
      }
      if (!data.next || !data.results.length) break;
      page = typeof data.next === 'number' ? data.next : page + 1;
    }
  }
}
