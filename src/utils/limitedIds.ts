import raw from '../data/limited_id.csv?raw';

export interface LimitedIdTitle {
  /** id тайтла (для /inventory/{id}/cards/, как в «Карты тайтла»). */
  id: number;
  name: string;
  dir: string;
}

/**
 * Разбирает CSV вида `id|name|dir` (разделитель — `|`, `;` или табуляция).
 * Строка-заголовок (`id|name|dir`) пропускается, т.к. её id не число.
 * dir может быть пустым.
 */
function parse(text: string): LimitedIdTitle[] {
  const out: LimitedIdTitle[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[|;\t]/);
    if (parts.length < 2) continue;
    const id = Number(parts[0].trim());
    if (!Number.isFinite(id)) continue; // заголовок id|name|dir
    out.push({
      id,
      name: (parts[1] ?? '').trim(),
      dir: (parts[2] ?? '').trim(),
    });
  }
  return out;
}

export const LIMITED_ID_TITLES: LimitedIdTitle[] = parse(raw);

/** Базовый поиск: подстрока без учёта регистра по имени и dir. */
export function searchLimitedIdTitles(query: string): LimitedIdTitle[] {
  const q = query.trim().toLowerCase();
  if (!q) return LIMITED_ID_TITLES;
  return LIMITED_ID_TITLES.filter(
    (t) => t.name.toLowerCase().includes(q) || t.dir.toLowerCase().includes(q)
  );
}
