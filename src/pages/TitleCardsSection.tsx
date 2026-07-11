import { useState } from 'react';
import TitleCardsTab from './TitleCardsTab';
import LimitedTitleCardsTab from './LimitedTitleCardsTab';

type Sub = 'regular' | 'limited';

// ─── «Карты тайтла» с под-вкладками Обычные / Лимитированные ──────────────────────

export default function TitleCardsSection() {
  const [sub, setSub] = useState<Sub>('regular');

  return (
    <div style={w.root}>
      <div style={w.tabs}>
        <button
          style={{ ...w.tab, ...(sub === 'regular' ? w.tabOn : {}) }}
          onClick={() => setSub('regular')}
        >
          Обычные
        </button>
        <button
          style={{ ...w.tab, ...(sub === 'limited' ? w.tabOn : {}) }}
          onClick={() => setSub('limited')}
        >
          Лимитированные
        </button>
      </div>

      <div style={w.body}>
        {sub === 'regular' ? <TitleCardsTab /> : <LimitedTitleCardsTab />}
      </div>
    </div>
  );
}

const w: Record<string, React.CSSProperties> = {
  root: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  tabs: {
    display: 'flex', gap: '6px', padding: '8px 12px',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  tab: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    padding: '8px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  tabOn: { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
};
