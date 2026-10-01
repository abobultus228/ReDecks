import { useState } from 'react';
import { useAppStore } from '../store';
import TitlePicker from '../components/TitlePicker';
import { getTitleContent } from '../api/extra';
import ChapterRun from './ChapterRun';

interface ReadTitle {
  branchId: number;
  name: string;
}

export default function RegularTitlesTab() {
  const token = useAppStore((s) => s.token);
  const [selected, setSelected] = useState<ReadTitle | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handlePick = async (slug: string, label: string) => {
    setBusy(true);
    setError('');
    try {
      const content = await getTitleContent(token, slug);
      const branchId = Number(content.active_branch);
      if (!Number.isInteger(branchId) || branchId <= 0) {
        throw new Error('У тайтла не найдена активная ветка глав.');
      }
      setSelected({ branchId, name: label });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return <ChapterRun title={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div style={s.root}>
      <div style={s.card}>
        <div style={s.title}>Выбери тайтл</div>
        <TitlePicker busy={busy} onPick={handlePick} />
      </div>
      {busy && <p style={s.hint}>Получаю ветку глав…</p>}
      {error && <p style={s.error}>{error}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' },
  title: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  hint: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' },
};
