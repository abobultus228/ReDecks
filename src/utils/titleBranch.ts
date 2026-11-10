export interface TitleBranchInfo {
  active_branch?: number | { id?: number } | null;
  branches?: Array<{ id?: number; count_chapters?: number }> | null;
}

function validId(value: unknown): number | null {
  const id = typeof value === 'object' && value !== null && 'id' in value ? value.id : value;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Новые ответы тайтла содержат branches вместо active_branch. */
export function resolveTitleBranchId(title: TitleBranchInfo): number | null {
  const active = validId(title.active_branch);
  if (active !== null) return active;
  const branches = Array.isArray(title.branches) ? title.branches : [];
  const withChapters = branches.find((branch) => validId(branch.id) !== null && (branch.count_chapters ?? 0) > 0);
  return validId((withChapters ?? branches.find((branch) => validId(branch.id) !== null))?.id);
}
