import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** true, если обложка — видео (анимированная карта). */
export function isVideoUrl(url: string): boolean {
  return /\.(webm|mp4)(\?|#|$)/i.test(url);
}

// Открытие увеличенной карты пробрасываем через контекст.
const ZoomContext = createContext<(coverHigh: string) => void>(() => {});

/** Открыть карту в зуме из кастомной ячейки (внутри CardZoomProvider). */
export const useCardZoom = () => useContext(ZoomContext);

// ─── Ленивое воспроизведение webm ─────────────────────────────────────────────
// Один общий наблюдатель: проигрываем только видимые карты, невидимые на паузе.

let videoObserver: IntersectionObserver | null = null;
const videoHandlers = new WeakMap<Element, (visible: boolean) => void>();

function getVideoObserver(): IntersectionObserver {
  if (!videoObserver) {
    videoObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) videoHandlers.get(entry.target)?.(entry.isIntersecting);
      },
      { root: null, rootMargin: '150px', threshold: 0.01 }
    );
  }
  return videoObserver;
}

function useVideoInView(ref: React.RefObject<HTMLVideoElement>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    el.muted = true;
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

// ─── Горизонтальный скроллер карт ─────────────────────────────────────────────
// При касании одного гасим инерцию у остальных (иначе на Android «улетают»).

const cardScrollers = new Set<HTMLDivElement>();

function stopFling(el: HTMLDivElement) {
  const left = el.scrollLeft;
  el.style.overflowX = 'hidden';
  void el.offsetWidth;
  el.style.overflowX = 'auto';
  el.scrollLeft = left;
}

export function CardScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    cardScrollers.add(el);
    return () => { cardScrollers.delete(el); };
  }, []);
  const onTouchStart = () => {
    const self = ref.current;
    cardScrollers.forEach((el) => { if (el !== self) stopFling(el); });
  };
  return (
    <div ref={ref} style={g.scroller} onTouchStart={onTouchStart}>
      {children}
    </div>
  );
}

// ─── Одна карта ───────────────────────────────────────────────────────────────

export function CardThumb({ mid, high }: { mid: string; high?: string }) {
  const [err, setErr] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openZoom = useContext(ZoomContext);

  const isVid = Boolean(mid) && !err && isVideoUrl(mid);
  useVideoInView(videoRef, isVid);

  if (!mid || err) {
    return <div style={g.thumb}><div style={g.fallback} /></div>;
  }

  return (
    <div style={g.thumb} onClick={() => openZoom(high || mid)}>
      {isVid ? (
        <video
          ref={videoRef}
          src={mid}
          style={g.img}
          loop
          muted
          playsInline
          preload="none"
          onError={() => setErr(true)}
        />
      ) : (
        <img
          src={mid}
          style={g.img}
          onError={() => setErr(true)}
          loading="lazy"
          decoding="async"
          alt=""
        />
      )}
    </div>
  );
}

// ─── Провайдер зума + оверлей ─────────────────────────────────────────────────

export function CardZoomProvider({ children }: { children: React.ReactNode }) {
  const [cover, setCover] = useState<string | null>(null);
  return (
    <ZoomContext.Provider value={setCover}>
      {children}
      {cover && <ZoomOverlay cover={cover} onClose={() => setCover(null)} />}
    </ZoomContext.Provider>
  );
}

function ZoomOverlay({ cover, onClose }: { cover: string; onClose: () => void }) {
  const isVid = isVideoUrl(cover);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div style={g.zoomBackdrop} onClick={onClose}>
      <div style={g.zoomWrap}>
        <button style={g.zoomClose} onClick={onClose} aria-label="Закрыть">×</button>
        {isVid ? (
          <video src={cover} style={g.zoomMedia} onClick={stop} autoPlay loop muted playsInline />
        ) : (
          <img src={cover} style={g.zoomMedia} onClick={stop} alt="" />
        )}
      </div>
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────

const g: Record<string, React.CSSProperties> = {
  scroller: {
    display: 'flex',
    gap: '8px',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: '2px',
    scrollSnapType: 'x proximity',
  },
  thumb: {
    flex: '0 0 auto',
    width: 'calc((100% - 24px) / 4)',
    aspectRatio: '2 / 3',
    borderRadius: '8px',
    overflow: 'hidden',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    scrollSnapAlign: 'start',
    cursor: 'pointer',
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  fallback: { width: '100%', height: '100%', background: 'var(--bg3)' },

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
};
