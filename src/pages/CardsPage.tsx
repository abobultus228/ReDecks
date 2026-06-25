import { useMemo, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { useAppStore } from '../store';
import TitlePicker from '../components/TitlePicker';
import {
  getTitleContent,
  getCharacters,
  getCardsTotal,
  CHARACTER_URL,
  RateLimitError,
} from '../api/extra';

// Тайминги запроса карт по персонажам
const REQUEST_DELAY = 400;     // стартовая пауза между запросами, мс
const MAX_REQUEST_DELAY = 1500;// потолок адаптивной паузы, мс
const RATE_LIMIT_PAUSE = 3000; // пауза при ошибке 429, мс
const MAX_RETRIES = 10;        // сколько раз повторять один запрос при 429

// 429 определяем устойчиво: и по классу ошибки, и по тексту — чтобы
// повтор срабатывал даже если ошибка прилетела другим типом.
function isRateLimit(e: unknown): boolean {
  if (e instanceof RateLimitError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('429');
}

interface CharRow {
  id: number;
  name: string;
  total: number;
}

type Phase = 'pick' | 'loading' | 'list';

export default function CardsPage() {
  const token = useAppStore((s) => s.token);
  const [phase, setPhase] = useState<Phase>('pick');
  const [titleLabel, setTitleLabel] = useState('');
  const [rows, setRows] = useState<CharRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [rateLimited, setRateLimited] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Границы фильтра
  const maxTotal = useMemo(
    () => rows.reduce((m, r) => Math.max(m, r.total), 0),
    [rows]
  );
  const [minVal, setMinVal] = useState(0);
  const [maxVal, setMaxVal] = useState(0);
  const [filterOn, setFilterOn] = useState(false);

  const reset = () => {
    setPhase('pick');
    setRows([]);
    setError('');
    setTitleLabel('');
    setFilterOn(false);
  };

  const handlePick = async (slug: string, label: string) => {
    setBusy(true);
    setTitleLabel(label);
    setError('');
    setPhase('loading');
    setRows([]);
    setRateLimited(false);
    setProgress({ done: 0, total: 0 });
    try {
      const content = await getTitleContent(token, slug);
      const chars = await getCharacters(token, content);
      const valid = chars.filter((c) => c.id != null);
      if (!valid.length) {
        setError('Персонажи не найдены.');
        setPhase('pick');
        return;
      }
      setProgress({ done: 0, total: valid.length });

      const collected: CharRow[] = [];
      let delay = REQUEST_DELAY; // адаптивно растёт после каждого 429

      for (let i = 0; i < valid.length; i++) {
        const c = valid[i];
        let total = 0;

        // Повторяем запрос при 429 с паузой; остальные ошибки -> 0 карт
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            total = await getCardsTotal(token, c.id);
            break;
          } catch (e) {
            if (isRateLimit(e) && attempt < MAX_RETRIES) {
              setRateLimited(true);
              delay = Math.min(delay + 150, MAX_REQUEST_DELAY); // замедляемся
              await sleep(RATE_LIMIT_PAUSE);
              setRateLimited(false);
              continue; // повторяем того же персонажа
            }
            total = 0;
            break;
          }
        }

        collected.push({ id: c.id, name: c.name || 'Без имени', total });
        setProgress({ done: i + 1, total: valid.length });
        if (i < valid.length - 1) await sleep(delay);
      }

      collected.sort((a, b) => b.total - a.total);
      setRows(collected);
      const hi = collected.reduce((m, r) => Math.max(m, r.total), 0);
      setMinVal(0);
      setMaxVal(hi);
      setPhase('list');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    if (!filterOn) return rows;
    return rows.filter((r) => r.total >= minVal && r.total <= maxVal);
  }, [rows, filterOn, minVal, maxVal]);

  const openLink = (id: number) => { void Browser.open({ url: CHARACTER_URL(id) }); };

  // безопасно держим min<=max
  const setMin = (v: number) => setMinVal(Math.min(v, maxVal));
  const setMax = (v: number) => setMaxVal(Math.max(v, minVal));

  return (
    <div style={p.root}>
      <div style={p.header}>
        <div>
          <div style={p.title}>Карты персонажей</div>
          <div style={p.sub}>сколько карт у каждого</div>
        </div>
        {phase !== 'pick' && (
          <button style={p.resetBtn} onClick={reset}>другой тайтл</button>
        )}
      </div>

      <div style={p.scroll}>
        {phase === 'pick' && (
          <>
            <Card title="Тайтл">
              <TitlePicker busy={busy} onPick={handlePick} />
            </Card>
            {error && <p style={p.error}>{error}</p>}
            <p style={p.note}>
              Покажет всех персонажей тайтла и количество карт у каждого.
              Можно отфильтровать по числу карт.
            </p>
          </>
        )}

        {phase === 'loading' && (
          <Card title={titleLabel}>
            <div style={p.statusRow}>
              <span style={p.spinner} />
              <span style={p.statusText}>
                Загружаю карты: {progress.done} / {progress.total}
              </span>
            </div>
            {rateLimited && (
              <div style={p.rateLimit}>
                Лимит запросов (429) — пауза 3 сек, затем продолжу...
              </div>
            )}
            <div style={p.progressTrack}>
              <div
                style={{
                  ...p.progressFill,
                  width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%',
                }}
              />
            </div>
          </Card>
        )}

        {phase === 'list' && (
          <>
            <Card
              title="Фильтр по количеству карт"
              action={
                <button
                  style={{ ...p.filterToggle, ...(filterOn ? p.filterToggleOn : {}) }}
                  onClick={() => setFilterOn((v) => !v)}
                >
                  {filterOn ? 'вкл' : 'выкл'}
                </button>
              }
            >
              <div style={{ opacity: filterOn ? 1 : 0.45, pointerEvents: filterOn ? 'auto' : 'none', transition: 'opacity 0.15s' }}>
                <div style={p.fromToRow}>
                  <NumField label="от" value={minVal} onChange={setMin} max={maxTotal} />
                  <NumField label="до" value={maxVal} onChange={setMax} max={maxTotal} />
                </div>

                <div style={p.sliders}>
                  <input
                    type="range" min={0} max={maxTotal} value={minVal}
                    onChange={(e) => setMin(Number(e.target.value))}
                    style={p.range}
                  />
                  <input
                    type="range" min={0} max={maxTotal} value={maxVal}
                    onChange={(e) => setMax(Number(e.target.value))}
                    style={p.range}
                  />
                </div>
                <div style={p.rangeHint}>диапазон: {minVal} – {maxVal} карт</div>
              </div>
            </Card>

            <Card
              title="Персонажи"
              action={<span style={p.countBadge}>{filtered.length} / {rows.length}</span>}
            >
              <div style={p.list}>
                {filtered.length === 0 ? (
                  <p style={p.empty}>Никто не подходит под фильтр.</p>
                ) : (
                  filtered.map((r) => (
                    <button key={r.id} style={p.charItem} onClick={() => openLink(r.id)}>
                      <div style={p.charLeft}>
                        <span style={p.charName}>{r.name}</span>
                        <span style={p.charLink}>открыть на remanga ↗</span>
                      </div>
                      <span style={p.charTotal}>{r.total}</span>
                    </button>
                  ))
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max: number }) {
  return (
    <div style={p.numField}>
      <span style={p.numLabel}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={0}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          onChange(isNaN(v) ? 0 : Math.max(0, Math.min(v, max)));
        }}
        style={p.numInput}
      />
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={p.card}>
      <div style={p.cardHeader}>
        <span style={p.cardTitle}>{title}</span>
        {action}
      </div>
      <div style={p.cardBody}>{children}</div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  progressTrack: { marginTop: '12px', height: '6px', borderRadius: '3px', background: 'var(--bg3)', overflow: 'hidden' },
  rateLimit: { marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--yellow)', background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' },
  progressFill: { height: '100%', background: 'var(--accent)', transition: 'width 0.2s' },
  filterToggle: {
    fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px',
    padding: '4px 10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  filterToggleOn: { color: 'var(--accent)', background: 'rgba(139,92,246,0.12)', border: '1px solid var(--border-active)' },
  fromToRow: { display: 'flex', gap: '10px' },
  numField: { flex: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' },
  numLabel: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)' },
  numInput: { flex: 1, minWidth: 0, width: '100%', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', textAlign: 'right' },
  sliders: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' },
  range: { width: '100%', accentColor: 'var(--accent)' },
  rangeHint: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '8px', textAlign: 'center' },
  countBadge: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent)' },
  list: { display: 'flex', flexDirection: 'column', gap: '6px' },
  charItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '11px 14px', cursor: 'pointer', width: '100%', textAlign: 'left',
    WebkitTapHighlightColor: 'transparent',
  },
  charLeft: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  charName: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  charLink: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text3)' },
  charTotal: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', color: 'var(--accent)', marginLeft: '12px', flexShrink: 0 },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '8px 0' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.2)' },
};
