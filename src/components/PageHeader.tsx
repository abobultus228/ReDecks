import BrandMark from './BrandMark';

interface Props {
  title: string;
  sub?: string;
  /** Необязательное действие справа под логотипом (напр. «другой тайтл»). */
  action?: React.ReactNode;
}

export default function PageHeader({ title, sub, action }: Props) {
  return (
    <div style={h.header}>
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
    gap: '12px',
    padding: '16px 20px 12px',
    paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
    flexShrink: 0,
  },
  left: { minWidth: 0 },
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
