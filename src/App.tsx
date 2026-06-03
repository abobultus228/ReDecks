import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import AuthPage from './pages/AuthPage';
import SettingsPage from './pages/SettingsPage';
import ProcessPage from './pages/ProcessPage';

type Page = 'auth' | 'settings' | 'process';

export default function App() {
  const { token, userId, loadSettings } = useAppStore();
  const [page, setPage] = useState<Page>('auth');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadSettings().then(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (token && userId) {
      setPage('settings');
    } else {
      setPage('auth');
    }
  }, [ready]);

  if (!ready) {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', color: 'var(--text2)', fontFamily: 'var(--font-display)',
        fontSize: '14px', letterSpacing: '0.05em'
      }}>
        загрузка...
      </div>
    );
  }

  if (page === 'auth')     return <AuthPage onAuth={() => setPage('settings')} />;
  if (page === 'settings') return <SettingsPage onStart={() => setPage('process')} onLogout={() => setPage('auth')} />;
  if (page === 'process')  return <ProcessPage onBack={() => setPage('settings')} />;

  return null;
}
