export type Tab = 'decks' | 'chapters' | 'cards';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const ITEMS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'decks',
    label: 'Колоды',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="11" height="15" rx="2" />
        <path d="M9 5l3-2 7 3-1 12-3 1" />
      </svg>
    ),
  },
  {
    key: 'chapters',
    label: 'Главы',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    key: 'cards',
    label: 'Карты',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

export default function NavBar({ active, onChange }: Props) {
  return (
    <nav style={s.root}>
      {ITEMS.map((item) => {
        const on = item.key === active;
        return (
          <button
            key={item.key}
            style={{ ...s.item, color: on ? 'var(--accent)' : 'var(--text3)' }}
            onClick={() => onChange(item.key)}
          >
            {item.icon}
            <span style={s.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    flexShrink: 0,
  },
  item: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '10px 0 9px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'color 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.04em',
  },
};
