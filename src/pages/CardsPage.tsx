import { useMemo, useState } from 'react';
import { Browser } from '@capacitor/browser';
import { useAppStore } from '../store';
import TitlePicker from '../components/TitlePicker';
import PageHeader from '../components/PageHeader';
import {
  getTitleContent,
  getCharacters,
  getCardsTotal,
  CHARACTER_URL,
} from '../api/extra';

// Тайминги запроса карт по персонажам
const REQUEST_DELAY = 400;     // стартовая пауза между запросами, мс
const MAX_REQUEST_DELAY = 1500;// потолок адаптивной паузы, мс
const RATE_LIMIT_PAUSE = 3000; // пауза после ошибки (в т.ч. 429), мс
const MAX_RETRIES = 8;         // сколько раз повторять запрос по одному персонажу

interface CharRow {
  id: number;
  name: string;
  total: number;
  failed?: boolean; // запрос не удался даже после всех повторов
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

  const recalcBounds = (data: CharRow[]) => {
    const hi = data.reduce((m, r) => Math.max(m, r.total), 0);
    setMinVal(0);
    setMaxVal(hi);
  };

  /**
   * Запрашивает количество карт для списка персонажей.
   * Повтор делается на ЛЮБУЮ ошибку (а не только распознанный 429),
   * с паузой и адаптивным замедлением. Если после всех повторов запрос
   * так и не прошёл — персонаж помечается failed (а не молчаливым 0).
   */
  const loadFor = async (targets: { id: number; name: string }[]): Promise<CharRow[]> => {
    const out: CharRow[] = [];
    let delay = REQUEST_DELAY;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      let total = 0;
      let failed = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          total = await getCardsTotal(token, t.id);
          failed = false;
          break;
        } catch {
          if (attempt < MAX_RETRIES) {
            setRateLimited(true);
            delay = Math.min(delay + 150, MAX_REQUEST_DELAY); // замедляемся
            await sleep(RATE_LIMIT_PAUSE);
            setRateLimited(false);
            continue; // повторяем того же персонажа
          }
          total = 0;
          failed = true;
        }
      }

      out.push({ id: t.id, name: t.name, total, failed });
      setProgress({ done: i + 1, total: targets.length });
      if (i < targets.length - 1) await sleep(delay);
    }

    return out;
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
      const valid = chars
        .filter((c) => c.id != null)
        .map((c) => ({ id: c.id, name: c.name || 'Без имени' }));
      if (!valid.length) {
        setError('Персонажи не найдены.');
        setPhase('pick');
        return;
      }
      setProgress({ done: 0, total: valid.length });

      const collected = await loadFor(valid);
      collected.sort((a, b) => b.total - a.total);
      setRows(collected);
      recalcBounds(collected);
      setPhase('list');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('pick');
    } finally {
      setBusy(false);
    }
  };

  const retryFailed = async () => {
    const targets = rows.filter((r) => r.failed).map((r) => ({ id: r.id, name: r.name }));
    if (!targets.length) return;
    setBusy(true);
    setRateLimited(false);
    setProgress({ done: 0, total: targets.length });
    setPhase('loading');
    try {
      const fixed = await loadFor(targets);
      const byId = new Map(fixed.map((r) => [r.id, r]));
      const merged = rows.map((r) => byId.get(r.id) ?? r);
      merged.sort((a, b) => b.total - a.total);
      setRows(merged);
      recalcBounds(merged);
    } finally {
      setPhase('list');
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    if (!filterOn) return rows;
    return rows.filter((r) => r.total >= minVal && r.total <= maxVal);
  }, [rows, filterOn, minVal, maxVal]);

  const failedCount = useMemo(() => rows.filter((r) => r.failed).length, [rows]);

  const openLink = (id: number) => { void Browser.open({ url: CHARACTER_URL(id) }); };

  // безопасно держим min<=max
  const setMin = (v: number) => setMinVal(Math.min(v, maxVal));
  const setMax = (v: number) => setMaxVal(Math.max(v, minVal));

  return (
    <div style={p.root}>
      <PageHeader
        title="Персонажи"
        sub="сколько карт у каждого"
        action={phase !== 'pick'
          ? <button style={p.resetBtn} onClick={reset}>другой тайтл</button>
          : undefined}
      />

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
                Сервер не ответил (лимит запросов?) — пауза, повторяю...
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
            {failedCount > 0 && (
              <div style={p.failBanner}>
                <span style={p.failText}>
                  {failedCount} персонажей не загрузились (ошибка запроса).
                </span>
                <button style={p.failBtn} onClick={retryFailed} disabled={busy}>
                  Повторить ошибки
                </button>
              </div>
            )}

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
                        <span style={p.charLink}>
                          {r.failed ? 'ошибка загрузки' : 'открыть на remanga ↗'}
                        </span>
                      </div>
                      <span style={{ ...p.charTotal, color: r.failed ? 'var(--red)' : 'var(--accent)' }}>
                        {r.failed ? '—' : r.total}
                      </span>
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
  failBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '12px 14px', flexShrink: 0 },
  failText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', lineHeight: 1.4 },
  failBtn: { flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#fff', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
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
