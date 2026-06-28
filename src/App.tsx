import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { setupImmersive } from './utils/immersive';
import AuthPage from './pages/AuthPage';
import SettingsPage from './pages/SettingsPage';
import ProcessPage from './pages/ProcessPage';
import ChaptersPage from './pages/ChaptersPage';
import CardsPage from './pages/CardsPage';
import ChatPage from './pages/ChatPage';
import EventPage from './pages/EventPage';
import AppSettingsPage from './pages/AppSettingsPage';
import ExchangesPage from './pages/ExchangesPage';
import OnboardingPage from './pages/OnboardingPage';
import { syncNotifier, seedExchangeBaseline } from './utils/notifier';
import { App as CapacitorApp } from '@capacitor/app';
import NavBar, { type Tab } from './components/NavBar';

export default function App() {
  const { token, userId, loadSettings, onboardingDone } = useAppStore();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [tab, setTab] = useState<Tab>('decks');
  const [decksView, setDecksView] = useState<'settings' | 'process'>('settings');
  const [chatInRoom, setChatInRoom] = useState(false);

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
    return <AuthPage onAuth={() => { setAuthed(true); setTab('decks'); setDecksView('settings'); }} />;
  }

  // Начальная настройка уведомлений — один раз после входа
  if (!onboardingDone) {
    return <OnboardingPage onDone={() => { /* флаг уже сохранён в сторе */ }} />;
  }

  // Процесс открытия — на весь экран, без нижней навигации
  if (tab === 'decks' && decksView === 'process') {
    return <ProcessPage onBack={() => setDecksView('settings')} />;
  }

  return (
    <div style={shell.root}>
      <div style={shell.content}>
        {tab === 'chat' && <ChatPage onInRoomChange={setChatInRoom} />}
        {tab === 'decks' && (
          <SettingsPage onStart={() => setDecksView('process')} />
        )}
        {tab === 'chapters' && <ChaptersPage />}
        {tab === 'event' && <EventPage />}
        {tab === 'cards' && <CardsPage />}
        {tab === 'exchanges' && <ExchangesPage />}
        {tab === 'settings' && <AppSettingsPage onLogout={() => { setAuthed(false); }} />}
      </div>
      {!(tab === 'chat' && chatInRoom) && <NavBar active={tab} onChange={setTab} />}
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
