import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from './store';
import { setupImmersive } from './utils/immersive';
import AuthPage from './pages/AuthPage';
import ChaptersPage from './pages/ChaptersPage';
import CardsPage from './pages/CardsPage';
import CraftPage from './pages/CraftPage';
import ChatPage from './pages/ChatPage';
import EventPage from './pages/EventPage';
import AppSettingsPage from './pages/AppSettingsPage';
import ExchangesPage from './pages/ExchangesPage';
import ForumPage from './pages/ForumPage';
import RepassPage from './pages/RepassPage';
import OnboardingPage from './pages/OnboardingPage';
import { syncNotifier, seedExchangeBaseline } from './utils/notifier';
import { App as CapacitorApp } from '@capacitor/app';
import NavBar, { type Tab } from './components/NavBar';
import { NavigationMenuContext } from './components/NavigationMenuContext';

export default function App() {
  const { token, userId, theme, loadSettings, onboardingDone, exchangeTargetUserId, viewExchangesUserId, chatTargetUserId } = useAppStore();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [tab, setTab] = useState<Tab>('chat');
  const [chatInRoom, setChatInRoom] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = useCallback(() => setMenuOpen(true), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const selectTab = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Полноэкранный режим: скрываем шторку уведомлений и панель навигации
  useEffect(() => {
    const teardown = setupImmersive();
    return teardown;
  }, []);

  useEffect(() => {
    loadSettings().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    setAuthed(Boolean(token && userId));
  }, [ready]);

  // Открыть обмен с пользователем (тап по аватарке на форуме) — переключаем вкладку.
  useEffect(() => {
    if (exchangeTargetUserId != null) selectTab('exchanges');
  }, [exchangeTargetUserId, selectTab]);

  // Посмотреть обмены пользователя (тап по аватарке) — переключаем на обмены.
  useEffect(() => {
    if (viewExchangesUserId != null) selectTab('exchanges');
  }, [viewExchangesUserId, selectTab]);

  // Написать сообщение пользователю — переключаем на чат.
  useEffect(() => {
    if (chatTargetUserId != null) selectTab('chat');
  }, [chatTargetUserId, selectTab]);

  // Запускаем/обновляем фоновый уведомитель, когда вошли,
  // и обновляем базовую линию обменов при входе и при возврате в приложение.
  useEffect(() => {
    if (!authed) return;
    void syncNotifier();
    void seedExchangeBaseline();

    const sub = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void seedExchangeBaseline();
    });
    return () => { void sub.then((h) => h.remove()); };
  }, [authed]);

  if (!ready) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--text2)', fontFamily: 'var(--font-display)',
        fontSize: '14px', letterSpacing: '0.05em',
      }}>
        загрузка...
      </div>
    );
  }

  if (!authed) {
    return <AuthPage onAuth={() => { setAuthed(true); selectTab('chat'); }} />;
  }

  // Начальная настройка уведомлений — один раз после входа
  if (!onboardingDone) {
    return <OnboardingPage onDone={() => { /* флаг уже сохранён в сторе */ }} />;
  }

  const showNavigation = !(tab === 'chat' && chatInRoom);

  return (
    <div style={shell.root}>
      <NavigationMenuContext.Provider value={showNavigation ? openMenu : null}>
        <div style={shell.content}>
          {tab === 'chat' && <ChatPage onInRoomChange={setChatInRoom} />}
          {tab === 'chapters' && <ChaptersPage />}
          {tab === 'event' && <EventPage />}
          {tab === 'cards' && <CardsPage />}
          {tab === 'craft' && <CraftPage />}
          {tab === 'exchanges' && <ExchangesPage />}
          {tab === 'forum' && <ForumPage />}
          {tab === 'repass' && <RepassPage />}
          {tab === 'settings' && <AppSettingsPage onLogout={() => { setAuthed(false); closeMenu(); }} />}
        </div>
      </NavigationMenuContext.Provider>
      {showNavigation && <NavBar active={tab} onChange={selectTab} menuOpen={menuOpen} onMenuClose={closeMenu} />}
    </div>
  );
}

const shell: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
};
