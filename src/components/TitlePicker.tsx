import { useRef, useState } from 'react';
import { useAppStore } from '../store';
import { searchTitles, extractSlugFromUrl, type TitleSearchResult } from '../api/extra';

interface Props {
  /** Вызывается, когда пользователь выбрал тайтл (передаётся slug). */
  onPick: (slug: string, label: string) => void;
  /** Блокирует ввод, пока идёт обработка выбранного тайтла. */
  busy?: boolean;
}

export default function TitlePicker({ onPick, busy }: Props) {
  const token = useAppStore((s) => s.token);
  const [mode, setMode] = useState<'link' | 'search'>('search');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TitleSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  // Читаем значение прямо из поля: на Android предиктивная клавиатура
  // не успевает закоммитить последнее слово в state до нажатия кнопки.
  const linkRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const handleLink = () => {
    setError('');
    const raw = (linkRef.current?.value ?? url).trim();
    setUrl(raw);
    try {
      const slug = extractSlugFromUrl(raw);
      onPick(slug, slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Неверная ссылка');
    }
  };

  const handleSearch = async () => {
    const q = (searchRef.current?.value ?? query).trim();
    setQuery(q);
    if (!q) { setError('Введите запрос'); return; }
    setError('');
    setSearching(true);
    setResults([]);
    try {
      const found = await searchTitles(token, q);
      if (!found.length) setError(`Ничего не найдено по запросу «${q}».`);
      setResults(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div style={s.root}>
      <div style={s.tabs}>
        <button
          style={{ ...s.tab, ...(mode === 'search' ? s.tabActive : {}) }}
          onClick={() => { setMode('search'); setError(''); }}
        >
          Поиск
        </button>
        <button
          style={{ ...s.tab, ...(mode === 'link' ? s.tabActive : {}) }}
          onClick={() => { setMode('link'); setError(''); }}
        >
          Ссылка
        </button>
      </div>

      {mode === 'link' ? (
        <div style={s.row}>
          <input
            ref={linkRef}
            style={s.input}
            placeholder="https://remanga.org/manga/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button style={s.goBtn} onClick={handleLink} disabled={busy}>
            Открыть
          </button>
        </div>
      ) : (
        <>
          <div style={s.row}>
            <input
              ref={searchRef}
              style={s.input}
              placeholder="название тайтла"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            />
            <button style={s.goBtn} onClick={handleSearch} disabled={searching || busy}>
              {searching ? '...' : 'Найти'}
            </button>
          </div>

          {results.length > 0 && (
            <div style={s.results}>
              {results.map((t) => {
                const label = t.main_name ?? t.dir;
                const second = t.secondary_name ? ` / ${t.secondary_name}` : '';
                const meta = [t.type?.name, t.issue_year, t.translate_status?.name]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={t.dir}
                    style={s.resultItem}
                    onClick={() => onPick(t.dir, label)}
                    disabled={busy}
                  >
                    <span style={s.resultName}>{label}{second}</span>
                    {meta && <span style={s.resultMeta}>{meta}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {error && <p style={s.error}>{error}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '10px' },
  tabs: { display: 'flex', gap: '6px' },
  tab: {
    flex: 1,
    padding: '8px',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text3)',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  tabActive: {
    background: 'rgba(139,92,246,0.12)',
    border: '1px solid var(--border-active)',
    color: 'var(--text)',
  },
  row: { display: 'flex', gap: '8px' },
  input: {
    flex: 1,
    minWidth: 0,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '11px 12px',
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    outline: 'none',
  },
  goBtn: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '0 16px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    WebkitTapHighlightColor: 'transparent',
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '260px',
    overflowY: 'auto',
  },
  resultItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    textAlign: 'left',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  resultName: {
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  resultMeta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
  },
  error: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--red)',
    background: 'rgba(239,68,68,0.08)',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(239,68,68,0.2)',
  },
};
