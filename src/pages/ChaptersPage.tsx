import { useState } from 'react';
import PageHeader from '../components/PageHeader';
import RegularTitlesTab from './RegularTitlesTab';
import LimitedTitlesTab from './LimitedTitlesTab';

type Tab = 'regular' | 'limited';

export default function ChaptersPage() {
  const [tab, setTab] = useState<Tab>('regular');

  return (
    <div style={w.root}>
      <PageHeader title="Главы" sub="чтение тайтлов" />

      <div style={w.tabBar}>
        <button
          style={{ ...w.tab, ...(tab === 'regular' ? w.tabOn : {}) }}
          onClick={() => setTab('regular')}
        >
          Обычные
        </button>
        <button
          style={{ ...w.tab, ...(tab === 'limited' ? w.tabOn : {}) }}
          onClick={() => setTab('limited')}
        >
          Лимитированные
        </button>
      </div>

      <div style={w.body}>
        {tab === 'regular' ? <RegularTitlesTab /> : <LimitedTitlesTab />}
      </div>
    </div>
  );
}

const w: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  tabBar: { display: 'flex', gap: '6px', padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  tab: {
    flex: 1,
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    background: 'var(--bg3)',
    color: 'var(--text2)',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  tabOn: { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)' },
  body: { flex: 1, minHeight: 0 },
};
