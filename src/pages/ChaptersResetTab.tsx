import { useState } from 'react';
import { useAppStore } from '../store';
import TitlePicker from '../components/TitlePicker';
import {
  getTitleContent,
  collectViewedChapters,
  markChaptersUnread,
  type ViewedChapter,
} from '../api/extra';

type Phase = 'pick' | 'loading' | 'review' | 'done';

export default function ChaptersResetTab() {
  const token = useAppStore((s) => s.token);
  const [phase, setPhase] = useState<Phase>('pick');
  const [titleLabel, setTitleLabel] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [viewed, setViewed] = useState<ViewedChapter[]>([]);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState('');

  const reset = () => {
    setPhase('pick');
    setViewed([]);
    setError('');
    setStatus('');
    setTitleLabel('');
    setCurrentSlug('');
  };

  const handlePick = async (slug: string, label: string) => {
    setBusy(true);
    setCurrentSlug(slug);
    setTitleLabel(label);
    setError('');
    setPhase('loading');
    setStatus('Получаю данные тайтла...');
    try {
      const content = await getTitleContent(token, slug);
      const branchId = content.active_branch;
      if (branchId == null) {
        throw new Error("У тайтла не найден active_branch.");
      }
      setStatus('Собираю прочитанные главы...');
      const found = await collectViewedChapters(token, Number(branchId), (page, total) => {
        setStatus(`Просматриваю страницу ${page}... найдено прочитанных: ${total}`);
      });
      setViewed(found);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    setError('');
    try {
      await markChaptersUnread(token, viewed.map((c) => c.id));
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={p.root}>
      {phase !== 'pick' && (
        <div style={p.actionRow}>
          <button style={p.resetBtn} onClick={reset}>другой тайтл</button>
        </div>
      )}

      <div style={p.scroll}>
        {phase === 'pick' && (
          <>
            <Card title="Тайтл">
              <TitlePicker busy={busy} onPick={handlePick} />
            </Card>
            {error && <p style={p.error}>{error}</p>}
            <p style={p.note}>
              Найдёт все прочитанные тобой главы выбранного тайтла и снимет
              отметку «прочитано» — главы снова станут новыми.
            </p>
          </>
        )}

        {phase === 'loading' && (
          <Card title={titleLabel}>
            <div style={p.statusRow}>
              <span style={p.spinner} />
              <span style={p.statusText}>{status}</span>
            </div>
          </Card>
        )}

        {phase === 'review' && (
          <>
            <Card title={titleLabel}>
              <div style={p.bigCount}>{viewed.length}</div>
              <div style={p.bigCountLabel}>прочитанных глав найдено</div>
            </Card>

            {viewed.length > 0 && (
              <Card title="Главы">
                <div style={p.chapterList}>
                  {viewed.map((c) => (
                    <div key={c.id} style={p.chapterItem}>
                      <span style={p.chapterMain}>
                        {c.tome != null ? `Том ${c.tome} · ` : ''}Глава {c.chapter ?? '?'}
                      </span>
                      {c.name ? <span style={p.chapterName}>{c.name}</span> : null}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {error && <p style={p.error}>{error}</p>}
          </>
        )}

        {phase === 'done' && (
          <Card title={titleLabel}>
            <div style={{ ...p.bigCount, color: 'var(--green)' }}>✓</div>
            <div style={p.bigCountLabel}>
              {viewed.length} глав отмечено как непрочитанные
            </div>
          </Card>
        )}
      </div>

      {phase === 'review' && viewed.length > 0 && (
        <div style={p.bottomBar}>
          <button
            style={{ ...p.actionBtn, opacity: resetting ? 0.6 : 1 }}
            onClick={handleReset}
            disabled={resetting}
          >
            {resetting ? 'Сбрасываю...' : `Сбросить прочтение ${viewed.length} глав`}
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div style={p.bottomBar}>
          <button
            style={{ ...p.repeatBtn, opacity: busy ? 0.6 : 1 }}
            onClick={() => { if (currentSlug) handlePick(currentSlug, titleLabel); }}
            disabled={busy || !currentSlug}
          >
            ↻ Повторить для этого тайтла
          </button>
        </div>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={p.card}>
      <div style={p.cardHeader}>
        <span style={p.cardTitle}>{title}</span>
      </div>
      <div style={p.cardBody}>{children}</div>
    </div>
  );
}

const p: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
    padding: '16px 20px 12px',
    paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  title: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', letterSpacing: '-0.02em', color: 'var(--text)' },
  sub: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--accent)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '2px' },
  resetBtn: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', background: 'transparent', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  actionRow: { display: 'flex', justifyContent: 'flex-end', padding: '8px 16px 0', flexShrink: 0 },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', flexShrink: 0 },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border)' },
  cardTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.12em' },
  cardBody: { padding: '14px' },
  note: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', lineHeight: 1.6, padding: '0 4px' },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  statusText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },
  spinner: {
    width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
    border: '2px solid var(--border-active)', borderTopColor: 'var(--accent)',
    animation: 'redecks-spin 0.7s linear infinite',
  },
  bigCount: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '44px', color: 'var(--text)', textAlign: 'center', lineHeight: 1.1 },
  bigCountLabel: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', textAlign: 'center', marginTop: '4px' },
  chapterList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  chapterItem: { display: 'flex', flexDirection: 'column', gap: '2px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '11px 14px' },
  chapterMain: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text)' },
  chapterName: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },
  bottomBar: {
    padding: '12px 16px',
    background: 'var(--bg)', borderTop: '1px solid var(--border)', flexShrink: 0,
  },
  actionBtn: {
    width: '100%', background: 'var(--red)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '16px',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  repeatBtn: {
    width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '16px',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.2)' },
};
