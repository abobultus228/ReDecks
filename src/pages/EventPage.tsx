import PageHeader from '../components/PageHeader';

export default function EventPage() {
  return (
    <div style={p.root}>
      <PageHeader title="Ивент" sub="скоро здесь" />
      <div style={p.body}>
        <img
          src="/under-construction.svg"
          alt="Ведутся работы"
          style={p.image}
        />
        <p style={p.note}>Раздел в разработке.</p>
      </div>
    </div>
  );
}

const p: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
    padding: '32px',
  },
  image: {
    width: '100%',
    maxWidth: '340px',
    maxHeight: '45vh',
    objectFit: 'contain',
  },
  note: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '22px',
    color: 'var(--text2)',
    textAlign: 'center',
    letterSpacing: '-0.01em',
  },
};
