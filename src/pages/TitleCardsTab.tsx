import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { isVideoUrl } from '../components/CardGallery';
import { searchTitles, resolveMediaUrl } from '../api/extra';
import TitleCardsGrid from './TitleCardsGrid';

interface TitlePick { id: number; label: string; cover: string }

// ─── Вкладка «Обычные»: поиск тайтла через API, затем его карты ───────────────────

export default function TitleCardsTab() {
  const token = useAppStore((s) => s.token);

  const [sel, setSel] = useState<TitlePick | null>(null);

  // поиск
  const [q, setQ] = useState('');
  const [results, setResults] = useState<TitlePick[]>([]);
  const [searching, setSearching] = useState(false);

  // живой поиск тайтла с картинками
  useEffect(() => {
    if (sel) return;
    const query = q.trim();
    if (!query) { setResults([]); setSearching(false); return; }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchTitles(token, query);
        if (!alive) return;
        setResults(found.filter((x) => x.id != null).map((x) => ({
          id: x.id as number,
          label: x.main_name || x.secondary_name || x.dir,
          cover: resolveMediaUrl(x.cover?.mid || x.cover?.high || ''),
        })));
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, sel, token]);

  // выбран тайтл — показываем его карты общей сеткой
  if (sel) {
    return (
      <TitleCardsGrid
        key={sel.id}
        titleId={sel.id}
        label={sel.label}
        onBack={() => setSel(null)}
      />
    );
  }

  const pick = (item: TitlePick) => { setSel(item); setQ(''); setResults([]); };

  return (
    <div style={t.root}>
      <div style={t.searchWrap}>
        <input
          style={t.input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Название тайтла"
          autoCapitalize="off"
        />
        {searching && <p style={t.info}>Поиск…</p>}
        <div style={t.results}>
          {results.map((r) => (
            <button key={r.id} style={t.resultRow} onClick={() => pick(r)}>
              {r.cover
                ? (isVideoUrl(r.cover)
                    ? <video src={r.cover} style={t.resultImg} autoPlay loop muted playsInline />
                    : <img src={r.cover} style={t.resultImg} alt="" />)
                : <div style={{ ...t.resultImg, ...t.resultImgEmpty }} />}
              <span style={t.resultName}>{r.label}</span>
            </button>
          ))}
          {!searching && q.trim() && results.length === 0 && <p style={t.info}>Ничего не найдено.</p>}
        </div>
      </div>
    </div>
  );
}

const t: Record<string, React.CSSProperties> = {
  root: {
    height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    background: 'var(--bg)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px',
  },

  searchWrap: { display: 'flex', flexDirection: 'column', gap: '10px' },
  input: {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px', padding: '12px', outline: 'none',
  },
  info: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '4px 0' },
  results: { display: 'flex', flexDirection: 'column', gap: '6px' },
  resultRow: {
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '8px 10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  resultImg: { width: '38px', height: '52px', borderRadius: '6px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' },
  resultImgEmpty: { border: '1px solid var(--border)' },
  resultName: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' },
};
