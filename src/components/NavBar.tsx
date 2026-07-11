import { useState } from 'react';

export type Tab = 'chat' | 'chapters' | 'decks' | 'event' | 'cards' | 'exchanges' | 'forum' | 'settings';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const ROW = 56;  // высота ряда плиток
const GAP = 8;   // расстояние между плитками

const HIDDEN: Tab[] = ['decks', 'event', 'cards', 'exchanges', 'forum', 'settings']; // что прячется под «Ещё»

// ─── Иконки ──────────────────────────────────────────────────────────────────

const icons: Record<string, React.ReactNode> = {
  chat: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  chapters: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  decks: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="11" height="15" rx="2" />
      <path d="M9 5l3-2 7 3-1 12-3 1" />
    </svg>
  ),
  event: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.9 6 6.6.6-5 4.3 1.5 6.5L12 16l-6 3.4 1.5-6.5-5-4.3 6.6-.6z" />
    </svg>
  ),
  cards: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  ),
  more: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  ),
  close: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  ),
  exchanges: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  settings: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  forum: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 8V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2v3l3.5-3.5" />
      <path d="M9 12a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2v3l-3.5-3.5H11a2 2 0 0 1-2-2z" />
    </svg>
  ),
};

function Tile({
  iconKey, label, on, onClick, span = 1,
}: { iconKey: string; label: string; on: boolean; onClick: () => void; span?: number }) {
  return (
    <button
      style={{ ...s.tile, gridColumn: span > 1 ? `span ${span}` : undefined, ...(on ? s.tileOn : {}) }}
      onClick={onClick}
    >
      {icons[iconKey]}
      <span style={s.label}>{label}</span>
    </button>
  );
}

export default function NavBar({ active, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);

  const pick = (t: Tab) => {
    onChange(t);
    setExpanded(false);
  };

  // Когда свёрнуто, а активен скрытый раздел — подсвечиваем «Ещё»
  const moreActive = !expanded && HIDDEN.includes(active);

  return (
    <>
      {expanded && <div style={s.backdrop} onClick={() => setExpanded(false)} />}

      {/* резервируем место под свёрнутую плашку, чтобы контент не перекрывался */}
      <div style={s.spacer} />

      <div style={{ ...s.panel, transform: `translateY(${expanded ? 0 : (ROW + GAP) * 2}px)` }}>
        {/* верхний ряд — всегда видимая плашка */}
        <div style={s.row}>
          <Tile iconKey="chat" label="Чат" on={active === 'chat'} onClick={() => pick('chat')} />
          <Tile iconKey="chapters" label="Главы" on={active === 'chapters'} onClick={() => pick('chapters')} />
          <button
            style={{ ...s.tile, ...(moreActive ? s.tileOn : {}) }}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? icons.close : icons.more}
            <span style={s.label}>{expanded ? 'Закрыть' : 'Ещё'}</span>
          </button>
        </div>

        {/* второй ряд — выезжает из-под экрана */}
        <div style={s.row}>
          <Tile iconKey="decks" label="Колоды" on={active === 'decks'} onClick={() => pick('decks')} />
          <Tile iconKey="event" label="Ивент" on={active === 'event'} onClick={() => pick('event')} />
          <Tile iconKey="cards" label="Персонажи" on={active === 'cards'} onClick={() => pick('cards')} />
        </div>

        {/* третий ряд — «Настройки», «Форум» и «Обмены» */}
        <div style={s.row}>
          <Tile iconKey="settings" label="Настройки" on={active === 'settings'} onClick={() => pick('settings')} />
          <Tile iconKey="forum" label="Форум" on={active === 'forum'} onClick={() => pick('forum')} />
          <Tile iconKey="exchanges" label="Обмены" on={active === 'exchanges'} onClick={() => pick('exchanges')} />
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 40,
  },
  spacer: {
    height: ROW + GAP * 2, // высота свёрнутой плашки (ряд + внешние отступы)
    flexShrink: 0,
  },
  panel: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    display: 'flex',
    flexDirection: 'column',
    gap: `${GAP}px`,
    padding: `${GAP}px`,
    background: 'var(--bg2)',
    borderTop: '1px solid var(--border)',
    transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
    willChange: 'transform',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: `${GAP}px`,
    height: `${ROW}px`,
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    height: '100%',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    color: 'var(--text3)',
    cursor: 'pointer',
    transition: 'color 0.15s, background 0.15s, border-color 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  tileOn: {
    color: 'var(--accent)',
    background: 'rgba(139,92,246,0.12)',
    border: '1px solid var(--border-active)',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.03em',
  },
};
