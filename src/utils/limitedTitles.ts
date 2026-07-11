import raw from '../data/limitedTitles.csv?raw';

export interface LimitedTitle {
  branchId: number;
  name: string;
  dir: string;
}

/** Разбирает CSV вида `id_branch|name|dir` (строка-заголовок пропускается). */
function parse(text: string): LimitedTitle[] {
  const out: LimitedTitle[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('|');
    if (parts.length < 3) continue;
    const branchId = Number(parts[0].trim());
    if (!Number.isFinite(branchId)) continue; // заголовок id_branch|name|dir
    out.push({ branchId, name: parts[1].trim(), dir: parts[2].trim() });
  }
  return out;
}

export const LIMITED_TITLES: LimitedTitle[] = parse(raw);

/** Базовый поиск: подстрока без учёта регистра по имени и dir. */
export function searchLimitedTitles(query: string): LimitedTitle[] {
  const q = query.trim().toLowerCase();
  if (!q) return LIMITED_TITLES;
  return LIMITED_TITLES.filter(
    (t) => t.name.toLowerCase().includes(q) || t.dir.toLowerCase().includes(q)
  );
}
