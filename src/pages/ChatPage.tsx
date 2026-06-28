import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useAppStore } from '../store';
import PageHeader from '../components/PageHeader';
import {
  getChatRooms,
  getChatMessages,
  getRoomMembers,
  pickAvatarUrl,
  resolveMediaUrl,
  roomHasUnread,
  wsEventToMessage,
  CHAT_WS_URL,
  type ChatRoom,
  type ChatMessage,
  type ChatUser,
} from '../api/extra';

const isVideo = (u: string) => /\.(webm|mp4)(\?|#|$)/i.test(u);
import { openChatSocket, type ChatSocketHandle } from '../utils/chatSocket';
import { syncNotifier } from '../utils/notifier';

function genUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Время API — московское (UTC+3). Приводим к локальному времени устройства, HH:MM. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function mskToLocalHHMM(src: string): string {
  if (!src) return '';

  let iso = src.replace(' ', 'T');
  const dot = iso.indexOf('.');
  if (dot >= 0) iso = iso.slice(0, dot);

  const d = new Date(iso + '+03:00');
  if (isNaN(d.getTime())) return '';

  const now = new Date();

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const target = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate()
  );

  const days = Math.floor(
    (today.getTime() - target.getTime()) / 86400000
  );

  if (days <= 0) {
    return d.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (days === 1) {
    return 'Вчера';
  }

  if (days < 7) {
    return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  }

  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${plural(weeks, 'неделю', 'недели', 'недель')} назад`;
  }

  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')} назад`;
  }

  const years = Math.floor(days / 365);
  return `${years} ${plural(years, 'год', 'года', 'лет')} назад`;
}

function fmtMsgTime(msg: ChatMessage): string {
  if (msg.pending) {
    const d = new Date(msg.created_at); // оптимистичное — это UTC ISO «сейчас»
    return isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return mskToLocalHHMM(msg.created_at);
}

export default function ChatPage({ onInRoomChange }: { onInRoomChange?: (inRoom: boolean) => void }) {
  const token = useAppStore((s) => s.token);
  const myId = Number(useAppStore((s) => s.userId)) || 0;
  const [room, setRoom] = useState<ChatRoom | null>(null);

  useEffect(() => {
    onInRoomChange?.(room !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  useEffect(() => {
    return () => onInRoomChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (room) {
    return <RoomView room={room} token={token} myId={myId} onBack={() => setRoom(null)} />;
  }
  return <ListView token={token} onOpen={setRoom} />;
}

// ─── Список чатов ────────────────────────────────────────────────────────────

function ListView({ token, onOpen }: { token: string; onOpen: (r: ChatRoom) => void }) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getChatRooms(token);
        if (alive) setRooms(list);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  return (
    <div style={s.root}>
      <PageHeader title="Чат" sub="сообщения" />
      <div style={s.listScroll}>
        {loading ? (
          <div style={s.center}><span style={s.spinner} /></div>
        ) : error ? (
          <p style={s.error}>{error}</p>
        ) : rooms.length === 0 ? (
          <p style={s.empty}>Чатов пока нет.</p>
        ) : (
          rooms.map((r) => {
            const cover = resolveMediaUrl(r.cover?.[0]?.url);
            const unread = roomHasUnread(r);
            const time = mskToLocalHHMM(r.last_update_dt || '');
            return (
              <button key={r.id} style={s.roomItem} onClick={() => onOpen(r)}>
                {cover
                  ? <img src={cover} alt="" style={s.roomCover} />
                  : <div style={{ ...s.roomCover, ...s.roomCoverEmpty }}>{(r.name || '?')[0]}</div>}
                <div style={s.roomMid}>
                  <span style={s.roomName}>{r.name}</span>
                  <span style={s.roomType}>{r.type}</span>
                </div>
                <div style={s.roomRight}>
                  {time && <span style={s.roomTime}>{time}</span>}
                  {unread && <span style={s.unreadDot} />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Экран переписки ─────────────────────────────────────────────────────────

const PAGE = 50;

function RoomView({
  room, token, myId, onBack,
}: { room: ChatRoom; token: string; myId: number; onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]); // старые сверху
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [, setAvatarVer] = useState(0);
  const [wsReady, setWsReady] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);

  const avatars = useRef<Map<number, ChatUser>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingPrependHeight = useRef<number | null>(null);
  const didInitScroll = useRef(false);
  const scrollBottomNext = useRef(false);
  const socketRef = useRef<ChatSocketHandle | null>(null);

  const muted = useAppStore((st) => st.mutedRoomIds.includes(room.id));
  const toggleMutedRoom = useAppStore((st) => st.toggleMutedRoom);
  const saveSettings = useAppStore((st) => st.saveSettings);

  const toggleMute = async () => {
    toggleMutedRoom(room.id);
    await saveSettings();
    await syncNotifier();
  };

  // Аппаратная кнопка «назад» Android -> возврат к списку чатов
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  useEffect(() => {
    let handle: { remove: () => void } | undefined;
    CapacitorApp.addListener('backButton', () => { onBackRef.current(); })
      .then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  const nearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Добавляет/сшивает входящее сообщение
  const pushMessage = (incoming: ChatMessage, forceBottom = false) => {
    if (forceBottom || nearBottom()) scrollBottomNext.current = true;
    setMessages((prev) => {
      // эхо нашего же сообщения — заменяем оптимистичное по local_uuid
      if (incoming.localUuid) {
        const idx = prev.findIndex((m) => m.localUuid === incoming.localUuid);
        if (idx !== -1) {
          const copy = prev.slice();
          copy[idx] = { ...incoming, pending: false };
          return copy;
        }
      }
      // дубликат по uuid — игнорируем
      if (prev.some((m) => m.uuid === incoming.uuid)) return prev;
      return [...prev, incoming];
    });
  };

  const loadMembers = async () => {
    try {
      const members = await getRoomMembers(token, room.id);
      for (const m of members) {
        avatars.current.set(m.id, {
          id: m.id,
          username: m.username || '',
          avatarUrl: pickAvatarUrl(m.avatar),
        });
      }
      setAvatarVer((v) => v + 1);
    } catch {
      // не критично — покажем кружки-заглушки
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        void loadMembers(); // аватарки/имена участников одним запросом
        const res = await getChatMessages(token, room.id);
        if (!alive) return;
        setMessages([...res].reverse());
        setHasMore(res.length >= PAGE);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pendingPrependHeight.current != null) {
      el.scrollTop = el.scrollHeight - pendingPrependHeight.current;
      pendingPrependHeight.current = null;
    } else if (!didInitScroll.current && messages.length) {
      el.scrollTop = el.scrollHeight;
      didInitScroll.current = true;
    } else if (scrollBottomNext.current) {
      el.scrollTop = el.scrollHeight;
      scrollBottomNext.current = false;
    }
  }, [messages]);

  const loadOlder = async () => {
    if (loadingOlder || !hasMore || !messages.length) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0].created_at;
      const res = await getChatMessages(token, room.id, oldest);
      if (res.length) {
        const older = [...res].reverse();
        const el = scrollRef.current;
        pendingPrependHeight.current = el ? el.scrollHeight : null;
        setMessages((prev) => [...older, ...prev]);
      }
      if (res.length < PAGE) setHasMore(false);
    } catch {
      // тихо игнорируем — попробуем при следующем скролле
    } finally {
      setLoadingOlder(false);
    }
  };

  // WebSocket: подключение, отметка «прочитано», живой приём сообщений
  useEffect(() => {
    const handle = openChatSocket(CHAT_WS_URL(token), {
      onOpen: () => {
        setWsReady(true);
        handle.send(JSON.stringify({ type: 'read', room_id: room.id }));
      },
      onMessage: (raw) => {
        let parsed: any;
        try { parsed = JSON.parse(raw); } catch { return; }
        if (parsed?.type !== 'room_event') return;
        const e = parsed.event;
        if (!e || e.discriminator !== 'message' || e.room_id !== room.id) return;
        const msg = wsEventToMessage(e);
        pushMessage(msg);
        // мы в комнате и видим сообщение — сразу двигаем «прочитано»
        socketRef.current?.send(JSON.stringify({ type: 'read', room_id: room.id }));
      },
      onClose: () => setWsReady(false),
      onError: () => setWsReady(false),
    });
    socketRef.current = handle;

    return () => {
      setWsReady(false);
      // финальная отметка «прочитано» перед закрытием — на случай своих
      // сообщений и сообщений, пришедших перед уходом
      try { handle.send(JSON.stringify({ type: 'read', room_id: room.id })); } catch { /* ignore */ }
      handle.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, token]);

    const send = () => {
      const ws = socketRef.current;
      const el = editableRef.current;
      const value = el?.innerText.trim() ?? '';

      if (!value || !wsReady || !ws) return;

      const localUuid = genUuid();

      ws.send(JSON.stringify({
        type: 'message',
        room_id: room.id,
        text: value,
        local_uuid: localUuid,
      }));

      // своё сообщение тоже должно стать «прочитанным», иначе last_read_dt
      // останется временем входа и комната повиснет непрочитанной
      ws.send(JSON.stringify({ type: 'read', room_id: room.id }));

      const optimistic: ChatMessage = {
        uuid: localUuid,
        type: 'message',
        room_id: room.id,
        author_id: myId,
        data: { text: value },
        created_at: new Date().toISOString(),
        is_deleted: false,
        localUuid,
        pending: true,
      };

      pushMessage(optimistic, true);

      if (el) {
        el.innerText = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && el.scrollTop < 80) void loadOlder();
  };

  return (
    <div style={s.root}>
      <PageHeader title={room.name} sub="чат" action={
        <div style={s.headerActions}>
          <button
            style={{ ...s.bellBtn, color: muted ? 'var(--text3)' : 'var(--accent)' }}
            onClick={toggleMute}
            aria-label={muted ? 'Включить уведомления' : 'Выключить уведомления'}
          >
            {muted ? bellOff : bellOn}
          </button>
          <button style={s.backBtn} onClick={onBack}>← к чатам</button>
        </div>
      } />

      <div ref={scrollRef} style={s.msgScroll} onScroll={onScroll}>
        {loading ? (
          <div style={s.center}><span style={s.spinner} /></div>
        ) : error ? (
          <p style={s.error}>{error}</p>
        ) : (
          <>
            {loadingOlder && <div style={s.loadOlder}><span style={s.spinner} /></div>}
            {!hasMore && <div style={s.historyTop}>начало переписки</div>}
            {messages.map((m, i) => {
              if (m.type === 'member_join' || m.type === 'member_leave') {
                return <SystemRow key={m.uuid} msg={m} users={avatars.current} />;
              }
              const mine = m.author_id === myId;
              const prev = messages[i - 1];
              const groupStart = !prev || prev.type !== 'message' || prev.author_id !== m.author_id;
              return (
                <MessageRow
                  key={m.uuid}
                  msg={m}
                  mine={mine}
                  groupStart={groupStart}
                  user={m.author_id != null ? avatars.current.get(m.author_id) : undefined}
                />
              );
            })}
          </>
        )}
      </div>

      <style>{`
        [contenteditable][data-placeholder]:empty::before {
          content: attr(data-placeholder);
          color: var(--text3);
          pointer-events: none;
        }
      `}</style>

      <div style={s.composer}>
        <div
          ref={editableRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="false"
          tabIndex={0}
          data-placeholder={wsReady ? 'Сообщение…' : 'Подключение…'}
          style={s.composerInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            if (text) document.execCommand('insertText', false, text);
          }}
        />
        <button
          style={{ ...s.sendBtn, ...(wsReady ? s.sendBtnOn : {}) }}
          onClick={send}
          disabled={!wsReady}
          aria-label="Отправить"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function MessageRow({
  msg, mine, groupStart, user,
}: { msg: ChatMessage; mine: boolean; groupStart: boolean; user?: ChatUser }) {
  const time = fmtMsgTime(msg);
  const text = msg.is_deleted
    ? 'сообщение удалено'
    : (msg.data?.text || (msg.data?.attachment ? '[вложение]' : ''));

  if (mine) {
    return (
      <div style={{ ...s.rowMine, marginTop: groupStart ? 10 : 2 }}>
        <div style={{ ...s.bubble, ...s.bubbleMine, ...(msg.is_deleted ? s.bubbleDeleted : {}), ...(msg.pending ? { opacity: 0.65 } : {}) }}>
          <span>{text}</span>
          <span style={s.bubbleTimeMine}>{time}</span>
        </div>
      </div>
    );
  }

  const avatar = user?.avatarUrl;
  return (
    <div style={{ ...s.rowOther, marginTop: groupStart ? 10 : 2 }}>
      <div style={s.avatarCol}>
        {groupStart && (avatar
          ? (isVideo(avatar)
              ? <video src={avatar} style={s.avatar} autoPlay loop muted playsInline />
              : <img src={avatar} alt="" style={s.avatar} />)
          : <div style={{ ...s.avatar, ...s.avatarEmpty }}>{(user?.username || '?')[0]}</div>)}
      </div>
      <div style={s.otherCol}>
        {groupStart && user?.username && <span style={s.author}>{user.username}</span>}
        <div style={{ ...s.bubble, ...s.bubbleOther, ...(msg.is_deleted ? s.bubbleDeleted : {}) }}>
          <span>{text}</span>
          <span style={s.bubbleTime}>{time}</span>
        </div>
      </div>
    </div>
  );
}

function SystemRow({ msg, users }: { msg: ChatMessage; users: Map<number, ChatUser> }) {
  const uid = msg.data?.id;
  const name =
    msg.data?.username ||
    (uid != null ? users.get(uid)?.username : '') ||
    (uid != null ? `id ${uid}` : 'Кто-то');
  const action = msg.type === 'member_join' ? 'зашёл в чат' : 'вышел из чата';
  return (
    <div style={s.systemRow}>
      <span style={s.systemText}>{name} {action}</span>
    </div>
  );
}

const ACCENT = 'var(--accent)';

const bellOn = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const bellOff = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
    <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
    <path d="M18 8a6 6 0 0 0-9.33-5" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },

  listScroll: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px' },
  roomItem: {
    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
    background: 'transparent', border: 'none', borderRadius: '14px', padding: '10px 12px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  roomCover: { width: '52px', height: '52px', borderRadius: '16px', objectFit: 'cover', flexShrink: 0, background: 'var(--bg3)' },
  roomCoverEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', color: 'var(--text3)' },
  roomMid: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  roomName: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  roomType: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase' },
  roomRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 },
  roomTime: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },
  unreadDot: { width: '10px', height: '10px', borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 6px rgba(56,189,248,0.6)' },

  msgScroll: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 12px 4px', display: 'flex', flexDirection: 'column' },
  loadOlder: { display: 'flex', justifyContent: 'center', padding: '8px 0' },
  historyTop: { textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text3)', padding: '6px 0 12px', letterSpacing: '0.1em', textTransform: 'uppercase' },
  systemRow: { display: 'flex', justifyContent: 'center', margin: '8px 0' },
  systemText: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', background: 'var(--bg3)', borderRadius: '12px', padding: '5px 12px', textAlign: 'center' },

  rowMine: { display: 'flex', justifyContent: 'flex-end' },
  rowOther: { display: 'flex', justifyContent: 'flex-start', gap: '8px' },
  avatarCol: { width: '32px', flexShrink: 0, display: 'flex', alignItems: 'flex-end' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', background: 'var(--bg3)' },
  avatarEmpty: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text3)' },
  otherCol: { display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '78%' },
  author: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: ACCENT, paddingLeft: '4px' },

  bubble: { display: 'inline-flex', alignItems: 'flex-end', gap: '8px', padding: '8px 12px', borderRadius: '16px', fontFamily: 'var(--font-display)', fontSize: '14px', lineHeight: 1.35, wordBreak: 'break-word' },
  bubbleMine: { background: ACCENT, color: '#fff', borderBottomRightRadius: '4px', maxWidth: '78%' },
  bubbleOther: { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', borderBottomLeftRadius: '4px' },
  bubbleDeleted: { fontStyle: 'italic', opacity: 0.6 },
  bubbleTime: { fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text3)', flexShrink: 0 },
  bubbleTimeMine: { fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'rgba(255,255,255,0.7)', flexShrink: 0 },

  composer: { display: 'flex', gap: '8px', padding: '10px 12px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--bg)', flexShrink: 0 },
  composerInput: { flex: 1, minWidth: 0, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '20px', padding: '10px 14px', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px', outline: 'none', resize: 'none', minHeight: '44px', maxHeight: '160px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.4, userSelect: 'text' },
  sendBtn: { width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: 'var(--bg3)', color: 'var(--text3)', fontSize: '22px', lineHeight: 1, flexShrink: 0, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  sendBtnOn: { background: ACCENT, color: '#fff' },

  center: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' },
  spinner: { width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-active)', borderTopColor: ACCENT, animation: 'redecks-spin 0.7s linear infinite' },
  empty: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text3)', textAlign: 'center', padding: '40px 16px' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', padding: '10px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.2)', margin: '12px' },
  backBtn: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '10px', padding: '9px 14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  headerActions: { display: 'flex', alignItems: 'center', gap: '12px' },
  bellBtn: { background: 'transparent', border: 'none', padding: 0, display: 'flex', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
};
