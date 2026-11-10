export type TagKind = 'genres' | 'categories';

export interface RepassTaskGroup {
  kind: TagKind;
  names: string[];
  description: string;
}

export interface RepassTag { id: number; name: string }

export interface RepassTitle {
  id: number;
  dir: string;
  main_name?: string;
  secondary_name?: string;
  is_forbidden?: boolean;
  genres?: RepassTag[];
  categories?: RepassTag[];
}

export interface RepassQueryVariant {
  genres: number[];
  categories: number[];
  unstrict: string;
}

const TAG_PATTERN = /(жанр|категори[яи])\s*:\s*([^.!?\n]+)/gi;

export function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
}

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return ({ nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[key] ?? '';
  });
}

function completed(record: Record<string, unknown>): boolean {
  if (['is_claimed', 'claimed', 'is_completed', 'completed', 'is_done', 'done'].some((key) => record[key] === true)) return true;
  if (record.is_active === false || record.active === false) return true;
  if (typeof record.status === 'string' && ['completed', 'claimed', 'done', 'выполнено'].includes(normalizeTag(record.status))) return true;
  for (const [currentKey, targetKey] of [
    ['current_progress', 'target_progress'], ['current_count', 'target_count'],
    ['progress', 'target'], ['progress', 'goal'],
  ]) {
    const current = record[currentKey];
    const target = record[targetKey];
    if (typeof current === 'number' && typeof target === 'number' && target > 0 && current >= target) return true;
  }
  return false;
}

/** Порт extract_groups из remanga_picker.py: только активные задания с жанрами/категориями. */
export function extractRepassGroups(payload: unknown): RepassTaskGroup[] {
  const groups: RepassTaskGroup[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown, inactive = false): void => {
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, inactive));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const blocked = inactive || completed(record);
    if (!blocked) {
      for (const key of ['description', 'text', 'task_description', 'condition']) {
        const value = record[key];
        if (typeof value !== 'string') continue;
        const plain = plainText(value);
        for (const match of plain.matchAll(TAG_PATTERN)) {
          const kind: TagKind = normalizeTag(match[1]) === 'жанр' ? 'genres' : 'categories';
          const names = match[2].split(/[,;]/).map((name) => name.trim().replace(/^[ .:;]+|[ .:;]+$/g, '')).filter(Boolean);
          const signature = `${kind}:${names.map(normalizeTag).join('|')}`;
          if (names.length && !seen.has(signature)) {
            seen.add(signature);
            groups.push({ kind, names, description: plain.trim() });
          }
        }
      }
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') walk(value, blocked);
    }
  };

  walk(payload);
  return groups;
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)];
}

function combinations(groups: number[][]): number[][] {
  if (!groups.length) return [[]];
  if (groups.length === 1) return [uniqueIds(groups[0])];
  let out: number[][] = [[]];
  for (const group of groups) {
    out = out.flatMap((prefix) => group.map((id) => [...prefix, id]));
  }
  return out.map(uniqueIds);
}

/** OR внутри одного задания, AND между заданиями — как query_variants в Python. */
export function buildRepassVariants(groups: RepassTaskGroup[], lookups: Record<TagKind, Map<string, number>>): RepassQueryVariant[] {
  const resolved = groups.map((group) => {
    const ids = uniqueIds(group.names.map((name) => lookups[group.kind].get(normalizeTag(name))).filter((id): id is number => id != null));
    if (!ids.length) throw new Error(`Не удалось найти метки задания: ${group.names.join(', ')}`);
    return { kind: group.kind, ids };
  });
  const genreGroups = resolved.filter((group) => group.kind === 'genres').map((group) => group.ids);
  const categoryGroups = resolved.filter((group) => group.kind === 'categories').map((group) => group.ids);
  const variants: RepassQueryVariant[] = [];
  const seen = new Set<string>();

  for (const genres of combinations(genreGroups)) {
    for (const categories of combinations(categoryGroups)) {
      const unstrict: string[] = [];
      if (genreGroups.length === 1 && genres.length > 1) unstrict.push('genres');
      if (categoryGroups.length === 1 && categories.length > 1) unstrict.push('categories');
      const key = `${genres.join(',')}/${categories.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ genres, categories, unstrict: unstrict.join(',') });
    }
  }
  return variants;
}

/** Проверяем каждое задание локально: серверный фильтр может быть нестрогим. */
export function matchesRepassGroups(title: RepassTitle, groups: RepassTaskGroup[]): string[] | null {
  const matched: string[] = [];
  for (const group of groups) {
    const actual = new Map((title[group.kind] ?? []).filter((tag) => typeof tag?.name === 'string').map((tag) => [normalizeTag(tag.name), tag.name]));
    const names = group.names.map((name) => actual.get(normalizeTag(name))).filter((name): name is string => Boolean(name));
    if (!names.length) return null;
    matched.push(names.join(', '));
  }
  return matched;
}
