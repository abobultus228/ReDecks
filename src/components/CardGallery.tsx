import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** true, если обложка — видео (анимированная карта). */
export function isVideoUrl(url: string): boolean {
  return /\.(webm|mp4)(\?|#|$)/i.test(url);
}

// ─── Пробуждение карты ─────────────────────────────────────────────────────────

export interface CardAwakening {
  potential: number | null;
  skillName: string | null;
  skillStar: number | null;
  enhancement: number;
  isBroken: boolean;
}

/** Достаёт данные пробуждения из инстанса карты (инвентарь/обмен). null — не пробуждена. */
export function toAwakening(x: {
  is_awakened?: boolean;
  is_broken?: boolean;
  potential?: number | null;
  skill?: { name?: string | null } | null;
  skill_star?: number | null;
  enhancement?: number;
} | null | undefined): CardAwakening | null {
  if (!x || (!x.is_awakened && !x.is_broken)) return null;
  return {
    potential: x.potential ?? null,
    skillName: x.skill?.name ?? null,
    skillStar: x.skill_star ?? null,
    enhancement: x.enhancement ?? 0,
    isBroken: Boolean(x.is_broken),
  };
}

/** Мелкие бейджи поверх карты (нужен родитель position:relative). */
export function CardBadges({ awakening }: { awakening?: CardAwakening | null }) {
  if (!awakening) return null;
  return (
    <>
      <div style={g.badgeTL}>
        {awakening.potential != null && <span style={g.badge}>★{awakening.potential}</span>}
        {awakening.skillStar != null && <span style={g.badge}>⚡{awakening.skillStar}</span>}
      </div>
      <div style={g.badgeTR}>
        <span style={g.badge}>+{awakening.enhancement}</span>
      </div>
      {awakening.isBroken && <div style={g.brokenLabel}>СЛОМАНА</div>}
    </>
  );
}

/** Три окошка с характеристиками пробуждённой карты (под картой в зуме). */
export function AwakenedBoxes({ awakening }: { awakening: CardAwakening }) {
  return (
    <div style={g.boxesWrap} onClick={(e) => e.stopPropagation()}>
      <div style={g.boxesTop}>
        <div style={g.box}><span style={g.boxLabel}>Потенциал:</span> ★{awakening.potential ?? '—'}</div>
        <div style={g.box}><span style={g.boxLabel}>Уровень:</span> 📈{awakening.enhancement}</div>
      </div>
      <div style={g.box}><span style={g.boxLabel}>Навык:</span> {awakening.skillName ?? '—'} ⚡{awakening.skillStar ?? 0}</div>
    </div>
  );
}

// Открытие увеличенной карты (с данными пробуждения) пробрасываем через контекст.
const ZoomContext = createContext<(cover: string, awakening?: CardAwakening | null) => void>(() => {});

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

export function CardThumb({ mid, high, awakening }: { mid: string; high?: string; awakening?: CardAwakening | null }) {
  const [err, setErr] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openZoom = useContext(ZoomContext);

  const isVid = Boolean(mid) && !err && isVideoUrl(mid);
  useVideoInView(videoRef, isVid);

  if (!mid || err) {
    return <div style={g.thumb}><div style={g.fallback} /></div>;
  }

  return (
    <div style={g.thumb} onClick={() => openZoom(high || mid, awakening)}>
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
      <CardBadges awakening={awakening} />
    </div>
  );
}

// ─── Провайдер зума + оверлей ─────────────────────────────────────────────────

export function CardZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState<{ cover: string; awakening: CardAwakening | null } | null>(null);
  const open = (cover: string, awakening?: CardAwakening | null) => setZoom({ cover, awakening: awakening ?? null });
  return (
    <ZoomContext.Provider value={open}>
      {children}
      {zoom && <ZoomOverlay cover={zoom.cover} awakening={zoom.awakening} onClose={() => setZoom(null)} />}
    </ZoomContext.Provider>
  );
}

function ZoomOverlay({ cover, awakening, onClose }: { cover: string; awakening: CardAwakening | null; onClose: () => void }) {
  const isVid = isVideoUrl(cover);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const mediaStyle = awakening ? g.zoomMediaAwk : g.zoomMedia;
  const media = isVid ? (
    <video src={cover} style={mediaStyle} onClick={stop} autoPlay loop muted playsInline />
  ) : (
    <img src={cover} style={mediaStyle} onClick={stop} alt="" />
  );

  return (
    <div style={g.zoomBackdrop} onClick={onClose}>
      <div style={g.zoomGroup}>
        {awakening?.isBroken && <div style={g.brokenBox} onClick={stop}>СЛОМАНА</div>}
        <div style={g.zoomWrap}>
          <button style={g.zoomClose} onClick={onClose} aria-label="Закрыть">×</button>
          {media}
        </div>
        {awakening && <AwakenedBoxes awakening={awakening} />}
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
    position: 'relative',
  },
  img: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  fallback: { width: '100%', height: '100%', background: 'var(--bg3)' },

  // бейджи поверх карты
  badgeTL: { position: 'absolute', top: '3px', left: '3px', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-start' },
  badgeTR: { position: 'absolute', top: '3px', right: '3px' },
  badge: {
    fontFamily: 'var(--font-mono)', fontSize: '9px', lineHeight: 1, color: '#fff',
    background: 'rgba(0,0,0,0.6)', borderRadius: '5px', padding: '2px 4px', whiteSpace: 'nowrap',
  },

  // окошки характеристик под картой в зуме
  boxesWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginTop: '12px', maxWidth: '92vw' },
  boxesTop: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' },
  box: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '8px',
    padding: '8px 12px', fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text)', whiteSpace: 'nowrap',
  },
  boxLabel: { color: 'var(--text3)' },

  // «СЛОМАНА» — красным поперёк миниатюры
  brokenLabel: {
    position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)',
    textAlign: 'center', color: 'var(--red)', fontFamily: 'var(--font-display)', fontWeight: 800,
    fontSize: '12px', letterSpacing: '0.06em', background: 'rgba(0,0,0,0.45)', padding: '3px 0',
    textShadow: '0 1px 2px rgba(0,0,0,0.9)',
  },
  // отдельное окошко «СЛОМАНА» над картой в зуме
  brokenBox: {
    background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: '8px',
    padding: '8px 18px', marginBottom: '12px', color: 'var(--red)',
    fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '21px', letterSpacing: '0.06em',
  },

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
  zoomGroup: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
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
  zoomMediaAwk: {
    maxHeight: '66vh',
    maxWidth: '85vw',
    width: 'auto',
    height: 'auto',
    display: 'block',
  },
};
