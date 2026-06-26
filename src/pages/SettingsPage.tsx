import { useState } from 'react';
import { useAppStore } from '../store';
import { getRareCollections, getAvailableDeckTypes } from '../api/remanga';
import type { Collection, DeckType } from '../types';
import PageHeader from '../components/PageHeader';

interface Props {
  onStart: () => void;
}

type RuleOption = { value: number; label: string };

const PRIORITY_OWNED_OPTS: RuleOption[] = [
  { value: 1, label: 'Ручной выбор' },
  { value: 2, label: 'Взять неприоритетную новую, иначе приоритетную' },
  { value: 3, label: 'Всё равно взять приоритетную' },
];
const SAME_PRIORITY_OPTS: RuleOption[] = [
  { value: 1, label: 'Ручной выбор' },
  { value: 2, label: 'Выбрать случайную приоритетную' },
];
const NO_PRIORITY_OPTS: RuleOption[] = [
  { value: 1, label: 'Ручной выбор' },
  { value: 2, label: 'Взять новую неприоритетную, иначе рандом' },
];

export default function SettingsPage({ onStart }: Props) {
  const store = useAppStore();
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [err, setErr] = useState('');

  const userId = parseInt(store.userId, 10);

  const handleLoadCollections = async () => {
    if (!store.token || isNaN(userId)) { setErr('Нет токена или User ID'); return; }
    setErr('');
    setLoadingCollections(true);
    try {
      const cols = await getRareCollections(store.token, userId);
      store.setCollections(cols);
      if (cols.length > 0 && !store.selectedCollectionId) {
        store.setSelectedCollectionId(cols[0].id);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки коллекций');
    } finally {
      setLoadingCollections(false);
    }
  };

  const handleLoadDecks = async () => {
    if (!store.token || isNaN(userId)) { setErr('Нет токена или User ID'); return; }
    setErr('');
    setLoadingDecks(true);
    try {
      const decks = await getAvailableDeckTypes(store.token, userId);
      store.setAvailableDecks(decks);
      if (decks.length > 0 && !store.selectedDeckId) {
        store.setSelectedDeckId(decks[0].id);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки колод');
    } finally {
      setLoadingDecks(false);
    }
  };

  const handleStart = () => {
    const config = store.buildConfig();
    if (!config) { setErr('Выбери коллекцию и колоду'); return; }
    store.saveSettings();
    onStart();
  };

  return (
    <div style={styles.root}>
      <PageHeader title="Открытие колод" sub="настройки" />

      {/* Scrollable content */}
      <div style={styles.scroll}>

        {/* Account info */}
        <Section title="Аккаунт">
          <InfoRow label="User ID" value={store.userId} />
          <Toggle
            label="Премиум аккаунт"
            checked={store.isPremium}
            onChange={store.setIsPremium}
          />
        </Section>

        {/* Collections */}
        <Section
          title="Коллекция"
          action={
            <LoadBtn loading={loadingCollections} onClick={handleLoadCollections}>
              {store.collections.length > 0 ? '↻ обновить' : 'загрузить'}
            </LoadBtn>
          }
        >
          {store.collections.length === 0 ? (
            <EmptyHint>Нажми «загрузить» для получения коллекций</EmptyHint>
          ) : (
            <SelectList
              items={store.collections}
              selectedId={store.selectedCollectionId}
              getLabel={(c: Collection) => {
                const name = c.name ?? c.title ?? `id=${c.id}`;
                return c.percent != null ? `${name} — ${Math.floor(c.percent)}%` : name;
              }}
              getId={(c: Collection) => c.id}
              onSelect={(id) => store.setSelectedCollectionId(id)}
            />
          )}
        </Section>

        {/* Decks */}
        <Section
          title="Колода"
          action={
            <LoadBtn loading={loadingDecks} onClick={handleLoadDecks}>
              {store.availableDecks.length > 0 ? '↻ обновить' : 'загрузить'}
            </LoadBtn>
          }
        >
          {store.availableDecks.length === 0 ? (
            <EmptyHint>Нажми «загрузить» для получения колод</EmptyHint>
          ) : (
            <SelectList
              items={store.availableDecks}
              selectedId={store.selectedDeckId}
              getLabel={(d: DeckType) => `${d.name} (×${d.count})`}
              getId={(d: DeckType) => d.id}
              onSelect={(id) => store.setSelectedDeckId(id as number)}
            />
          )}
        </Section>

        {/* Count */}
        <Section title="Сколько открыть">
          <div style={styles.countRow}>
              <button style={styles.countBtn} onClick={() => store.setOpenCount(Math.max(0, store.openCount - 1))}>−</button>
              <input
                style={styles.countVal}
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={store.openCount === 0 ? '' : store.openCount}
                placeholder="все"
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  store.setOpenCount(isNaN(v) || v < 0 ? 0 : v);
                }}
              />
              <button style={styles.countBtn} onClick={() => store.setOpenCount(store.openCount + 1)}>+</button>
            </div>
          <p style={styles.countHint}>0 = открыть все доступные</p>
        </Section>

        {/* Rules */}
        <Section title="Правила выбора">
          <RuleRow
            label="Приоритетные выпали, но уже в наличии:"
            opts={PRIORITY_OWNED_OPTS}
            value={store.priorityOwnedRule}
            onChange={v => store.setPriorityOwnedRule(v as 1 | 2 | 3)}
          />
          <RuleRow
            label="Несколько приоритетных одного статуса:"
            opts={SAME_PRIORITY_OPTS}
            value={store.sameOrPriorityRule}
            onChange={v => store.setSameOrPriorityRule(v as 1 | 2)}
          />
          <RuleRow
            label="Нет приоритетных среди выпавших:"
            opts={NO_PRIORITY_OPTS}
            value={store.noPriorityRule}
            onChange={v => store.setNoPriorityRule(v as 1 | 2)}
          />
        </Section>

        {err && <p style={styles.error}>{err}</p>}

      </div>

      {/* Bottom bar */}
      <div style={styles.bottomBar}>
        <button style={styles.startBtn} onClick={handleStart}>
          Запустить
        </button>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={sectionStyles.root}>
      <div style={sectionStyles.header}>
        <span style={sectionStyles.title}>{title}</span>
        {action}
      </div>
      <div style={sectionStyles.body}>{children}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyles.root}>
      <span style={rowStyles.label}>{label}</span>
      <span style={rowStyles.value}>{value}</span>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={rowStyles.root} onClick={() => onChange(!checked)}>
      <span style={rowStyles.label}>{label}</span>
      <div style={{ ...toggleStyles.track, background: checked ? 'var(--accent)' : 'var(--bg3)' }}>
        <div style={{ ...toggleStyles.thumb, transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
      </div>
    </div>
  );
}

function LoadBtn({ loading, onClick, children }: { loading: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      style={{ ...sectionStyles.loadBtn, opacity: loading ? 0.5 : 1 }}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? '...' : children}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p style={{ fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', padding: '4px 0' }}>{children}</p>;
}

function SelectList<T>({
  items, selectedId, getLabel, getId, onSelect
}: {
  items: T[];
  selectedId: number | string | null;
  getLabel: (item: T) => string;
  getId: (item: T) => number | string;
  onSelect: (id: number | string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {items.map((item) => {
        const id = getId(item);
        const active = String(id) === String(selectedId);
        return (
          <div
            key={String(id)}
            style={{
              ...selectStyles.item,
              background: active ? 'rgba(139,92,246,0.1)' : 'var(--bg3)',
              border: `1px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
            }}
            onClick={() => onSelect(id)}
          >
            <div style={{ ...selectStyles.dot, background: active ? 'var(--accent)' : 'var(--text3)' }} />
            <span style={{ ...selectStyles.label, color: active ? 'var(--text)' : 'var(--text2)' }}>
              {getLabel(item)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RuleRow({ label, opts, value, onChange }: {
  label: string;
  opts: RuleOption[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={ruleStyles.root}>
      <p style={ruleStyles.label}>{label}</p>
      <div style={ruleStyles.opts}>
        {opts.map(opt => (
          <div
            key={opt.value}
            style={{
              ...ruleStyles.opt,
              background: value === opt.value ? 'rgba(139,92,246,0.15)' : 'var(--bg3)',
              border: `1px solid ${value === opt.value ? 'var(--border-active)' : 'var(--border)'}`,
              color: value === opt.value ? 'var(--text)' : 'var(--text2)',
            }}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  root: {
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
      position: 'relative',
      overflow: 'hidden',
    },
  header: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '20px',
    letterSpacing: '-0.02em',
    color: 'var(--text)',
  },
  headerSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--accent)',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginTop: '2px',
  },
  logoutBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text3)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  scroll: {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      padding: '16px 16px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
  countRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
  },
  countBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-display)',
    fontSize: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    WebkitTapHighlightColor: 'transparent',
  },
    countVal: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: '28px',
      color: 'var(--text)',
      minWidth: '60px',
      width: '60px',
      textAlign: 'center',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      WebkitTapHighlightColor: 'transparent',
      MozAppearance: 'textfield' as any,
    },
  countHint: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    marginTop: '4px',
  },
  bottomBar: {
    padding: '12px 16px',
    background: 'var(--bg)',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  startBtn: {
    width: '100%',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '16px',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '16px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
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

const sectionStyles: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'visible',
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  body: {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  loadBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--accent)',
    background: 'rgba(139,92,246,0.1)',
    border: '1px solid var(--border-active)',
    borderRadius: '6px',
    padding: '4px 10px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
};

const rowStyles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    color: 'var(--text2)',
  },
  value: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    color: 'var(--text)',
  },
};

const toggleStyles: Record<string, React.CSSProperties> = {
  track: {
    width: '42px',
    height: '24px',
    borderRadius: '12px',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.2s',
    cursor: 'pointer',
  },
  thumb: {
    position: 'absolute',
    top: '2px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.2s',
  },
};

const selectStyles: Record<string, React.CSSProperties> = {
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'background 0.1s',
    WebkitTapHighlightColor: 'transparent',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.1s',
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    lineHeight: 1.3,
  },
};

const ruleStyles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    color: 'var(--text2)',
    lineHeight: 1.4,
  },
  opts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  opt: {
    padding: '9px 12px',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background 0.1s, border-color 0.1s',
    WebkitTapHighlightColor: 'transparent',
  },
};
