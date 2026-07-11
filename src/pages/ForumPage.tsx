import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import { CardZoomProvider, CardScroller, CardThumb, isVideoUrl } from '../components/CardGallery';
import ForumComments from '../components/ForumComments';
import UserAvatar from '../components/UserAvatar';
import { timeAgo, htmlToText } from '../utils/forumText';
import {
  getForumTags,
  getForumPosts,
  votePost,
  resolveMediaUrl,
  type ForumTag,
  type ForumPost,
  type ForumOrdering,
} from '../api/extra';

// ─── Утилиты ──────────────────────────────────────────────────────────────────

interface ForumCard { id: number | string; mid: string; high: string }

/** Вытаскивает карты из attachments. Известная форма: attachments.cards[] с cover.mid/high. */
function extractCards(attachments: unknown): ForumCard[] {
  const out: ForumCard[] = [];
  if (!attachments || typeof attachments !== 'object') return out;
  const obj = attachments as Record<string, unknown>;

  const pools: unknown[][] = [];
  if (Array.isArray(obj.cards)) pools.push(obj.cards);               // основной случай
  else if (Array.isArray(attachments)) pools.push(attachments as unknown[]);
  else for (const v of Object.values(obj)) if (Array.isArray(v)) pools.push(v); // запасной

  for (const arr of pools) {
    for (const raw of arr) {
      const it = raw as Record<string, unknown>;
      const card = (it?.card ?? it) as Record<string, unknown>;
      const cover = card?.cover as { mid?: string | null; high?: string | null } | undefined;
      if (cover && (cover.mid || cover.high)) {
        const mid = resolveMediaUrl(cover.mid || cover.high || '');
        const high = resolveMediaUrl(cover.high || cover.mid || '');
        out.push({ id: (card.id as number) ?? (it.id as number) ?? out.length, mid, high });
      }
    }
  }
  return out;
}

interface UIPost {
  id: number;
  header: string;
  text: string;
  ago: string;
  authorName: string;
  avatarMid: string;
  isPremium: boolean;
  authorId: number | null;
  cards: ForumCard[];
  photo: { url: string; video: boolean } | null;
  score: number;
  comments: number;
}

function toUIPost(r: ForumPost, now: number): UIPost {
  const au = r.author_user;
  const authorName = au?.username || r.author_club?.name || r.author_publisher?.name || '—';
  const avatarMid = resolveMediaUrl(au?.avatar?.mid || au?.avatar?.high || '');
  const photoRaw = r.attachment?.high || r.attachment?.mid || '';
  const photoUrl = photoRaw ? resolveMediaUrl(photoRaw) : '';
  return {
    id: r.id,
    header: r.header || '',
    text: htmlToText(r.text || ''),
    ago: timeAgo(r.created_at, now),
    authorName,
    avatarMid,
    isPremium: Boolean(au?.is_premium),
    authorId: au?.id ?? null,
    cards: extractCards(r.attachments),
    photo: photoUrl ? { url: photoUrl, video: isVideoUrl(photoUrl) } : null,
    score: r.score ?? 0,
    comments: r.count_comments ?? 0,
  };
}

// ─── Фильтры ──────────────────────────────────────────────────────────────────

const ORDER_OPTS: { v: ForumOrdering; label: string }[] = [
  { v: '-id', label: 'Новые' },
  { v: 'id', label: 'Старые' },
  { v: 'score', label: 'Популярные' },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function TagFilter({
  token, tags, tagsLoaded, loading, error, onOpenLoad, selected, onToggle,
}: {
  token: string;
  tags: ForumTag[];
  tagsLoaded: boolean;
  loading: boolean;
  error: string;
  onOpenLoad: () => void;
  selected: number[];
  onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const toggleOpen = () => {
    setOpen((o) => !o);
    if (!tagsLoaded) onOpenLoad();
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const count = selected.length;
  return (
    <div style={s.filterBox} ref={boxRef}>
      <button style={s.filterBtn} onClick={toggleOpen}>
        {count > 0 ? `Теги · ${count}` : 'Теги'}
        <Chevron open={open} />
      </button>
      {open && (
        <div style={{ ...s.dropdown, left: 0 }}>
          {loading ? (
            <div style={s.dropInfo}>Загрузка…</div>
          ) : error ? (
            <div style={s.dropInfo}>{error}</div>
          ) : tags.length === 0 ? (
            <div style={s.dropInfo}>Нет тегов</div>
          ) : (
            tags.map((t) => {
              const on = selected.includes(t.id);
              return (
                <button key={t.id} style={s.tagRow} onClick={() => onToggle(t.id)}>
                  <span style={{ ...s.check, ...(on ? s.checkOn : {}) }}>{on ? '✓' : ''}</span>
                  <span style={s.tagName}>{t.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function OrderFilter({ value, onChange }: { value: ForumOrdering; onChange: (v: ForumOrdering) => void }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const cur = ORDER_OPTS.find((o) => o.v === value) ?? ORDER_OPTS[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div style={{ ...s.filterBox, marginLeft: 'auto' }} ref={boxRef}>
      <button style={s.filterBtn} onClick={() => setOpen((o) => !o)}>
        {cur.label}
        <Chevron open={open} />
      </button>
      {open && (
        <div style={{ ...s.dropdown, right: 0, minWidth: '140px' }}>
          {ORDER_OPTS.map((o) => (
            <button
              key={o.v}
              style={{ ...s.tagRow, ...(o.v === value ? s.tagRowOn : {}) }}
              onClick={() => { onChange(o.v); setOpen(false); }}
            >
              <span style={s.tagName}>{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Пост ─────────────────────────────────────────────────────────────────────

/** Текст поста: 3 строки, затем «Раскрыть». */
function PostText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text]);

  const clamp: React.CSSProperties = expanded
    ? {}
    : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

  return (
    <div>
      <div ref={ref} style={{ ...s.text, ...clamp }}>{text}</div>
      {(overflow || expanded) && (
        <button style={s.toggle} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Свернуть' : 'Раскрыть'}
        </button>
      )}
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function BubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function PostCard({ post }: { post: UIPost }) {
  const token = useAppStore((s) => s.token);
  const [liked, setLiked] = useState(false);
  const [score, setScore] = useState(post.score);
  const [showComments, setShowComments] = useState(false);

  const toggleLike = async () => {
    const next = !liked;
    setLiked(next);
    setScore((v) => v + (next ? 1 : -1));
    try {
      await votePost(token, post.id);
    } catch {
      // откат при ошибке
      setLiked(!next);
      setScore((v) => v + (next ? -1 : 1));
    }
  };

  return (
    <div style={s.post}>
      <div style={s.head}>
        <UserAvatar url={post.avatarMid} userId={post.authorId} premium={post.isPremium} size={40} radius={10} />
        <div style={s.headCol}>
          <span style={s.author}>{post.authorName}</span>
          <span style={s.ago}>{post.ago}</span>
        </div>
      </div>

      {post.header && <div style={s.title}>{post.header}</div>}
      {post.text && <PostText text={post.text} />}

      {post.cards.length > 0 && (
        <CardScroller>
          {post.cards.map((c) => (
            <CardThumb key={c.id} mid={c.mid} high={c.high} />
          ))}
        </CardScroller>
      )}

      {post.photo && (
        post.photo.video ? (
          <video src={post.photo.url} style={s.photo} autoPlay loop muted playsInline />
        ) : (
          <img src={post.photo.url} style={s.photo} loading="lazy" alt="" />
        )
      )}

      <div style={s.footer}>
        <button
          style={{ ...s.footBtn, ...(liked ? s.footBtnLiked : {}) }}
          onClick={toggleLike}
        >
          <HeartIcon filled={liked} />
          <span>{score}</span>
        </button>
        <button
          style={{ ...s.footBtn, ...(showComments ? s.footBtnActive : {}) }}
          onClick={() => setShowComments((v) => !v)}
        >
          <BubbleIcon />
          <span>{post.comments}</span>
        </button>
      </div>

      {showComments && <ForumComments postId={post.id} />}
    </div>
  );
}

// ─── Страница ─────────────────────────────────────────────────────────────────

export default function ForumPage() {
  const token = useAppStore((s) => s.token);

  const [allTags, setAllTags] = useState<ForumTag[]>([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [ordering, setOrdering] = useState<ForumOrdering>('-id');

  const [posts, setPosts] = useState<UIPost[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const seenRef = useRef<Set<number>>(new Set());
  const loadingRef = useRef(false);
  const reqIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tagsKey = selected.slice().sort((a, b) => a - b).join(',');

  const loadTags = useCallback(async () => {
    if (tagsLoaded || tagsLoading) return;
    setTagsLoading(true);
    setTagsError('');
    try {
      const list = await getForumTags(token);
      setAllTags(list);
      setTagsLoaded(true);
    } catch (e) {
      setTagsError(e instanceof Error ? e.message : String(e));
    } finally {
      setTagsLoading(false);
    }
  }, [token, tagsLoaded, tagsLoading]);

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore || !token) return;
    loadingRef.current = true;
    const myReq = reqIdRef.current;
    setLoading(true);
    setError('');
    try {
      const next = page + 1;
      const { results, hasMore: more } = await getForumPosts(token, {
        page: next,
        ordering,
        tags: selected,
      });
      if (myReq !== reqIdRef.current) return; // фильтр сменился на лету — ответ устарел
      const now = Date.now();
      const add: UIPost[] = [];
      for (const r of results) {
        if (seenRef.current.has(r.id)) continue; // защита от дубликатов
        seenRef.current.add(r.id);
        add.push(toUIPost(r, now));
      }
      if (add.length) setPosts((prev) => [...prev, ...add]);
      setPage(next);
      setHasMore(more);
    } catch (e) {
      if (myReq === reqIdRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myReq === reqIdRef.current) {
        setLoading(false);
        loadingRef.current = false;
      }
    }
  }, [token, ordering, tagsKey, page, hasMore, selected]);

  // Смена фильтра (сортировка/теги) — сбрасываем ленту и грузим заново.
  useEffect(() => {
    reqIdRef.current += 1;
    loadingRef.current = false;
    seenRef.current = new Set();
    setPosts([]);
    setPage(0);
    setHasMore(true);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordering, tagsKey]);

  // Догружаем, пока экран не заполнен (и подхватываем первую страницу после сброса).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || error) return;
    if (el.scrollHeight <= el.clientHeight + 40) void loadNext();
  }, [posts, hasMore, loading, error, loadNext]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (error) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 500) void loadNext();
  };

  const toggleTag = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const retry = () => { setError(''); void loadNext(); };

  return (
    <CardZoomProvider>
      <div style={s.root}>
        <PageHeader title="Форум" sub="посты сообщества" />

        <div style={s.filterBar}>
          <TagFilter
            token={token}
            tags={allTags}
            tagsLoaded={tagsLoaded}
            loading={tagsLoading}
            error={tagsError}
            onOpenLoad={loadTags}
            selected={selected}
            onToggle={toggleTag}
          />
          <OrderFilter value={ordering} onChange={setOrdering} />
        </div>

        <div style={s.scroll} ref={scrollRef} onScroll={onScroll}>
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}

          {loading && (
            <div style={s.statusRow}>
              <span style={s.spinner} />
              <span style={s.statusText}>Загрузка…</span>
            </div>
          )}

          {error && (
            <div style={s.errorBox}>
              <span style={s.errorText}>{error}</span>
              <button style={s.retryBtn} onClick={retry}>Повторить</button>
            </div>
          )}

          {!loading && !error && !hasMore && posts.length > 0 && (
            <p style={s.endNote}>Это все посты.</p>
          )}
          {!loading && !error && !hasMore && posts.length === 0 && (
            <p style={s.empty}>Постов нет.</p>
          )}
        </div>
      </div>
    </CardZoomProvider>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },

  filterBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg)',
    position: 'relative',
    zIndex: 20,
    flexShrink: 0,
  },
  filterBox: { position: 'relative' },
  filterBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '13px',
    padding: '8px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    zIndex: 30,
    minWidth: '180px',
    maxHeight: '260px',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: '4px',
  },
  dropInfo: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text3)',
    padding: '10px 12px',
  },
  tagRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: '8px',
    padding: '9px 10px',
    cursor: 'pointer',
    color: 'var(--text)',
    WebkitTapHighlightColor: 'transparent',
  },
  tagRowOn: { background: 'rgba(139,92,246,0.12)' },
  check: {
    width: '16px',
    height: '16px',
    flexShrink: 0,
    borderRadius: '4px',
    border: '1px solid var(--border-active)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    color: '#fff',
    lineHeight: 1,
  },
  checkOn: { background: 'var(--accent)', borderColor: 'var(--accent)' },
  tagName: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
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

  post: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flexShrink: 0,
  },
  head: { display: 'flex', gap: '10px', alignItems: 'stretch' },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    objectFit: 'cover',
    flexShrink: 0,
    background: 'var(--bg3)',
  },
  avatarEmpty: { border: '1px solid var(--border)' },
  headCol: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    minHeight: '40px',
    minWidth: 0,
    paddingTop: '1px',
    paddingBottom: '1px',
  },
  author: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '14px',
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ago: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },

  title: {
    fontFamily: 'var(--font-display)',
    fontWeight: 800,
    fontSize: '15px',
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  text: {
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    lineHeight: 1.5,
    color: 'var(--text2)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  toggle: {
    alignSelf: 'flex-start',
    marginTop: '4px',
    padding: 0,
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--accent)',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  photo: {
    width: '100%',
    maxHeight: '420px',
    objectFit: 'contain',
    borderRadius: '10px',
    background: 'var(--bg3)',
    display: 'block',
  },

  footer: { display: 'flex', gap: '18px', alignItems: 'center', marginTop: '2px' },
  footBtn: {
    display: 'flex', alignItems: 'center', gap: '6px',
    background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
    color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: '13px',
    WebkitTapHighlightColor: 'transparent',
  },
  footBtnLiked: { color: 'var(--red)' },
  footBtnActive: { color: 'var(--accent)' },

  statusRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px' },
  spinner: {
    width: 14, height: 14, borderRadius: '50%',
    border: '2px solid var(--border-active)', borderTopColor: 'var(--accent)',
    animation: 'redecks-spin 0.7s linear infinite',
  },
  statusText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text2)' },
  errorBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 'var(--radius)', padding: '12px 14px', flexShrink: 0,
  },
  errorText: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', lineHeight: 1.4 },
  retryBtn: {
    flexShrink: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px',
    color: '#fff', background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '8px 12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  endNote: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '20px 0' },
};
