import { useState } from 'react';
import { useAppStore } from '../store';
import { isVideoUrl } from './CardGallery';

/**
 * Квадратная аватарка пользователя. По тапу — меню «Предложить обмен / Закрыть».
 * userId=null → аватарка без меню (автор неизвестен).
 */
export default function UserAvatar({
  url, userId, size = 40, radius = 10, premium = false, fallbackText, style,
}: {
  url: string;
  userId: number | null;
  size?: number;
  radius?: number;
  premium?: boolean;
  fallbackText?: string;
  style?: React.CSSProperties;
}) {
  const setExchangeTargetUserId = useAppStore((s) => s.setExchangeTargetUserId);
  const setChatTargetUserId = useAppStore((s) => s.setChatTargetUserId);
  const [err, setErr] = useState(false);
  const [menu, setMenu] = useState(false);

  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: radius, objectFit: 'cover', flexShrink: 0,
    background: 'var(--bg3)', cursor: userId != null ? 'pointer' : 'default',
    ...(premium ? { border: '1.5px solid var(--accent)' } : {}),
    ...style,
  };

  const isVid = Boolean(url) && !err && isVideoUrl(url);
  const open = () => { if (userId != null) setMenu(true); };

  const offer = () => {
    setMenu(false);
    if (userId != null) setExchangeTargetUserId(userId);
  };

  const message = () => {
    setMenu(false);
    if (userId != null) setChatTargetUserId(userId);
  };

  return (
    <>
      {!url || err ? (
        <div
          style={{
            ...base,
            border: base.border ?? '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text3)',
            fontSize: `${Math.round(size * 0.42)}px`,
          }}
          onClick={open}
        >
          {fallbackText ? fallbackText[0] : ''}
        </div>
      ) : isVid ? (
        <video src={url} style={base} autoPlay loop muted playsInline onError={() => setErr(true)} onClick={open} />
      ) : (
        <img src={url} style={base} onError={() => setErr(true)} onClick={open} alt="" />
      )}

      {menu && (
        <div style={m.backdrop} onClick={() => setMenu(false)}>
          <div style={m.sheet} onClick={(e) => e.stopPropagation()}>
            <button style={m.item} onClick={offer}>Предложить обмен</button>
            <div style={m.sep} />
            <button style={m.item} onClick={message}>Написать сообщение</button>
            <div style={m.sep} />
            <button style={{ ...m.item, ...m.close }} onClick={() => setMenu(false)}>Закрыть</button>
          </div>
        </div>
      )}
    </>
  );
}

const m: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px',
  },
  sheet: {
    width: '100%', maxWidth: '280px', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', overflow: 'hidden',
  },
  item: {
    width: '100%', background: 'none', border: 'none', padding: '15px',
    fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  close: { color: 'var(--text3)', fontWeight: 600 },
  sep: { height: '1px', background: 'var(--border)' },
};
