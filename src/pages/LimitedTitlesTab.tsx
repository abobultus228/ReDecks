import { useState } from 'react';
import { searchLimitedTitles, type LimitedTitle } from '../utils/limitedTitles';
import LimitedRun from './LimitedRun';

export default function LimitedTitlesTab() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LimitedTitle | null>(null);
  const results = searchLimitedTitles(query);

  if (selected) {
    return <LimitedRun title={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div style={s.root}>
      <div style={s.searchWrap}>
        <input
          style={s.search}
          placeholder="Поиск по названию…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div style={s.list}>
        {results.length === 0 ? (
          <p style={s.empty}>Ничего не найдено</p>
        ) : (
          results.map((t) => (
            <button key={t.branchId} style={s.item} onClick={() => setSelected(t)}>
              <span style={s.itemName}>{t.name}</span>
              <span style={s.itemDir}>{t.dir}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  searchWrap: { padding: '12px 16px', flexShrink: 0 },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 14px',
    color: 'var(--text)',
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    outline: 'none',
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: '0 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    textAlign: 'left',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px 14px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  itemName: { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px', color: 'var(--text)' },
  itemDir: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '24px 0' },
};
