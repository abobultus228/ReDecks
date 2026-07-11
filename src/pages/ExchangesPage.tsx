import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import ExchangeBuilder, { type BuilderPartner } from './ExchangeBuilder';
import { toAwakening, CardBadges, AwakenedBoxes, type CardAwakening } from '../components/CardGallery';
import {
  getExchanges,
  cancelExchange,
  respondExchange,
  resolveMediaUrl,
  searchUsers,
  getUserProfile,
  type Exchange,
  type ExchangeUser,
  type ExchangeCardItem,
  type ExchangeStatus,
  type UserLite,
} from '../api/extra';

// ─── Статусы ──────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Принят', color: 'var(--green)' },
  wait: { label: 'В ожидании', color: 'var(--yellow)' },
  denied: { label: 'Отклонён', color: 'var(--red)' },
  canceled: { label: 'Отменён', color: 'var(--text3)' },
};

function statusInfo(s: ExchangeStatus) {
  return STATUS_MAP[s] ?? { label: String(s), color: 'var(--text3)' };
}

/** «1 карта» / «2 карты» / «5 карт» */
function pluralCards(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  let w = 'карт';
  if (m10 === 1 && m100 !== 11) w = 'карта';
  else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) w = 'карты';
  return `${n} ${w}`;
}

/** true, если обложка — видео (анимированная карта). */
function isVideoUrl(url: string): boolean {
  return /\.(webm|mp4)(\?|#|$)/i.test(url);
}

// Открытие увеличенной карты пробрасываем через контекст, чтобы не тащить
// колбэк через UserSide → CardScroller → CardThumb.
const CardZoomContext = createContext<(cover: string, awakening?: CardAwakening | null) => void>(() => {});

// ─── Обёртка: под-вкладки «Мои обмены» / «Предложить обмен» ────────────────────

export default function ExchangesPage() {
  const token = useAppStore((s) => s.token);
  const exchangeTargetUserId = useAppStore((s) => s.exchangeTargetUserId);
  const setExchangeTargetUserId = useAppStore((s) => s.setExchangeTargetUserId);
  const [sub, setSub] = useState<'mine' | 'offer'>('mine');
  const [partner, setPartner] = useState<BuilderPartner | null>(null);

  // Пришли по тапу на аватарку с форума — резолвим профиль и открываем билдер.
  useEffect(() => {
    if (exchangeTargetUserId == null) return;
    const id = exchangeTargetUserId;
    let alive = true;
    (async () => {
      try {
        const p = await getUserProfile(token, id);
        if (alive) setPartner({ id, name: p.username || `ID ${id}`, avatarMid: p.avatarUrl || '' });
      } catch {
        if (alive) setPartner({ id, name: `ID ${id}`, avatarMid: '' });
      } finally {
        setExchangeTargetUserId(null); // намерение израсходовано
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeTargetUserId]);

  // выбран партнёр → полноэкранный билдер (вся страница скроллится, без прибитой шапки)
  if (partner) {
    return (
      <ExchangeBuilder
        partner={partner}
        onBack={() => setPartner(null)}
        onSent={() => { setPartner(null); setSub('mine'); }}
      />
    );
  }

  return (
    <div style={w.root}>
      <PageHeader title="Обмены" sub="обмены картами" />
      <div style={w.body}>
        {sub === 'mine'
          ? <MyExchangesTab sub={sub} setSub={setSub} />
          : <OfferSearch sub={sub} setSub={setSub} onPick={setPartner} />}
      </div>
    </div>
  );
}

/** Переключатель под-вкладок — рендерится внутри скролла страницы (не прибит). */
function SubTabs({ sub, setSub }: { sub: 'mine' | 'offer'; setSub: (s: 'mine' | 'offer') => void }) {
  return (
    <div style={w.subTabs}>
      <button style={{ ...w.tab, ...(sub === 'mine' ? w.tabOn : {}) }} onClick={() => setSub('mine')}>
        Мои обмены
      </button>
      <button style={{ ...w.tab, ...(sub === 'offer' ? w.tabOn : {}) }} onClick={() => setSub('offer')}>
        Предложить обмен
      </button>
    </div>
  );
}

// ─── Поиск пользователя для обмена ─────────────────────────────────────────────

function OfferSearch({ sub, setSub, onPick }: { sub: 'mine' | 'offer'; setSub: (s: 'mine' | 'offer') => void; onPick: (p: BuilderPartner) => void }) {
  const token = useAppStore((s) => s.token);
  const [mode, setMode] = useState<'nick' | 'id'>('nick');
  const [query, setQuery] = useState('');
  const [idValue, setIdValue] = useState('');
  const [results, setResults] = useState<UserLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState(false);

  // живой поиск по нику с дебаунсом
  useEffect(() => {
    if (mode !== 'nick') return;
    const q = query.trim();
    if (!q) { setResults([]); setError(''); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list = await searchUsers(token, q);
        if (alive) { setResults(list); setError(''); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, mode, token]);

  const pickUser = (u: UserLite) =>
    onPick({ id: u.id, name: u.username, avatarMid: resolveMediaUrl(u.avatar?.mid || u.avatar?.high || '') });

  const submitId = async () => {
    const id = parseInt(idValue.trim(), 10);
    if (!Number.isFinite(id) || id <= 0) { setError('Введите корректный ID'); return; }
    setResolving(true); setError('');
    try {
      const p = await getUserProfile(token, id);
      onPick({ id, name: p.username || `ID ${id}`, avatarMid: p.avatarUrl || '' });
    } catch {
      onPick({ id, name: `ID ${id}`, avatarMid: '' }); // профиль не достали — идём с одним ID
    } finally {
      setResolving(false);
    }
  };

  return (
    <div style={w.offerRoot}>
      <SubTabs sub={sub} setSub={setSub} />
      <div style={w.modeRow}>
        <button style={{ ...w.modeBtn, ...(mode === 'nick' ? w.modeOn : {}) }} onClick={() => { setMode('nick'); setError(''); }}>
          По нику
        </button>
        <button style={{ ...w.modeBtn, ...(mode === 'id' ? w.modeOn : {}) }} onClick={() => { setMode('id'); setError(''); }}>
          По ID
        </button>
      </div>

      {mode === 'nick' ? (
        <>
          <input
            style={w.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Никнейм пользователя"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {loading && <p style={w.info}>Поиск…</p>}
          {error && <p style={w.errInline}>{error}</p>}
          <div style={w.userList}>
            {results.map((u) => {
              const av = resolveMediaUrl(u.avatar?.mid || u.avatar?.high || '');
              return (
                <button key={u.id} style={w.userRow} onClick={() => pickUser(u)}>
                  {av
                    ? (isVideoUrl(av)
                        ? <video src={av} style={w.userAv} autoPlay loop muted playsInline />
                        : <img src={av} style={w.userAv} alt="" />)
                    : <div style={{ ...w.userAv, ...w.userAvEmpty }}>{(u.username || '?')[0]}</div>}
                  <div style={w.userCol}>
                    <span style={w.userName}>{u.username}</span>
                    {u.tagline && <span style={w.userTag}>{u.tagline}</span>}
                  </div>
                </button>
              );
            })}
            {!loading && !error && query.trim() && results.length === 0 && (
              <p style={w.info}>Никого не найдено.</p>
            )}
          </div>
        </>
      ) : (
        <>
          <input
            style={w.input}
            value={idValue}
            onChange={(e) => setIdValue(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="ID пользователя"
            inputMode="numeric"
          />
          {error && <p style={w.errInline}>{error}</p>}
          <button
            style={{ ...w.idBtn, ...(idValue.trim() && !resolving ? {} : w.idBtnDisabled) }}
            onClick={submitId}
            disabled={!idValue.trim() || resolving}
          >
            {resolving ? 'Открываю…' : 'Перейти к обмену'}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Мои обмены ────────────────────────────────────────────────────────────────

function MyExchangesTab({ sub, setSub }: { sub: 'mine' | 'offer'; setSub: (s: 'mine' | 'offer') => void }) {
  const token = useAppStore((s) => s.token);
  const userId = useAppStore((s) => s.userId);

  const [items, setItems] = useState<Exchange[]>([]);
  const [page, setPage] = useState(0); // последняя загруженная страница
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Увеличенная карта (null — закрыта).
  const [zoom, setZoom] = useState<{ cover: string; awakening: CardAwakening | null } | null>(null);
  const openZoom = (cover: string, awakening?: CardAwakening | null) => setZoom({ cover, awakening: awakening ?? null });

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    if (!token || !userId) {
      setError('Нет токена или id пользователя.');
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError('');
    const next = page + 1;
    try {
      const { results, hasMore: more } = await getExchanges(token, userId, next);
      setItems((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...results.filter((e) => !seen.has(e.id))];
      });
      setPage(next);
      setHasMore(more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [token, userId, page, hasMore]);

  // Догружаем, пока экран не заполнен (и подхватываем первую страницу).
  // При ошибке авто-догрузку останавливаем, чтобы не зациклиться.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || error) return;
    if (el.scrollHeight <= el.clientHeight + 40) void loadNext();
  }, [items, hasMore, loading, error, loadNext]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (error) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) void loadNext();
  };

  const retry = () => {
    setError('');
    void loadNext();
  };

  // Отмена обмена: PUT, затем локально помечаем статус canceled.
  const cancel = useCallback(
    async (exchangeId: number) => {
      await cancelExchange(token, userId, exchangeId);
      setItems((prev) =>
        prev.map((e) => (e.id === exchangeId ? { ...e, status: 'canceled' } : e))
      );
    },
    [token, userId]
  );

  // Ответ получателя: принять/отклонить (с необязательным комментарием).
  const respond = useCallback(
    async (exchangeId: number, status: 'accepted' | 'denied', comment: string) => {
      await respondExchange(token, userId, exchangeId, status, comment);
      setItems((prev) =>
        prev.map((e) => (e.id === exchangeId ? { ...e, status } : e))
      );
    },
    [token, userId]
  );

  return (
    <CardZoomContext.Provider value={openZoom}>
      <div style={p.root}>
        <div style={p.scroll} ref={scrollRef} onScroll={onScroll}>
          <SubTabs sub={sub} setSub={setSub} />
          {items.map((ex) => (
            <ExchangeCard key={ex.id} ex={ex} userId={userId} onCancel={cancel} onRespond={respond} />
          ))}

          {loading && (
            <div style={p.statusRow}>
              <span style={p.spinner} />
              <span style={p.statusText}>Загрузка…</span>
            </div>
          )}

          {error && (
            <div style={p.errorBox}>
              <span style={p.errorText}>{error}</span>
              <button style={p.retryBtn} onClick={retry}>
                Повторить
              </button>
            </div>
          )}

          {!loading && !error && !hasMore && items.length > 0 && (
            <p style={p.endNote}>Это все обмены.</p>
          )}

          {!loading && !error && hasMore === false && items.length === 0 && (
            <p style={p.empty}>Обменов пока нет.</p>
          )}
        </div>
      </div>

      {zoom && <CardZoomOverlay cover={zoom.cover} awakening={zoom.awakening} onClose={() => setZoom(null)} />}
    </CardZoomContext.Provider>
  );
}

// ─── Увеличенная карта ────────────────────────────────────────────────────────

function CardZoomOverlay({ cover, awakening, onClose }: { cover: string; awakening: CardAwakening | null; onClose: () => void }) {
  const isVid = isVideoUrl(cover);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const mediaStyle = awakening ? p.zoomMediaAwk : p.zoomMedia;
  const media = isVid ? (
    <video src={cover} style={mediaStyle} onClick={stop} autoPlay loop muted playsInline />
  ) : (
    <img src={cover} style={mediaStyle} onClick={stop} alt="" />
  );
  return (
    <div style={p.zoomBackdrop} onClick={onClose}>
      <div style={p.zoomGroup}>
        {awakening?.isBroken && <div style={p.brokenBox} onClick={stop}>СЛОМАНА</div>}
        <div style={p.zoomWrap}>
          <button style={p.zoomClose} onClick={onClose} aria-label="Закрыть">×</button>
          {media}
        </div>
        {awakening && <AwakenedBoxes awakening={awakening} />}
      </div>
    </div>
  );
}

// ─── Один обмен ───────────────────────────────────────────────────────────────

function ExchangeCard({
  ex, userId, onCancel, onRespond,
}: {
  ex: Exchange;
  userId: number | string;
  onCancel: (exchangeId: number) => Promise<void>;
  onRespond: (exchangeId: number, status: 'accepted' | 'denied', comment: string) => Promise<void>;
}) {
  const st = statusInfo(ex.status);
  const me = String(userId);
  const pending = ex.status === 'wait';
  const isCreator = String(ex.creator?.id) === me; // отправитель
  const isPartner = String(ex.partner?.id) === me; // получатель

  return (
    <div style={p.exCard}>
      <div style={p.exHeader}>
        <span style={p.exId}>Обмен #{ex.id}</span>
        <span style={{ ...p.exStatus, color: st.color, borderColor: st.color }}>
          {st.label}
        </span>
      </div>

      {/* верх — отправитель запроса */}
      <UserSide user={ex.creator} cards={ex.items_creator?.cards ?? []} />
      <div style={p.divider} />
      {/* низ — получатель запроса */}
      <UserSide user={ex.partner} cards={ex.items_partner?.cards ?? []} />

      {/* комментарии сторон (если есть) */}
      <CommentsSection ex={ex} />

      {/* отправитель может отменить свой ещё не отвеченный обмен */}
      {pending && isCreator && <CancelFooter onConfirm={() => onCancel(ex.id)} />}
      {/* получатель может принять или отклонить */}
      {pending && isPartner && (
        <RespondFooter
          onAccept={(c) => onRespond(ex.id, 'accepted', c)}
          onDeny={(c) => onRespond(ex.id, 'denied', c)}
        />
      )}
    </div>
  );
}

// ─── Комментарии сторон ───────────────────────────────────────────────────────

/** Нормализует сообщение: null/пусто/«.» (плейсхолдер отмены) → нет сообщения. */
function normalizeMessage(msg?: string | null): string {
  if (typeof msg !== 'string') return '';
  const t = msg.trim();
  return t === '.' ? '' : t;
}

function CommentsSection({ ex }: { ex: Exchange }) {
  const creator = normalizeMessage(ex.message_creator);
  const partner = normalizeMessage(ex.message_partner);
  if (!creator && !partner) return null;
  return (
    <div style={p.comments}>
      {creator && <CommentBlock label="Сообщение отправителя:" text={creator} />}
      {partner && <CommentBlock label="Сообщение получателя:" text={partner} />}
    </div>
  );
}

/** Текст комментария со сворачиванием: длинный клампится до 3 строк + «Раскрыть». */
function CommentBlock({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Замер делаем в склампленном состоянии (при монтировании expanded=false):
  // если реальная высота больше видимой — текст длинный, показываем «Раскрыть».
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  const clamp: React.CSSProperties = expanded
    ? {}
    : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

  return (
    <div style={p.comment}>
      <span style={p.commentLabel}>{label}</span>
      <div ref={ref} style={{ ...p.commentText, ...clamp }}>{text}</div>
      {(overflow || expanded) && (
        <button style={p.commentToggle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Свернуть' : 'Раскрыть'}
        </button>
      )}
    </div>
  );
}

function RespondFooter({
  onAccept, onDeny,
}: {
  onAccept: (comment: string) => Promise<void>;
  onDeny: (comment: string) => Promise<void>;
}) {
  const [dialog, setDialog] = useState<null | 'accept' | 'deny'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (comment: string) => {
    setBusy(true);
    setError('');
    try {
      await (dialog === 'accept' ? onAccept : onDeny)(comment);
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    setDialog(null);
    setError('');
  };

  return (
    <div style={p.respondFooter}>
      <button style={p.denyBtn} onClick={() => { setError(''); setDialog('deny'); }}>
        Отклонить
      </button>
      <button style={p.acceptBtn} onClick={() => { setError(''); setDialog('accept'); }}>
        Принять
      </button>

      <ConfirmDialog
        open={dialog === 'accept'}
        title="Принять обмен?"
        confirmLabel="Принять"
        cancelLabel="Отмена"
        withComment
        commentPlaceholder="Комментарий (необязательно)"
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={close}
      />
      <ConfirmDialog
        open={dialog === 'deny'}
        title="Отклонить обмен?"
        confirmLabel="Отклонить"
        cancelLabel="Отмена"
        danger
        withComment
        commentPlaceholder="Комментарий (необязательно)"
        busy={busy}
        error={error}
        onConfirm={run}
        onCancel={close}
      />
    </div>
  );
}

function CancelFooter({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(); // успех — родитель сменит статус, футер исчезнет
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={p.cancelFooter}>
      <button
        style={p.cancelBtn}
        onClick={() => {
          setError('');
          setOpen(true);
        }}
      >
        Отменить обмен
      </button>

      <ConfirmDialog
        open={open}
        title="Вы точно хотите отменить обмен?"
        confirmLabel="Да"
        cancelLabel="Нет"
        danger
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          if (busy) return;
          setOpen(false);
          setError('');
        }}
      />
    </div>
  );
}

function UserSide({ user, cards }: { user: ExchangeUser; cards: ExchangeCardItem[] }) {
  const avatar = resolveMediaUrl(user?.avatar?.mid || user?.avatar?.high || '');
  return (
    <div style={p.side}>
      <div style={p.userRow}>
        <Avatar url={avatar} premium={user?.is_premium} />
        <span style={p.userName}>{user?.username || '—'}</span>
        <span style={p.cardCount}>{pluralCards(cards.length)}</span>
      </div>

      {cards.length === 0 ? (
        <div style={p.noCards}>нет карт</div>
      ) : (
        <CardScroller>
          {cards.map((c) => (
            <CardThumb key={c.id} item={c} />
          ))}
        </CardScroller>
      )}
    </div>
  );
}

// Реестр всех горизонтальных списков карт. При касании одного гасим инерцию
// (fling) у остальных — иначе на Android незавершённая инерция предыдущего
// списка продолжает прокручивать его, пока скроллишь другой.
const cardScrollers = new Set<HTMLDivElement>();

function stopFling(el: HTMLDivElement) {
  const left = el.scrollLeft;
  el.style.overflowX = 'hidden';
  void el.offsetWidth; // принудительный reflow обрывает инерцию
  el.style.overflowX = 'auto';
  el.scrollLeft = left; // возвращаем позицию на место
}

function CardScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    cardScrollers.add(el);
    return () => {
      cardScrollers.delete(el);
    };
  }, []);

  const onTouchStart = () => {
    const self = ref.current;
    cardScrollers.forEach((el) => {
      if (el !== self) stopFling(el);
    });
  };

  return (
    <div ref={ref} style={p.cardScroller} onTouchStart={onTouchStart}>
      {children}
    </div>
  );
}

// ─── Ленивое воспроизведение webm ─────────────────────────────────────────────
// Один общий наблюдатель на все видео: проигрываем только видимые карты/аватарки,
// невидимые ставим на паузу и не подгружаем (preload="none"). IntersectionObserver
// учитывает клиппинг и горизонтальными скроллерами карт, и вертикальным скроллом
// страницы, поэтому одного наблюдателя с root=viewport достаточно.

let videoObserver: IntersectionObserver | null = null;
const videoHandlers = new WeakMap<Element, (visible: boolean) => void>();

function getVideoObserver(): IntersectionObserver {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          videoHandlers.get(entry.target)?.(entry.isIntersecting);
        }
      },
      { root: null, rootMargin: '150px', threshold: 0.01 }
    );
  }
  return videoObserver;
}

/** Пока элемент видим — играет, иначе на паузе. enabled=false для не-видео. */
function useVideoInView(ref: React.RefObject<HTMLVideoElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    el.muted = true; // обязательно для автоплея на мобиле

    const handler = (visible: boolean) => {
      if (visible) {
        const pr = el.play();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      } else {
        el.pause();
      }
    };

    const observer = getVideoObserver();
    videoHandlers.set(el, handler);
    observer.observe(el);

    return () => {
      observer.unobserve(el);
      videoHandlers.delete(el);
    };
  }, [enabled]);
}

function Avatar({ url, premium }: { url: string; premium?: boolean }) {
  const [err, setErr] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ring: React.CSSProperties = premium ? { border: '1.5px solid var(--accent)' } : {};

  const isVideo = Boolean(url) && !err && /\.webm(\?|$)/i.test(url);
  useVideoInView(videoRef, isVideo);

  if (!url || err) return <div style={{ ...p.avatar, ...p.avatarFallback, ...ring }} />;

  if (isVideo) {
    return (
      <video
        ref={videoRef}
        src={url}
        style={{ ...p.avatar, ...ring }}
        loop
        muted
        playsInline
        preload="none"
        onError={() => setErr(true)}
      />
    );
  }

  return (
    <img
      src={url}
      style={{ ...p.avatar, ...ring }}
      onError={() => setErr(true)}
      loading="lazy"
      alt=""
    />
  );
}

function CardThumb({ item }: { item: ExchangeCardItem }) {
  const cover = resolveMediaUrl(item?.card?.cover?.mid || item?.card?.cover?.high || '');
  // В зуме показываем high-качество (в миниатюре остаётся mid).
  const coverHigh = resolveMediaUrl(item?.card?.cover?.high || item?.card?.cover?.mid || '');
  const awakening = toAwakening(item);
  const [err, setErr] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openZoom = useContext(CardZoomContext);

  // Анимированные карты приходят как .webm — это видео, не картинка.
  const isVideo = Boolean(cover) && !err && /\.webm(\?|$)/i.test(cover);
  useVideoInView(videoRef, isVideo);

  if (!cover || err) {
    return (
      <div style={p.cardThumb}>
        <div style={p.cardImgFallback} />
      </div>
    );
  }

  return (
    <div style={p.cardThumb} onClick={() => openZoom(coverHigh, awakening)}>
      {isVideo ? (
        <video
          ref={videoRef}
          src={cover}
          style={p.cardImg}
          loop
          muted
          playsInline
          preload="none"
          onError={() => setErr(true)}
        />
      ) : (
        <img
          src={cover}
          style={p.cardImg}
          onError={() => setErr(true)}
          loading="lazy"
          decoding="async"
          alt=""
        />
      )}
      <CardBadges awakening={awakening} />
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  headerBleed: { margin: '-12px -12px 0' },
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  exCard: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    overflow: 'hidden',
    flexShrink: 0,
  },
  exHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  exId: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--text2)',
    letterSpacing: '0.04em',
  },
  exStatus: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '3px 8px',
    borderRadius: '999px',
    border: '1px solid',
    background: 'rgba(0,0,0,0.2)',
  },

  side: {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  divider: { height: '1px', background: 'var(--border)' },

  respondFooter: {
    display: 'flex',
    gap: '10px',
    padding: '12px 14px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  denyBtn: {
    flex: 1,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    color: 'var(--red)',
    background: 'rgba(239,68,68,0.10)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  acceptBtn: {
    flex: 1,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    color: '#fff',
    background: 'var(--green)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  cancelFooter: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '12px 14px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  cancelBtn: {
    width: '100%',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    color: 'var(--red)',
    background: 'rgba(239,68,68,0.10)',
    border: '1px solid rgba(239,68,68,0.35)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  userRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  avatar: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
    background: 'var(--bg3)',
  },
  avatarFallback: { border: '1px solid var(--border)' },
  userName: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '14px',
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
  },
  cardCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    flexShrink: 0,
  },

  // горизонтальный скролл карт; по ширине помещается ровно 4 (3 зазора по 8px)
  cardScroller: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: '2px',
    scrollSnapType: 'x proximity',
  },
  cardThumb: {
    flex: '0 0 auto',
    width: 'calc((100% - 24px) / 4)',
    aspectRatio: '2 / 3',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    scrollSnapAlign: 'start',
    cursor: 'pointer',
    position: 'relative',
  },
  cardImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardImgFallback: { width: '100%', height: '100%', background: 'var(--bg3)' },
  noCards: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    padding: '4px 0',
  },

  // ── комментарии сторон ──
  comments: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px 14px',
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
  },
  comment: { display: 'flex', flexDirection: 'column', gap: '3px' },
  commentLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    letterSpacing: '0.02em',
  },
  commentText: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    lineHeight: 1.45,
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  commentToggle: {
    alignSelf: 'flex-start',
    marginTop: '2px',
    padding: 0,
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--accent)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },

  // ── увеличенная карта ──
  zoomBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  zoomWrap: { position: 'relative', display: 'inline-block', lineHeight: 0 },
  zoomGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  brokenBox: {
    background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: '8px',
    padding: '8px 18px', marginBottom: '12px', color: 'var(--red)',
    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '21px', letterSpacing: '0.06em',
  },
  zoomClose: {
    position: 'absolute',
    top: '-14px',
    right: '-14px',
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    border: 'none',
    background: 'var(--surface)',
    color: 'var(--text)',
    fontSize: '20px',
    lineHeight: '30px',
    textAlign: 'center',
    padding: 0,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    WebkitTapHighlightColor: 'transparent',
  },
  zoomMedia: {
    maxHeight: '85vh',
    maxWidth: '85vw',
    width: 'auto',
    height: 'auto',
    display: 'block',
  },
  zoomMediaAwk: {
    maxHeight: '66vh',
    maxWidth: '85vw',
    width: 'auto',
    height: 'auto',
    display: 'block',
  },

  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '12px',
  },
  spinner: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    border: '2px solid var(--border-active)',
    borderTopColor: 'var(--accent)',
    animation: 'redecks-spin 0.7s linear infinite',
  },
  statusText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },

  errorBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    flexShrink: 0,
  },
  errorText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', lineHeight: 1.4 },
  retryBtn: {
    flexShrink: 0,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '12px',
    color: '#fff',
    background: 'var(--red)',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  endNote: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    textAlign: 'center',
    padding: '6px 0',
  },
  empty: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    color: 'var(--text3)',
    textAlign: 'center',
    padding: '20px 0',
  },
};

// ─── Стили обёртки и поиска ────────────────────────────────────────────────────

const w: Record<string, React.CSSProperties> = {
  headerBleed: { margin: '-12px -12px 0' },
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  tabs: { display: 'flex', gap: '6px', padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  subTabs: { display: 'flex', gap: '6px' },
  tab: {
    flex: 1, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
    padding: '10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  tabOn: { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },

  offerRoot: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' },
  modeRow: { display: 'flex', gap: '6px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px' },
  modeBtn: {
    flex: 1, background: 'transparent', color: 'var(--text2)', border: 'none', borderRadius: '6px',
    padding: '9px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  modeOn: { background: 'var(--accent)', color: '#fff' },
  input: {
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px', padding: '12px', outline: 'none',
  },
  info: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  errInline: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)' },

  userList: { display: 'flex', flexDirection: 'column', gap: '6px' },
  userRow: {
    display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left', width: '100%',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '9px 10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  userAv: { width: '38px', height: '38px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' },
  userAvEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text3)', border: '1px solid var(--border)' },
  userCol: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  userName: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  userTag: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  idBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '12px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  idBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
};
