import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { CardZoomProvider, useCardZoom, isVideoUrl } from '../components/CardGallery';
import { getTitleCards, resolveMediaUrl, type TitleCard } from '../api/extra';

// ─── Одна карта в сетке ────────────────────────────────────────────────────────

function GridCard({ mid, high }: { mid: string; high: string }) {
  const zoom = useCardZoom();
  const vid = isVideoUrl(mid);
  return (
    <div style={t.cell} onClick={() => zoom(high || mid)}>
      {vid ? (
        <video src={mid} style={t.media} autoPlay loop muted playsInline />
      ) : (
        <img src={mid} style={t.media} loading="lazy" alt="" />
      )}
    </div>
  );
}

// ─── Сетка карт одного тайтла ───────────────────────────────────────────────────

/**
 * Показывает карты одного тайтла (по его id) сеткой с догрузкой и зумом.
 * Общий блок для обычных и лимитированных карт тайтла.
 *
 * Рендерить с key={titleId}, чтобы при смене тайтла компонент перемонтировался
 * и состояние (страница, набор карт) сбрасывалось само.
 */
export default function TitleCardsGrid({
  titleId,
  label,
  onBack,
}: {
  titleId: number;
  label: string;
  onBack: () => void;
}) {
  const token = useAppStore((s) => s.token);

  const [cards, setCards] = useState<TitleCard[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadingRef = useRef(false);
  const seenRef = useRef<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const next = page + 1;
      const { results: list, hasMore: more } = await getTitleCards(token, titleId, next);
      const add = list.filter((c) => !seenRef.current.has(c.id));
      add.forEach((c) => seenRef.current.add(c.id));
      if (add.length) setCards((prev) => [...prev, ...add]);
      setPage(next);
      setHasMore(more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [token, titleId, page, hasMore]);

  // догружаем, пока экран не заполнен (и первую страницу при монтировании)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || error) return;
    if (el.scrollHeight <= el.clientHeight + 40) void loadNext();
  }, [cards, hasMore, loading, error, loadNext]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (error) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) void loadNext();
  };

  return (
    <CardZoomProvider>
      <div style={t.root} ref={scrollRef} onScroll={onScroll}>
        <div style={t.selBar}>
          <span style={t.selName}>{label}</span>
          <button style={t.changeBtn} onClick={onBack}>другой тайтл</button>
        </div>

        <div style={t.grid}>
          {cards.map((c) => (
            <GridCard
              key={c.id}
              mid={resolveMediaUrl(c.cover?.mid || c.cover?.high || '')}
              high={resolveMediaUrl(c.cover?.high || c.cover?.mid || '')}
            />
          ))}
        </div>

        {loading && (
          <div style={t.statusRow}><span style={t.spinner} /><span style={t.statusText}>Загрузка…</span></div>
        )}
        {error && (
          <div style={t.errorBox}>
            <span style={t.errorText}>{error}</span>
            <button style={t.retryBtn} onClick={() => { setError(''); void loadNext(); }}>Повторить</button>
          </div>
        )}
        {!loading && !error && !hasMore && cards.length > 0 && <p style={t.endNote}>Это все карты.</p>}
        {!loading && !error && !hasMore && cards.length === 0 && <p style={t.empty}>У тайтла нет карт.</p>}
      </div>
    </CardZoomProvider>
  );
}

const t: Record<string, React.CSSProperties> = {
  root: {
    height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    background: 'var(--bg)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px',
  },

  selBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
  selName: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  changeBtn: {
    flexShrink: 0, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '7px 12px', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' },
  cell: {
    aspectRatio: '2 / 3', borderRadius: '8px', overflow: 'hidden',
    background: 'var(--bg3)', border: '1px solid var(--border)', cursor: 'pointer',
  },
  media: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },

  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px' },
  spinner: { width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-active)', borderTopColor: 'var(--accent)', animation: 'redecks-spin 0.7s linear infinite' },
  statusText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },
  errorBox: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '12px 14px' },
  errorText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', lineHeight: 1.4 },
  retryBtn: { flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#fff', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', cursor: 'pointer' },
  endNote: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '20px 0' },
};
