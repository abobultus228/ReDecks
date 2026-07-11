import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import { CardZoomProvider, useCardZoom, isVideoUrl, CardBadges, toAwakening, type CardAwakening } from '../components/CardGallery';
import { SortFilter, CardsFilter, buildInvFilters, DEFAULT_FILTERS, type FiltersState } from '../components/ExchangeFilters';
import {
  getUserProfile,
  getInventoryCards,
  createExchange,
  resolveMediaUrl,
  type InventoryGroup,
} from '../api/extra';

export interface BuilderPartner {
  id: number;
  name: string;
  avatarMid: string; // уже абсолютный URL
}

type Side = 'creator' | 'partner';

/** Ячейка инвентаря: либо стопка непробуждённых копий, либо одна пробуждённая карта. */
interface CellSpec {
  key: string;            // "tpl:<cardId>" для стопки, "inst:<instanceId>" для пробуждённой
  coverMid: string;
  coverHigh: string;
  instanceIds: number[];  // доступные id физических карт
  awakening: CardAwakening | null;
}

interface Sel extends CellSpec {
  count: number;
}

interface InvState {
  groups: InventoryGroup[];
  page: number;
  hasMore: boolean;
  loading: boolean;
  error: string;
}

const emptyInv = (): InvState => ({ groups: [], page: 0, hasMore: true, loading: false, error: '' });

/**
 * Разбивает группу инвентаря на ячейки: непробуждённые копии — одной стопкой,
 * каждая пробуждённая карта — отдельной ячейкой (у неё свои характеристики).
 */
function cellsFromGroup(g: InventoryGroup): CellSpec[] {
  const mid = resolveMediaUrl(g.card.cover?.mid || g.card.cover?.high || '');
  const high = resolveMediaUrl(g.card.cover?.high || g.card.cover?.mid || '');
  const list = g.cards ?? [];
  const plain = list.filter((c) => !c.is_awakened);
  const awakened = list.filter((c) => c.is_awakened);

  const cells: CellSpec[] = [];
  if (plain.length) {
    cells.push({ key: `tpl:${g.card.id}`, coverMid: mid, coverHigh: high, instanceIds: plain.map((c) => c.id), awakening: null });
  }
  for (const inst of awakened) {
    cells.push({ key: `inst:${inst.id}`, coverMid: mid, coverHigh: high, instanceIds: [inst.id], awakening: toAwakening(inst) });
  }
  return cells;
}

// ─── Медиа ────────────────────────────────────────────────────────────────────

function Avatar({ url }: { url: string }) {
  const [err, setErr] = useState(false);
  const isVid = Boolean(url) && !err && isVideoUrl(url);
  if (!url || err) return <div style={{ ...st.avatar, ...st.avatarEmpty }} />;
  if (isVid) return <video src={url} style={st.avatar} autoPlay loop muted playsInline onError={() => setErr(true)} />;
  return <img src={url} style={st.avatar} onError={() => setErr(true)} alt="" />;
}

function CardCell({
  mid, high, awakening, count, available, onDec, onInc,
}: {
  mid: string; high: string; awakening: CardAwakening | null; count: number; available: number;
  onDec: () => void; onInc: () => void;
}) {
  const zoom = useCardZoom();
  const vid = isVideoUrl(mid);
  return (
    <div style={st.cell}>
      <div style={st.cellImg} onClick={() => zoom(high || mid, awakening)}>
        {vid ? (
          <video src={mid} style={st.cellMedia} autoPlay loop muted playsInline />
        ) : (
          <img src={mid} style={st.cellMedia} loading="lazy" alt="" />
        )}
        <CardBadges awakening={awakening} />
      </div>
      <div style={st.ctrl}>
        <button style={{ ...st.ctrlBtn, ...(count <= 0 ? st.ctrlDisabled : {}) }} onClick={onDec} disabled={count <= 0}>−</button>
        <span style={st.ctrlCount}>{count}/{available}</span>
        <button style={{ ...st.ctrlBtn, ...(count >= available ? st.ctrlDisabled : {}) }} onClick={onInc} disabled={count >= available}>+</button>
      </div>
    </div>
  );
}

function FormGrid({ sels, onChange }: { sels: Record<string, Sel>; onChange: (spec: CellSpec, delta: number) => void }) {
  const items = Object.values(sels);
  if (items.length === 0) return <div style={st.formEmpty}>Карты не выбраны</div>;
  return (
    <div style={st.grid}>
      {items.map((sel) => (
        <CardCell
          key={sel.key}
          mid={sel.coverMid}
          high={sel.coverHigh}
          awakening={sel.awakening}
          count={sel.count}
          available={sel.instanceIds.length}
          onDec={() => onChange(sel, -1)}
          onInc={() => onChange(sel, +1)}
        />
      ))}
    </div>
  );
}

// ─── Страница ─────────────────────────────────────────────────────────────────

export default function ExchangeBuilder({
  partner, onBack, onSent,
}: {
  partner: BuilderPartner; onBack: () => void; onSent: () => void;
}) {
  const token = useAppStore((s) => s.token);
  const ourId = useAppStore((s) => s.userId);

  const [me, setMe] = useState<{ name: string; avatar: string } | null>(null);
  const [selCreator, setSelCreator] = useState<Record<string, Sel>>({});
  const [selPartner, setSelPartner] = useState<Record<string, Sel>>({});
  const [active, setActive] = useState<Side>('creator');
  const [inv, setInv] = useState<{ creator: InvState; partner: InvState }>({ creator: emptyInv(), partner: emptyInv() });
  const [filters, setFilters] = useState<FiltersState>(DEFAULT_FILTERS);

  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const loadingRef = useRef<{ creator: boolean; partner: boolean }>({ creator: false, partner: false });
  const filterVerRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // наш профиль (аватар + ник)
  useEffect(() => {
    let alive = true;
    getUserProfile(token, Number(ourId))
      .then((p) => { if (alive) setMe({ name: p.username || `ID ${ourId}`, avatar: p.avatarUrl || '' }); })
      .catch(() => { if (alive) setMe({ name: `ID ${ourId}`, avatar: '' }); });
    return () => { alive = false; };
  }, [token, ourId]);

  const sideUserId = (side: Side) => (side === 'creator' ? ourId : partner.id);

  const loadInv = useCallback(
    async (side: Side) => {
      const cur = inv[side];
      if (loadingRef.current[side] || !cur.hasMore) return;
      loadingRef.current[side] = true;
      const ver = filterVerRef.current;
      setInv((prev) => ({ ...prev, [side]: { ...prev[side], loading: true, error: '' } }));
      try {
        const next = cur.page + 1;
        const invFilters = buildInvFilters(filters, side, Number(ourId), partner.id);
        const { results, hasMore } = await getInventoryCards(token, sideUserId(side), next, invFilters);
        if (ver !== filterVerRef.current) return; // фильтры сменились — ответ устарел
        setInv((prev) => {
          const c = prev[side];
          const seen = new Set(c.groups.map((g) => g.card.id));
          const add = results.filter((g) => !seen.has(g.card.id));
          return { ...prev, [side]: { groups: [...c.groups, ...add], page: next, hasMore, loading: false, error: '' } };
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (ver === filterVerRef.current) setInv((prev) => ({ ...prev, [side]: { ...prev[side], loading: false, error: msg } }));
      } finally {
        if (ver === filterVerRef.current) loadingRef.current[side] = false;
      }
    },
    [inv, token, partner.id, ourId, filters]
  );

  // смена фильтров: сбрасываем обе стороны и грузим заново с новыми параметрами
  const applyFilters = (f: FiltersState) => {
    setFilters(f);
    filterVerRef.current += 1;
    loadingRef.current = { creator: false, partner: false };
    setInv({ creator: emptyInv(), partner: emptyInv() });
  };

  // первая страница активной стороны, если ещё не грузили
  useEffect(() => {
    const cur = inv[active];
    if (cur.page === 0 && cur.hasMore && !cur.error && !loadingRef.current[active]) void loadInv(active);
  }, [active, inv, loadInv]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) void loadInv(active);
  };

  const adjust = (side: Side, spec: CellSpec, delta: number) => {
    const setSel = side === 'creator' ? setSelCreator : setSelPartner;
    setSel((prev) => {
      const base: Sel = prev[spec.key] ?? { ...spec, count: 0 };
      const count = Math.max(0, Math.min(base.count + delta, base.instanceIds.length));
      const next = { ...prev };
      if (count <= 0) delete next[spec.key];
      else next[spec.key] = { ...base, count };
      return next;
    });
  };

  const creatorCards = Object.values(selCreator).flatMap((s) => s.instanceIds.slice(0, s.count));
  const partnerCards = Object.values(selPartner).flatMap((s) => s.instanceIds.slice(0, s.count));
  const canSend = creatorCards.length >= 1 && partnerCards.length >= 1;

  const send = async () => {
    setSending(true);
    setSendError('');
    try {
      await createExchange(token, ourId, { partner: partner.id, creatorCards, partnerCards, message: '' });
      setConfirm(false);
      onSent();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const activeInv = inv[active];
  const activeSel = active === 'creator' ? selCreator : selPartner;

  return (
    <CardZoomProvider>
      <div style={st.scroll} ref={scrollRef} onScroll={onScroll}>
        <PageHeader title="Новый обмен" sub={partner.name} />
        <div style={st.content}>
          <button style={st.back} onClick={onBack}>← Назад</button>

        {/* наша шапка + отправить */}
        <div style={st.headerRow}>
          <div style={st.person}>
            <Avatar url={me?.avatar ?? ''} />
            <span style={st.personName}>{me?.name ?? '…'}</span>
          </div>
          <button
            style={{ ...st.sendBtn, ...(canSend && !sending ? {} : st.sendDisabled) }}
            onClick={() => setConfirm(true)}
            disabled={!canSend || sending}
          >
            Отправить обмен
          </button>
        </div>

        <div style={st.sectionLabel}>Вы отдаёте</div>
        <FormGrid sels={selCreator} onChange={(spec, d) => adjust('creator', spec, d)} />

        {/* партнёр */}
        <div style={{ ...st.person, marginTop: '6px' }}>
          <Avatar url={partner.avatarMid} />
          <span style={st.personName}>{partner.name}</span>
        </div>
        <div style={st.sectionLabel}>Вы получаете</div>
        <FormGrid sels={selPartner} onChange={(spec, d) => adjust('partner', spec, d)} />

        {/* переключатели инвентаря */}
        <div style={st.toggles}>
          <button style={{ ...st.toggle, ...(active === 'creator' ? st.toggleOn : {}) }} onClick={() => setActive('creator')}>
            Ваш инвентарь
          </button>
          <button style={{ ...st.toggle, ...(active === 'partner' ? st.toggleOn : {}) }} onClick={() => setActive('partner')}>
            Инвентарь {partner.name}
          </button>
        </div>

        {/* фильтры: слева сортировка, справа набор фильтров */}
        <div style={st.filters}>
          <SortFilter value={filters} onChange={applyFilters} />
          <CardsFilter value={filters} onChange={applyFilters} side={active} partnerName={partner.name} />
        </div>

        {/* инвентарь активной стороны */}
        <div style={st.grid}>
          {activeInv.groups.flatMap(cellsFromGroup).map((spec) => {
            const count = activeSel[spec.key]?.count ?? 0;
            return (
              <CardCell
                key={spec.key}
                mid={spec.coverMid}
                high={spec.coverHigh}
                awakening={spec.awakening}
                count={count}
                available={spec.instanceIds.length}
                onDec={() => adjust(active, spec, -1)}
                onInc={() => adjust(active, spec, +1)}
              />
            );
          })}
        </div>

        {activeInv.loading && (
          <div style={st.statusRow}><span style={st.spinner} /><span style={st.statusText}>Загрузка…</span></div>
        )}
        {activeInv.error && (
          <div style={st.errorBox}>
            <span style={st.errorText}>{activeInv.error}</span>
            <button style={st.retryBtn} onClick={() => loadInv(active)}>Повторить</button>
          </div>
        )}
        {!activeInv.loading && !activeInv.error && !activeInv.hasMore && activeInv.groups.length === 0 && (
          <p style={st.empty}>Инвентарь пуст.</p>
        )}
        {!activeInv.loading && !activeInv.error && !activeInv.hasMore && activeInv.groups.length > 0 && (
          <p style={st.endNote}>Это весь инвентарь.</p>
        )}
        </div>
      </div>

      {confirm && (
        <div style={st.modalBackdrop} onClick={() => !sending && setConfirm(false)}>
          <div style={st.modal} onClick={(e) => e.stopPropagation()}>
            <p style={st.modalText}>
              Отправить обмен пользователю <b>{partner.name}</b>?<br />
              Отдаёте: {creatorCards.length} · Получаете: {partnerCards.length}
            </p>
            {sendError && <p style={st.modalError}>{sendError}</p>}
            <div style={st.modalRow}>
              <button style={st.modalCancel} onClick={() => setConfirm(false)} disabled={sending}>Отмена</button>
              <button style={st.modalConfirm} onClick={send} disabled={sending}>
                {sending ? 'Отправка…' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </CardZoomProvider>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const st: Record<string, React.CSSProperties> = {
  // вся страница — единый скролл; хедер внутри него, поэтому уезжает вместе с контентом
  scroll: {
    height: '100%',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: 'var(--bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  content: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  back: {
    alignSelf: 'flex-start',
    background: 'none',
    border: 'none',
    color: 'var(--text2)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    padding: '2px 0',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  headerRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  person: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 },
  personName: {
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  avatar: { width: '40px', height: '40px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' },
  avatarEmpty: { border: '1px solid var(--border)' },

  sendBtn: {
    flexShrink: 0, background: 'var(--accent)', color: '#fff', border: 'none',
    borderRadius: 'var(--radius-sm)', padding: '11px 14px',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  sendDisabled: { opacity: 0.4, cursor: 'not-allowed' },

  sectionLabel: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', letterSpacing: '0.02em' },

  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' },
  formEmpty: {
    fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)',
    padding: '14px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-sm)',
  },

  cell: { display: 'flex', flexDirection: 'column', gap: '4px' },
  cellImg: {
    aspectRatio: '2 / 3', borderRadius: '8px', overflow: 'hidden',
    background: 'var(--bg3)', border: '1px solid var(--border)', cursor: 'pointer',
    position: 'relative',
  },
  cellMedia: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  ctrl: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2px' },
  ctrlBtn: {
    width: '24px', height: '24px', flexShrink: 0, borderRadius: '6px',
    border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)',
    fontSize: '15px', lineHeight: 1, cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent',
  },
  ctrlDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  ctrlCount: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },

  toggles: { display: 'flex', gap: '6px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px', marginTop: '4px' },
  toggle: {
    flex: 1, background: 'transparent', color: 'var(--text2)', border: 'none', borderRadius: '6px',
    padding: '9px 6px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    WebkitTapHighlightColor: 'transparent',
  },
  toggleOn: { background: 'var(--accent)', color: '#fff' },

  filters: { display: 'flex', gap: '8px' },
  filterStub: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text3)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '12px',
    padding: '9px', cursor: 'not-allowed', opacity: 0.7,
  },

  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px' },
  spinner: { width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-active)', borderTopColor: 'var(--accent)', animation: 'redecks-spin 0.7s linear infinite' },
  statusText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },
  errorBox: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '12px 14px' },
  errorText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', lineHeight: 1.4 },
  retryBtn: { flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', color: '#fff', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', cursor: 'pointer' },
  endNote: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '16px 0' },

  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  modal: { width: '100%', maxWidth: '340px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px' },
  modalText: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text)', lineHeight: 1.5, margin: '0 0 12px' },
  modalError: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', margin: '0 0 10px' },
  modalRow: { display: 'flex', gap: '10px' },
  modalCancel: { flex: 1, background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' },
  modalConfirm: { flex: 1, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' },
};
