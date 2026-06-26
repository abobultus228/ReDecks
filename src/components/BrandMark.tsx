/** Логотип-надпись ReDecks (крутой шрифт). Ставится справа в шапке страниц. */
export default function BrandMark() {
  return (
    <div style={s.mark}>
      <span style={s.re}>Re</span>
      <span style={s.decks}>Decks</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  mark: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '19px',
    letterSpacing: '-0.02em',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  re: { color: 'var(--accent)' },
  decks: { color: 'var(--text)' },
};
