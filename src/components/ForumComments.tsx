import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import UserAvatar from './UserAvatar';
import { agoFromSeconds, htmlCommentToText, wrapCommentText } from '../utils/forumText';
import {
  getComments,
  getReplies,
  createComment,
  resolveMediaUrl,
  type ForumComment,
} from '../api/extra';

const PAGE_SIZE = 20;
const REPLY_PAGE_SIZE = 5;

function dedupAppend(prev: ForumComment[], list: ForumComment[]): ForumComment[] {
  const seen = new Set(prev.map((c) => c.id));
  return [...prev, ...list.filter((c) => !seen.has(c.id))];
}

// ─── Форма ввода ──────────────────────────────────────────────────────────────

function CommentForm({
  placeholder, sending, onSend, onCancel, autoFocus,
}: {
  placeholder: string; sending: boolean; onSend: (text: string) => void; onCancel?: () => void; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !sending;
  return (
    <div style={cs.form}>
      <textarea
        style={cs.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus={autoFocus}
      />
      <div style={cs.formRow}>
        {onCancel && <button style={cs.cancelBtn} onClick={onCancel}>Отмена</button>}
        <button
          style={{ ...cs.sendBtn, ...(canSend ? {} : cs.sendDisabled) }}
          onClick={() => { if (canSend) { onSend(text.trim()); setText(''); } }}
          disabled={!canSend}
        >
          {sending ? '…' : 'Отправить'}
        </button>
      </div>
    </div>
  );
}

// ─── Один комментарий (рекурсивно с ответами) ─────────────────────────────────

function CommentItem({ comment, depth }: { comment: ForumComment; depth: number }) {
  const token = useAppStore((s) => s.token);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySending, setReplySending] = useState(false);

  const [replies, setReplies] = useState<ForumComment[]>([]);
  const [shown, setShown] = useState(false);
  const [rPage, setRPage] = useState(0);
  const [rHasMore, setRHasMore] = useState(true);
  const [rLoading, setRLoading] = useState(false);
  const [replyCount, setReplyCount] = useState(comment.count_replies ?? 0);
  const rLoadingRef = useRef(false);

  const av = resolveMediaUrl(comment.user?.avatar?.mid || comment.user?.avatar?.high || '');
  const body = htmlCommentToText(comment.text);
  const ago = agoFromSeconds(comment.date / 1000); // date приходит в миллисекундах

  const loadReplies = async (reset = false) => {
    if (rLoadingRef.current) return;
    rLoadingRef.current = true;
    setRLoading(true);
    try {
      const next = reset ? 1 : rPage + 1;
      const list = await getReplies(token, comment.id, next);
      setReplies((prev) => (reset ? list : dedupAppend(prev, list)));
      setRPage(next);
      setRHasMore(list.length >= REPLY_PAGE_SIZE);
    } catch { /* тихо */ } finally {
      setRLoading(false);
      rLoadingRef.current = false;
    }
  };

  const toggleReplies = () => {
    if (!shown) {
      setShown(true);
      if (replies.length === 0) void loadReplies(true);
    } else {
      setShown(false);
    }
  };

  const sendReply = async (text: string) => {
    setReplySending(true);
    try {
      await createComment(token, { reply_to: comment.id, text: wrapCommentText(text) });
      setReplyOpen(false);
      setReplyCount((n) => n + 1);
      setShown(true);
      await loadReplies(true);
    } catch { /* тихо */ } finally {
      setReplySending(false);
    }
  };

  return (
    <div style={{ ...cs.item, ...(depth > 0 ? cs.itemNested : {}) }}>
      <UserAvatar url={av} userId={comment.user?.id ?? null} size={34} radius={9} premium={Boolean(comment.user?.is_premium)} />
      <div style={cs.col}>
        <span style={cs.name}>{comment.user?.username || '—'}</span>
        {body && <div style={cs.text}>{body}</div>}
        <div style={cs.meta}>
          <span style={cs.ago}>{ago}</span>
          <button style={cs.metaBtn} onClick={() => setReplyOpen((o) => !o)}>Ответить</button>
          {replyCount > 0 && (
            <button style={cs.metaBtn} onClick={toggleReplies}>
              {shown ? 'Скрыть ответы' : `Ответы (${replyCount})`}
            </button>
          )}
        </div>

        {replyOpen && (
          <CommentForm
            placeholder="Ваш ответ…"
            sending={replySending}
            onSend={sendReply}
            onCancel={() => setReplyOpen(false)}
            autoFocus
          />
        )}

        {shown && (
          <div style={cs.replies}>
            {replies.map((r) => (
              <CommentItem key={r.id} comment={r} depth={depth + 1} />
            ))}
            {rLoading && <div style={cs.loading}>Загрузка…</div>}
            {!rLoading && rHasMore && replies.length > 0 && (
              <button style={cs.moreBtn} onClick={() => loadReplies(false)}>Показать ещё</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Секция комментариев поста ─────────────────────────────────────────────────

export default function ForumComments({ postId }: { postId: number }) {
  const token = useAppStore((s) => s.token);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const loadingRef = useRef(false);

  const loadPage = async (reset = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError('');
    try {
      const next = reset ? 1 : page + 1;
      const list = await getComments(token, postId, next);
      setComments((prev) => (reset ? list : dedupAppend(prev, list)));
      setPage(next);
      setHasMore(list.length >= PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  useEffect(() => { void loadPage(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [postId]);

  const send = async (text: string) => {
    setSending(true);
    try {
      await createComment(token, { post: postId, text: wrapCommentText(text) });
      await loadPage(true); // перезагрузка с 1-й страницы — свежий коммент сверху
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={cs.root}>
      <CommentForm placeholder="Написать комментарий…" sending={sending} onSend={send} />

      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} depth={0} />
      ))}

      {loading && <div style={cs.loading}>Загрузка…</div>}
      {error && <div style={cs.error}>{error}</div>}
      {!loading && !error && comments.length === 0 && (
        <p style={cs.empty}>Пока нет комментариев.</p>
      )}
      {!loading && hasMore && comments.length > 0 && (
        <button style={cs.moreBtn} onClick={() => loadPage(false)}>Показать ещё</button>
      )}
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const cs: Record<string, React.CSSProperties> = {
  root: {
    marginTop: '10px',
    paddingTop: '12px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },

  form: { display: 'flex', flexDirection: 'column', gap: '6px' },
  input: {
    width: '100%', resize: 'vertical', minHeight: '38px', boxSizing: 'border-box',
    background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '13px', lineHeight: 1.4,
    padding: '10px', outline: 'none',
  },
  formRow: { display: 'flex', justifyContent: 'flex-end', gap: '8px' },
  sendBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
    padding: '8px 16px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  sendDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  cancelBtn: {
    background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '8px 14px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },

  item: { display: 'flex', gap: '10px', alignItems: 'flex-start' },
  itemNested: { marginLeft: '6px', paddingLeft: '10px', borderLeft: '2px solid var(--border)' },
  avatar: { width: '34px', height: '34px', borderRadius: '9px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' },
  avatarEmpty: { border: '1px solid var(--border)' },
  col: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 },
  name: {
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', color: 'var(--text)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  text: {
    fontFamily: 'var(--font-display)', fontSize: '13px', lineHeight: 1.45, color: 'var(--text2)',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  },
  meta: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '1px' },
  ago: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },
  metaBtn: {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent)', WebkitTapHighlightColor: 'transparent',
  },
  replies: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' },

  loading: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', padding: '4px 0' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text3)', textAlign: 'center', padding: '6px 0' },
  moreBtn: {
    alignSelf: 'center', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', padding: '8px 16px', fontFamily: 'var(--font-display)', fontWeight: 600,
    fontSize: '12px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
};
