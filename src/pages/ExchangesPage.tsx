import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  getExchanges,
  cancelExchange,
  respondExchange,
  resolveMediaUrl,
  type Exchange,
  type ExchangeUser,
  type ExchangeCardItem,
  type ExchangeStatus,
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

// ─── Страница ─────────────────────────────────────────────────────────────────

export default function ExchangesPage() {
  const token = useAppStore((s) => s.token);
  const userId = useAppStore((s) => s.userId);

  const [items, setItems] = useState<Exchange[]>([]);
  const [page, setPage] = useState(0); // последняя загруженная страница
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    <div style={p.root}>
      <PageHeader title="Обмены" sub="последние обмены" />

      <div style={p.scroll} ref={scrollRef} onScroll={onScroll}>
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
  const [err, setErr] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
    <div style={p.cardThumb}>
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
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
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
  },
  cardImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardImgFallback: { width: '100%', height: '100%', background: 'var(--bg3)' },
  noCards: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    padding: '4px 0',
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
