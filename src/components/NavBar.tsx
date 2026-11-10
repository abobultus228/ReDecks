import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

export type Tab = 'chat' | 'chapters' | 'event' | 'cards' | 'craft' | 'exchanges' | 'forum' | 'repass' | 'settings';

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  menuOpen: boolean;
  onMenuClose: () => void;
}

const PRIMARY: { tab: Tab; label: string }[] = [
  { tab: 'chat', label: 'Чат' },
  { tab: 'chapters', label: 'Главы' },
  { tab: 'exchanges', label: 'Обмены' },
];

const MENU: { tab: Tab; label: string }[] = [
  { tab: 'cards', label: 'Карты' },
  { tab: 'craft', label: 'Крафт' },
  { tab: 'forum', label: 'Форум' },
  { tab: 'event', label: 'Ивент' },
  { tab: 'repass', label: 'Re:pass' },
  { tab: 'settings', label: 'Настройки' },
];

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
  event: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.9 6 6.6.6-5 4.3 1.5 6.5L12 16l-6 3.4 1.5-6.5-5-4.3 6.6-.6z" />
    </svg>
  ),
  repass: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="9" r="5" />
      <path d="m8.2 13-2 8 5.8-3 5.8 3-2-8" />
      <path d="m12 6.7.7 1.4 1.5.2-1.1 1.1.3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1.1 1.5-.2z" strokeWidth="1.2" />
    </svg>
  ),
  cards: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  ),
  craft: (
    <svg width="22" height="22" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 18h37v7c-5 5-11 8-18 8H9l-4-8zM42 18h17c-1 7-7 11-17 11M25 33v10h14V33M19 43h26l4 9H15z" />
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

export default function NavBar({ active, onChange, menuOpen, onMenuClose }: Props) {
  useEffect(() => {
    if (!menuOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onMenuClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const backButton = CapacitorApp.addListener('backButton', onMenuClose);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      void backButton.then((handler) => handler.remove());
    };
  }, [menuOpen, onMenuClose]);

  return (
    <>
      {menuOpen && (
        <>
          <div style={s.backdrop} onClick={onMenuClose} aria-hidden="true" />
          <div id="redecks-navigation-drawer" role="dialog" aria-modal="true" aria-label="Меню разделов" style={s.drawer}>
            <div style={s.drawerHeader}>
              <span style={s.drawerTitle}>Разделы</span>
              <button type="button" style={s.closeButton} onClick={onMenuClose} aria-label="Закрыть меню">
                {icons.close}
              </button>
            </div>
            <div style={s.menuList}>
              {MENU.map(({ tab, label }) => (
                <button
                  key={tab}
                  type="button"
                  style={{ ...s.menuItem, ...(active === tab ? s.menuItemOn : {}), ...(tab === 'settings' ? s.settingsItem : {}) }}
                  onClick={() => onChange(tab)}
                  aria-current={active === tab ? 'page' : undefined}
                >
                  {icons[tab]}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={s.spacer} />
      <nav style={s.panel} aria-label="Основные разделы">
        <div style={s.row}>
          {PRIMARY.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              style={{ ...s.tile, ...(active === tab ? s.tileOn : {}) }}
              onClick={() => onChange(tab)}
              aria-current={active === tab ? 'page' : undefined}
            >
              {icons[tab]}
              <span style={s.label}>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 60,
  },
  spacer: {
    height: 'calc(73px + env(safe-area-inset-bottom, 0px))',
    flexShrink: 0,
  },
  panel: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    padding: '8px 8px calc(8px + env(safe-area-inset-bottom, 0px))',
    background: 'var(--bg2)',
    borderTop: '1px solid var(--border)',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '8px',
    height: '56px',
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
    background: 'var(--accent-soft)',
    border: '1px solid var(--border-active)',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.03em',
  },
  drawer: {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    width: 'min(82vw, 320px)',
    zIndex: 61,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg2)',
    borderRight: '1px solid var(--border-active)',
    boxShadow: '12px 0 36px rgba(0,0,0,0.35)',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: '1px solid var(--border)',
  },
  drawerTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  closeButton: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    background: 'var(--bg3)',
    color: 'var(--text2)',
    cursor: 'pointer',
  },
  menuList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    width: '100%',
    minHeight: '52px',
    padding: '0 14px',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    background: 'var(--bg3)',
    color: 'var(--text2)',
    fontFamily: 'var(--font-display)',
    fontSize: '15px',
    fontWeight: 600,
    textAlign: 'left',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  menuItemOn: {
    color: 'var(--accent)',
    background: 'var(--accent-soft)',
    borderColor: 'var(--border-active)',
  },
  settingsItem: {
    marginTop: 'auto',
  },
};
