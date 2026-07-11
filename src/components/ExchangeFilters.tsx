import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { isVideoUrl } from './CardGallery';
import {
  getCardRanks,
  searchCharacters,
  searchTitles,
  resolveMediaUrl,
  type InventoryFilters,
  type CardRank,
} from '../api/extra';

type Side = 'creator' | 'partner';
type Tri = 'any' | 'yes' | 'no';

export interface FiltersState {
  sortField: string;
  sortDesc: boolean;
  ranks: string[];
  wish: 0 | 1 | 2;
  characterId: number | null;
  characterLabel: string;
  characterCover: string;
  titleId: number | null;
  titleLabel: string;
  titleCover: string;
  awakened: Tri;
  favorite: Tri;
}

export const DEFAULT_FILTERS: FiltersState = {
  sortField: 'id',
  sortDesc: true,
  ranks: [],
  wish: 0,
  characterId: null,
  characterLabel: '',
  characterCover: '',
  titleId: null,
  titleLabel: '',
  titleCover: '',
  awakened: 'any',
  favorite: 'no',
};

const SORT_OPTS: { field: string; label: string }[] = [
  { field: 'id', label: 'Новизне' },
  { field: 'rank', label: 'Рангу' },
  { field: 'is_favorite', label: 'Избранным' },
  { field: 'card__title_id', label: 'Тайтлу' },
  { field: 'card__character_id', label: 'Персонажу' },
  { field: 'stack_count', label: 'По стаку' },
];

/** Собирает параметры запроса инвентаря из состояния фильтров и стороны. */
export function buildInvFilters(f: FiltersState, side: Side, ourId: number, partnerId: number): InventoryFilters {
  const inv: InventoryFilters = { ordering: (f.sortDesc ? '-' : '') + f.sortField };
  if (f.ranks.length) inv.ranks = f.ranks;
  if (f.characterId != null) inv.characterId = f.characterId;
  if (f.titleId != null) inv.titleId = f.titleId;
  inv.isAwakened = f.awakened === 'any' ? null : f.awakened === 'yes';
  inv.isFavorite = f.favorite === 'any' ? 'any' : f.favorite === 'yes';
  if (f.wish === 1) {
    inv.wishType = 1;
    inv.wishUserId = side === 'creator' ? partnerId : ourId;
  } else if (f.wish === 2) {
    inv.wishType = 2;
    inv.wishUserId = side === 'creator' ? null : partnerId;
  }
  return inv;
}

export function countActiveFilters(f: FiltersState): number {
  let n = 0;
  if (f.ranks.length) n++;
  if (f.wish) n++;
  if (f.characterId != null) n++;
  if (f.titleId != null) n++;
  if (f.awakened !== 'any') n++;
  if (f.favorite !== 'no') n++; // 'no' — значение по умолчанию
  return n;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── Левый фильтр: сортировка ──────────────────────────────────────────────────

export function SortFilter({ value, onChange }: { value: FiltersState; onChange: (v: FiltersState) => void }) {
  const [open, setOpen] = useState(false);
  const cur = SORT_OPTS.find((o) => o.field === value.sortField) ?? SORT_OPTS[0];

  const pick = (field: string) => {
    if (field === value.sortField) onChange({ ...value, sortDesc: !value.sortDesc }); // тот же — меняем направление
    else onChange({ ...value, sortField: field });
  };

  return (
    <div style={s.box}>
      <button style={s.btn} onClick={() => setOpen((o) => !o)}>
        <span style={s.btnLabel}>Сорт.: {cur.label} {value.sortDesc ? '↓' : '↑'}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <>
          <div style={s.scrim} onClick={() => setOpen(false)} />
          <div style={{ ...s.dropdown, left: 0 }}>
            {SORT_OPTS.map((o) => {
              const active = o.field === value.sortField;
              return (
                <button key={o.field} style={{ ...s.row, ...(active ? s.rowOn : {}) }} onClick={() => pick(o.field)}>
                  <span>{o.label}</span>
                  {active && <span style={s.dir}>{value.sortDesc ? '↓' : '↑'}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Поиск персонажа/тайтла ────────────────────────────────────────────────────

interface Picked { id: number; label: string; cover: string }

function SearchPicker({ placeholder, search, onPick }: {
  placeholder: string;
  search: (q: string) => Promise<Picked[]>;
  onPick: (item: Picked) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Picked[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = q.trim();
    if (!t) { setResults([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try { const r = await search(t); if (alive) setResults(r); }
      catch { if (alive) setResults([]); }
      finally { if (alive) setLoading(false); }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div>
      <input style={s.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoCapitalize="off" />
      {loading && <div style={s.info}>Поиск…</div>}
      {results.length > 0 && (
        <div style={s.results}>
          {results.map((r) => (
            <button key={r.id} style={s.resultRow} onClick={() => { onPick(r); setQ(''); setResults([]); }}>
              {r.cover
                ? (isVideoUrl(r.cover)
                    ? <video src={r.cover} style={s.resultImg} autoPlay loop muted playsInline />
                    : <img src={r.cover} style={s.resultImg} alt="" />)
                : <div style={{ ...s.resultImg, ...s.resultImgEmpty }} />}
              <span style={s.resultName}>{r.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Правый фильтр: панель из 6 фильтров ───────────────────────────────────────

export function CardsFilter({ value, onChange, side, partnerName }: {
  value: FiltersState;
  onChange: (v: FiltersState) => void;
  side: Side;
  partnerName: string;
}) {
  const token = useAppStore((s2) => s2.token);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FiltersState>(value);
  const [ranks, setRanks] = useState<CardRank[]>([]);

  const openSheet = () => {
    setDraft(value);
    setOpen(true);
    if (ranks.length === 0) getCardRanks(token).then(setRanks).catch(() => {});
  };

  const active = countActiveFilters(value);

  const wishOptions = side === 'creator'
    ? [{ v: 0, l: 'Не важно' }, { v: 1, l: `${partnerName} хочет получить` }, { v: 2, l: 'Я хочу отдать' }]
    : [{ v: 0, l: 'Не важно' }, { v: 1, l: 'Я хочу получить' }, { v: 2, l: `${partnerName} хочет отдать` }];

  const toggleRank = (id: string) =>
    setDraft((d) => ({ ...d, ranks: d.ranks.includes(id) ? d.ranks.filter((x) => x !== id) : [...d.ranks, id] }));

  const apply = () => { onChange(draft); setOpen(false); };
  const reset = () => setDraft({ ...DEFAULT_FILTERS, sortField: draft.sortField, sortDesc: draft.sortDesc });

  return (
    <div style={s.box}>
      <button style={s.btn} onClick={openSheet}>
        <span style={s.btnLabel}>Фильтры{active > 0 ? ` · ${active}` : ''}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div style={s.sheetBackdrop} onClick={() => setOpen(false)}>
          <div style={s.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={s.sheetScroll}>
              {/* Ранг */}
              <div style={s.section}>
                <div style={s.secTitle}>Ранг</div>
                <div style={s.chips}>
                  {ranks.map((r) => {
                    const on = draft.ranks.includes(r.id);
                    return (
                      <button key={r.id} style={{ ...s.chip, ...(on ? s.chipOn : {}) }} onClick={() => toggleRank(r.id)}>
                        {r.name}
                      </button>
                    );
                  })}
                  {ranks.length === 0 && <span style={s.info}>Загрузка…</span>}
                </div>
              </div>

              {/* Список желаний */}
              <div style={s.section}>
                <div style={s.secTitle}>Список желаний</div>
                <div style={s.pillCol}>
                  {wishOptions.map((o) => (
                    <button key={o.v} style={{ ...s.pill, ...(draft.wish === o.v ? s.pillOn : {}) }}
                      onClick={() => setDraft((d) => ({ ...d, wish: o.v as 0 | 1 | 2 }))}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Персонаж */}
              <div style={s.section}>
                <div style={s.secTitle}>Персонаж</div>
                {draft.characterId != null ? (
                  <div style={s.selected}>
                    {draft.characterCover && <img src={draft.characterCover} style={s.selImg} alt="" />}
                    <span style={s.selName}>{draft.characterLabel}</span>
                    <button style={s.clear} onClick={() => setDraft((d) => ({ ...d, characterId: null, characterLabel: '', characterCover: '' }))}>✕</button>
                  </div>
                ) : (
                  <SearchPicker
                    placeholder="Найти персонажа"
                    search={async (q) => (await searchCharacters(token, q)).map((c) => ({
                      id: c.id, label: c.name, cover: resolveMediaUrl(c.cover?.mid || c.cover?.high || ''),
                    }))}
                    onPick={(it) => setDraft((d) => ({ ...d, characterId: it.id, characterLabel: it.label, characterCover: it.cover }))}
                  />
                )}
              </div>

              {/* Тайтл */}
              <div style={s.section}>
                <div style={s.secTitle}>Тайтл</div>
                {draft.titleId != null ? (
                  <div style={s.selected}>
                    {draft.titleCover && <img src={draft.titleCover} style={s.selImg} alt="" />}
                    <span style={s.selName}>{draft.titleLabel}</span>
                    <button style={s.clear} onClick={() => setDraft((d) => ({ ...d, titleId: null, titleLabel: '', titleCover: '' }))}>✕</button>
                  </div>
                ) : (
                  <SearchPicker
                    placeholder="Найти тайтл"
                    search={async (q) => (await searchTitles(token, q))
                      .filter((t) => t.id != null)
                      .map((t) => ({
                        id: t.id as number,
                        label: t.main_name || t.secondary_name || t.dir,
                        cover: resolveMediaUrl(t.cover?.mid || t.cover?.high || ''),
                      }))}
                    onPick={(it) => setDraft((d) => ({ ...d, titleId: it.id, titleLabel: it.label, titleCover: it.cover }))}
                  />
                )}
              </div>

              {/* Пробуждение */}
              <div style={s.section}>
                <div style={s.secTitle}>Пробуждение</div>
                <TriSelect
                  value={draft.awakened}
                  labels={{ any: 'Любое', yes: 'Пробуждённые', no: 'Обычные' }}
                  onChange={(v) => setDraft((d) => ({ ...d, awakened: v }))}
                />
              </div>

              {/* В избранном */}
              <div style={s.section}>
                <div style={s.secTitle}>В избранном</div>
                <TriSelect
                  value={draft.favorite}
                  labels={{ any: 'Не важно', yes: 'В избранном', no: 'Не в избранном' }}
                  onChange={(v) => setDraft((d) => ({ ...d, favorite: v }))}
                />
              </div>
            </div>

            <div style={s.sheetFooter}>
              <button style={s.resetBtn} onClick={reset}>Сбросить</button>
              <button style={s.applyBtn} onClick={apply}>Применить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TriSelect({ value, labels, onChange }: { value: Tri; labels: Record<Tri, string>; onChange: (v: Tri) => void }) {
  const opts: Tri[] = ['any', 'yes', 'no'];
  return (
    <div style={s.tri}>
      {opts.map((o) => (
        <button key={o} style={{ ...s.triBtn, ...(value === o ? s.triOn : {}) }} onClick={() => onChange(o)}>
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  box: { position: 'relative', flex: 1 },
  btn: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', width: '100%',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    padding: '9px 10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  btnLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  scrim: { position: 'fixed', inset: 0, zIndex: 40 },
  dropdown: {
    position: 'absolute', top: 'calc(100% + 6px)', zIndex: 50, minWidth: '190px',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', padding: '4px',
  },
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%',
    background: 'none', border: 'none', borderRadius: '8px', padding: '10px', cursor: 'pointer',
    color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 600,
    WebkitTapHighlightColor: 'transparent', textAlign: 'left',
  },
  rowOn: { background: 'rgba(139,92,246,0.12)' },
  dir: { color: 'var(--accent)', fontWeight: 800 },

  // модальная панель фильтров
  sheetBackdrop: {
    position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: '520px', maxHeight: '82vh', display: 'flex', flexDirection: 'column',
    background: 'var(--surface)', borderTopLeftRadius: '18px', borderTopRightRadius: '18px',
    border: '1px solid var(--border)', borderBottom: 'none', overflow: 'hidden',
  },
  sheetScroll: { overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px', display: 'flex', flexDirection: 'column', gap: '18px' },
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  secTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' },

  chips: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  chip: {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '999px',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    padding: '7px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  chipOn: { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' },

  pillCol: { display: 'flex', flexDirection: 'column', gap: '6px' },
  pill: {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px',
    padding: '11px', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent',
  },
  pillOn: { background: 'rgba(139,92,246,0.14)', color: 'var(--text)', borderColor: 'var(--accent)' },

  input: {
    width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px',
    padding: '11px', outline: 'none',
  },
  info: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', padding: '6px 0' },
  results: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxHeight: '220px', overflowY: 'auto' },
  resultRow: {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '7px 9px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  resultImg: { width: '34px', height: '46px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg2)' },
  resultImgEmpty: { border: '1px solid var(--border)' },
  resultName: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' },

  selected: {
    display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '8px 10px',
  },
  selImg: { width: '32px', height: '44px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg2)' },
  selName: { flex: 1, fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  clear: { flexShrink: 0, background: 'none', border: 'none', color: 'var(--text3)', fontSize: '16px', cursor: 'pointer', padding: '0 4px' },

  tri: { display: 'flex', gap: '6px' },
  triBtn: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    padding: '10px 6px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  triOn: { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' },

  sheetFooter: { display: 'flex', gap: '10px', padding: '12px 16px', borderTop: '1px solid var(--border)' },
  resetBtn: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', padding: '12px', cursor: 'pointer',
  },
  applyBtn: {
    flex: 2, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', padding: '12px', cursor: 'pointer',
  },
};
