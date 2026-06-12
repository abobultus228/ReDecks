import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { useOpeningProcess } from '../hooks/useOpeningProcess';
import type { Card, ManualChoicePayload } from '../types';

interface Props {
  onBack: () => void;
}

// ─── Cover helpers (поддержка webm/mp4-анимаций карт) ────────────────────────

/** Достаёт абсолютный URL обложки карты из cover.mid / cover.high. */
function resolveCoverUrl(cover?: { mid?: string; high?: string }): string | null {
  const raw = cover?.mid || cover?.high;
  if (!raw) return null;
  return raw.startsWith('http') ? raw : `https://remanga.org${raw}`;
}

/** true, если обложка — видео (анимированная карта), а не картинка. */
function isVideoUrl(url: string): boolean {
  return /\.(webm|mp4)(\?|#|$)/i.test(url);
}

export default function ProcessPage({ onBack }: Props) {
  const store = useAppStore();
  const { run, stop } = useOpeningProcess();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const hasStarted = useRef(false);

  // Auto-start on mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    store.clearLogs();
    const config = store.buildConfig();
    if (!config) {
      store.addLog('❌ Ошибка: конфигурация не заполнена. Вернись назад.');
      return;
    }
    run(config);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [store.logs]);

  const handleBack = () => {
    if (store.isRunning) stop();
    onBack();
  };

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={handleBack}>
          ← назад
        </button>
        <div style={styles.headerTitle}>процесс</div>
        {store.isRunning ? (
          <button style={styles.stopBtn} onClick={stop}>
            стоп
          </button>
        ) : (
          <div style={{ width: 52 }} />
        )}
      </div>

      {/* Status badge */}
      <div style={styles.statusBar}>
        <div style={{
          ...styles.statusDot,
          background: store.isRunning ? 'var(--green)' : 'var(--text3)',
          boxShadow: store.isRunning ? '0 0 8px var(--green)' : 'none',
        }} />
        <span style={styles.statusText}>
          {store.isRunning ? 'выполняется...' : 'завершено'}
        </span>
        <span style={styles.logCount}>{store.logs.length} строк</span>
      </div>

      {/* Logs */}
      <div style={styles.logsContainer}>
        {store.logs.length === 0 ? (
          <div style={styles.emptyLogs}>запускаю...</div>
        ) : (
          store.logs.map((line, i) => (
            <LogLine key={i} text={line} />
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Manual choice overlay */}
      {store.manualChoicePayload && (
        <ManualChoiceOverlay payload={store.manualChoicePayload} />
      )}
    </div>
  );
}

// ─── Log line ────────────────────────────────────────────────────────────────

function LogLine({ text }: { text: string }) {
  if (!text) return <div style={{ height: 8 }} />;

  let color = 'var(--text2)';
  if (text.startsWith('❌')) color = 'var(--red)';
  else if (text.includes('Готово') || text.includes('выбрана')) color = 'var(--green)';
  else if (text.includes('ПРИОРИТЕТ')) color = 'var(--accent)';
  else if (text.startsWith('  ID')) color = 'var(--text3)';
  else if (text.includes('Остановлено') || text.includes('Остановка')) color = 'var(--yellow)';
  else if (text.startsWith('Открываю') || text.startsWith('Найдено')) color = 'var(--text)';

  return (
    <div style={{ ...styles.logLine, color }}>
      {text}
    </div>
  );
}

// ─── Manual choice overlay ────────────────────────────────────────────────────

function ManualChoiceOverlay({ payload }: { payload: ManualChoicePayload }) {
  const { cards, priorityIds, ownedIds, reason, resolve } = payload;
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);

  return (
    <div style={overlay.backdrop}>
      <div style={overlay.sheet}>
        <div style={overlay.title}>Ручной выбор карты</div>
        <div style={overlay.reason}>{reason}</div>

        <div style={overlay.cardList}>
          {cards.map((card) => {
            const id = Number(card.id);
            const isPriority = priorityIds.has(id);
            const isOwned = ownedIds.has(id);
            const selected = selectedCardId === id;
            
            const coverUrl = resolveCoverUrl(card.cover);

            return (
              <button
                key={id}
                style={{
                  ...cardImageStyle.root,
                  borderColor: selected ? 'var(--accent)' : 'var(--border)',
                  boxShadow: selected ? '0 0 0 2px rgba(139,92,246,0.25)' : 'none',
                }}
                onClick={() => setSelectedCardId(id)}
              >
                <div style={cardImageStyle.badgesTop}>
                  {isPriority && <span style={cardImageStyle.priorityBadge}>ПРИОРИТЕТ</span>}
                  <span style={isOwned ? cardImageStyle.ownedBadge : cardImageStyle.newBadge}>
                    {isOwned ? 'ЕСТЬ' : 'НОВАЯ'}
                  </span>
                </div>

                {coverUrl ? (
                  isVideoUrl(coverUrl) ? (
                    <video
                      src={coverUrl}
                      style={cardImageStyle.image}
                      autoPlay
                      loop
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={coverUrl}
                      style={cardImageStyle.image}
                    />
                  )
                ) : (
                  <div style={cardImageStyle.noImage}>
                    нет изображения
                  </div>
                )}

                <div style={cardImageStyle.meta}>
                  ID {id}<br />
                  score={card.score ?? '?'} · {card.rank ?? '?'}
                </div>
              </button>
            );
          })}
        </div>

        <button
          style={{
            ...overlay.confirmBtn,
            opacity: selectedCardId == null ? 0.5 : 1,
          }}
          disabled={selectedCardId == null}
          onClick={() => {
            if (selectedCardId != null) resolve(selectedCardId);
          }}
        >
          Подтвердить выбор
        </button>

        <button style={overlay.cancelBtn} onClick={() => resolve(null)}>
          Отмена (засчитать колоду)
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
  },
  backBtn: {
    background: 'transparent',
    color: 'var(--text3)',
    border: 'none',
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px',
    WebkitTapHighlightColor: 'transparent',
    minWidth: 52,
  },
  stopBtn: {
    background: 'rgba(239,68,68,0.12)',
    color: 'var(--red)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '6px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    padding: '5px 12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'background 0.3s, box-shadow 0.3s',
  },
  statusText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
    flex: 1,
  },
  logCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text3)',
  },
  logsContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px 24px',
    paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
    display: 'flex',
    flexDirection: 'column',
  },
  logLine: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    lineHeight: 1.7,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  emptyLogs: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text3)',
    textAlign: 'center',
    marginTop: '40px',
  },
};

const overlay: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(10,10,15,0.85)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    width: '100%',
    background: 'var(--surface)',
    borderTop: '1px solid var(--border-active)',
    borderRadius: '16px 16px 0 0',
    padding: '20px 16px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxHeight: '80vh',
    overflow: 'hidden',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '16px',
    color: 'var(--text)',
  },
  reason: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--yellow)',
    background: 'rgba(234,179,8,0.08)',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(234,179,8,0.2)',
  },
  cardList: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '10px',
      overflowY: 'auto',
      padding: '2px',
    },
    
  confirmBtn: {
      background: 'var(--accent)',
      color: '#fff',
      border: 'none',
      borderRadius: '10px',
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: '14px',
      padding: '13px',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    },
    
  cancelBtn: {
    background: 'transparent',
    color: 'var(--text3)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    fontFamily: 'var(--font-display)',
    fontSize: '13px',
    padding: '12px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    marginTop: '4px',
  },
};

const cardImageStyle: Record<string, React.CSSProperties> = {
  root: {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '8px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    width: '100%',
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  },
  badgesTop: {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
    minHeight: '20px',
  },
  priorityBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    color: 'var(--accent)',
    border: '1px solid var(--accent)',
    borderRadius: '5px',
    padding: '2px 5px',
  },
  newBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    color: 'var(--green)',
    border: '1px solid var(--green)',
    borderRadius: '5px',
    padding: '2px 5px',
  },
  ownedBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '9px',
    color: 'var(--text3)',
    border: '1px solid var(--text3)',
    borderRadius: '5px',
    padding: '2px 5px',
  },
  image: {
    width: '100%',
    aspectRatio: '3 / 4',
    objectFit: 'cover',
    borderRadius: '8px',
    background: 'var(--bg)',
  },
  noImage: {
    width: '100%',
    aspectRatio: '3 / 4',
    borderRadius: '8px',
    background: 'var(--bg)',
    color: 'var(--text3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
  },
  meta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    lineHeight: 1.4,
    color: 'var(--text3)',
    textAlign: 'center',
  },
};

const cardRowStyle: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '12px 14px',
    cursor: 'pointer',
    WebkitTapHighlightColor: 'transparent',
    width: '100%',
    textAlign: 'left',
    transition: 'border-color 0.15s',
  },
  left: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  id: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '15px',
    color: 'var(--text)',
  },
  meta: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text3)',
  },
  badges: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    alignItems: 'flex-end',
  },
  badge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    padding: '2px 7px',
    borderRadius: '4px',
    border: '1px solid',
    letterSpacing: '0.05em',
  },
};
