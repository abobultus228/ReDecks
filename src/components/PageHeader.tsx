import { useContext } from 'react';
import BrandMark from './BrandMark';
import { NavigationMenuContext } from './NavigationMenuContext';

interface Props {
  title: string;
  sub?: string;
  /** Необязательное действие справа под логотипом (напр. «другой тайтл»). */
  action?: React.ReactNode;
}

export default function PageHeader({ title, sub, action }: Props) {
  const openMenu = useContext(NavigationMenuContext);

  return (
    <div style={h.header}>
      {openMenu && (
        <button
          type="button"
          style={h.menuButton}
          onClick={openMenu}
          aria-label="Открыть меню"
          aria-controls="redecks-navigation-drawer"
          aria-haspopup="dialog"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      <div style={h.left}>
        <div style={h.title}>{title}</div>
        {sub && <div style={h.sub}>{sub}</div>}
      </div>
      <div style={h.right}>
        <BrandMark />
        {action}
      </div>
    </div>
  );
}

const h: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '10px',
    padding: '16px 20px 12px',
    paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
    flexShrink: 0,
  },
  menuButton: {
    width: '40px',
    height: '40px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg3)',
    color: 'var(--accent)',
    border: '1px solid var(--border-active)',
    borderRadius: '12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  left: { minWidth: 0, flex: 1 },
  title: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '20px',
    letterSpacing: '-0.02em',
    color: 'var(--text)',
  },
  sub: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--accent)',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    marginTop: '2px',
  },
  right: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    flexShrink: 0,
  },
};
