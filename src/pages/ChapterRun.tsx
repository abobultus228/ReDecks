import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import ConfirmDialog from '../components/ConfirmDialog';
import { CardZoomProvider, isVideoUrl, useCardZoom } from '../components/CardGallery';
import { resolveMediaUrl } from '../api/extra';
import { getDailyRemaining, addDailyRead, resetDailyRead, DAILY_MAX } from '../utils/dailyLimit';
import {
  startChapterRead,
  stopChapterRead,
  getChapterReadState,
  testViews,
  type ChapterReadState,
} from '../utils/chapterRead';

type Phase = 'count' | 'run';
const MAX_PER_RUN = 800;

export default function ChapterRun({
  title, onBack,
}: {
  title: { branchId: number; name: string };
  onBack: () => void;
}) {
  const token = useAppStore((s) => s.token);

  const [phase, setPhase] = useState<Phase>('count');
  const [error, setError] = useState('');

  const [count, setCount] = useState('50');
  const [remaining, setRemaining] = useState(DAILY_MAX);

  // Параметры прогона
  const [delaySec, setDelaySec] = useState(1.0);   // задержка между главами, с (0.3..1)
  const [like, setLike] = useState(true);          // лайкать ли главы
  const [ignore502, setIgnore502] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Тестовый запрос
  const TEST_CHAPTER = 30125;
  const [testLog, setTestLog] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const runTest = async () => {
    setTestBusy(true);
    setCopied(false);
    setTestLog('');
    try {
      const log = await testViews(token, TEST_CHAPTER);
      setTestLog(log || '(пустой ответ)');
    } catch (e) {
      setTestLog('Ошибка: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setTestBusy(false);
    }
  };

  const copyTestLog = async () => {
    try {
      await navigator.clipboard.writeText(testLog);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // запасной путь, если Clipboard API недоступен
      try {
        const ta = document.createElement('textarea');
        ta.value = testLog;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* ignore */ }
    }
  };

  const [state, setState] = useState<ChapterReadState | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const wasRunning = useRef(false);
  const dailyAdded = useRef(false);

  useEffect(() => {
    void getDailyRemaining().then(setRemaining);
  }, []);

  // если сервис уже крутится (вернулись в приложение) — показываем экран прогона
  useEffect(() => {
    (async () => {
      const st = await getChapterReadState();
      if (st?.running && st.branchId === title.branchId) {
        setState(st);
        setPhase('run');
        wasRunning.current = true;
        dailyAdded.current = false;
      } else if (st?.running) {
        setError('Уже запущено чтение другого тайтла. Сначала останови его.');
      }
    })();
  }, [title.branchId]);

  // опрос состояния во время прогона
  useEffect(() => {
    if (phase !== 'run') return;
    let alive = true;

    const poll = async () => {
      const st = await getChapterReadState();
      if (!alive || !st) return;
      setState(st);
      if (st.running) {
        wasRunning.current = true;
      } else if (wasRunning.current && !dailyAdded.current) {
        // прогон завершился — учтём прочитанное в дневном счётчике (приблизительно)
        dailyAdded.current = true;
        await addDailyRead(st.readsDone);
        void getDailyRemaining().then(setRemaining);
      }
    };

    void poll();
    const id = setInterval(poll, 500);
    return () => { alive = false; clearInterval(id); };
  }, [phase]);

  const countN = parseInt(count, 10);
  const maxAllowed = Math.min(MAX_PER_RUN, remaining);
  const validCount = Number.isInteger(countN) && countN >= 1 && countN <= maxAllowed;

  const start = async () => {
    setError('');
    try {
      wasRunning.current = false;
      dailyAdded.current = false;
      setState(null);
      await startChapterRead({
        token,
        branchId: title.branchId,
        target: countN,
        delayMs: Math.round(delaySec * 1000),
        like,
        ignore502,
      });
      wasRunning.current = true;
      setPhase('run');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doStop = async () => {
    setConfirmStop(false);
    await stopChapterRead();
  };

  const doResetLimit = async () => {
    setConfirmReset(false);
    await resetDailyRead();
    void getDailyRemaining().then(setRemaining);
  };

  // ─── UI ───────────────────────────────────────────────────────────────────

  const done = state?.readsDone ?? 0;
  const target = state?.target ?? countN;
  const coins = state?.coins ?? 0;
  const cards = state?.cards ?? 0;
  const rewardCards = state?.rewardCards ?? [];
  const frac = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  const running = state?.running ?? false;
  const finished = phase === 'run' && !running && wasRunning.current;

  return (
    <CardZoomProvider>
    <div style={s.root}>
      <div style={s.topRow}>
        <button style={s.back} onClick={onBack}>← назад</button>
        <span style={s.titleName}>{title.name}</span>
      </div>

      <div style={s.body}>
        {phase === 'count' && (
          <div style={s.card}>
            <label style={s.label}>Сколько глав прочитать</label>
            <input
              style={s.input}
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric"
              type="text"
            />
            <p style={s.hint}>
              Максимум за раз: {maxAllowed}. Осталось на сегодня: {remaining} из {DAILY_MAX}.
            </p>
            <button style={s.resetLink} onClick={() => setConfirmReset(true)}>
              Сбросить дневной лимит
            </button>
            {remaining <= 0 && <p style={s.error}>Дневной лимит {DAILY_MAX} исчерпан.</p>}
            {error && <p style={s.error}>{error}</p>}

            <div style={s.divider} />

            <div style={s.sliderHead}>
              <span style={s.label}>Задержка между главами</span>
              <span style={s.sliderVal}>{delaySec.toFixed(1)} с</span>
            </div>
            <input
              style={s.slider}
              type="range"
              min={0.3}
              max={1}
              step={0.1}
              value={delaySec}
              onChange={(e) => setDelaySec(parseFloat(e.target.value))}
            />

            <label style={s.checkRow}>
              <input
                style={s.checkbox}
                type="checkbox"
                checked={like}
                onChange={(e) => setLike(e.target.checked)}
              />
              <span style={s.checkLabel}>Лайкать главы</span>
            </label>

            <label style={s.checkRow}>
              <input
                style={s.checkbox}
                type="checkbox"
                checked={ignore502}
                onChange={(e) => setIgnore502(e.target.checked)}
              />
              <span style={s.checkLabel}>Игнорировать 502 Ошибку</span>
            </label>

            <button
              style={{ ...s.secondary, ...(testBusy ? s.disabled : {}) }}
              onClick={runTest}
              disabled={testBusy}
            >
              {testBusy ? 'Отправляю…' : `Тестовый запрос (гл. ${TEST_CHAPTER})`}
            </button>
            {testLog && (
              <div>
                <div style={s.testHead}>
                  <span style={s.hint}>Лог запроса и ответа</span>
                  <button style={s.copyBtn} onClick={copyTestLog}>
                    {copied ? '✓ скопировано' : 'Копировать'}
                  </button>
                </div>
                <pre style={s.testLog}>{testLog}</pre>
              </div>
            )}

            <button
              style={{ ...s.primary, ...(validCount ? {} : s.disabled) }}
              onClick={start}
              disabled={!validCount}
            >
              Запустить
            </button>
          </div>
        )}

        {phase === 'run' && (
          <>
            <div style={s.card}>
              <div style={s.barLabelRow}>
                <span style={s.barLabel}>Прочитано</span>
                <span style={s.barValue}>{done} / {target}</span>
              </div>
              <div style={s.barTrack}>
                <div style={{ ...s.barFill, width: `${frac * 100}%` }} />
              </div>
            </div>

            <div style={s.statsRow}>
              <div style={s.statBox}>
                <div style={s.statNum}>{done}</div>
                <div style={s.statLabel}>глав</div>
              </div>
              <div style={s.statBox}>
                <div style={{ ...s.statNum, color: 'var(--yellow)' }}>⚡ {coins}</div>
                <div style={s.statLabel}>молний</div>
              </div>
              <div style={s.statBox}>
                <div style={{ ...s.statNum, color: 'var(--accent)' }}>🃏 {cards}</div>
                <div style={s.statLabel}>карт</div>
              </div>
            </div>

            {rewardCards.length > 0 && (
              <div style={s.rewardsSection}>
                <div style={s.rewardsTitle}>Выпавшие карты</div>
                <div style={s.rewardsGrid}>
                  {rewardCards.map((card, index) => (
                    <RewardCardCell key={`${index}-${card.mid}`} mid={card.mid} high={card.high} />
                  ))}
                </div>
              </div>
            )}

            {finished && (
              <div style={s.stoppedBox}>
                <div style={s.stoppedTitle}>Процесс завершён</div>
                {state?.stoppedReason && <div style={s.stoppedReason}>{state.stoppedReason}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {phase === 'run' && (
        <div style={s.footer}>
          {running ? (
            <button style={s.danger} onClick={() => setConfirmStop(true)}>Остановить</button>
          ) : (
            <button style={s.primary} onClick={() => setPhase('count')}>Назад</button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop}
        title="Остановить чтение?"
        confirmLabel="Остановить"
        cancelLabel="Отмена"
        danger
        onConfirm={doStop}
        onCancel={() => setConfirmStop(false)}
      />

      <ConfirmDialog
        open={confirmReset}
        title="Сбросить дневной лимит?"
        message="Сбрасывать лимит следует только если он не сбросился самостоятельно, вы уверены?"
        confirmLabel="Сбросить"
        cancelLabel="Отмена"
        danger
        onConfirm={doResetLimit}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
    </CardZoomProvider>
  );
}

function RewardCardCell({ mid, high }: { mid: string; high: string }) {
  const openZoom = useCardZoom();
  const preview = resolveMediaUrl(mid || high);
  const full = resolveMediaUrl(high || mid);
  if (!preview) return null;

  return (
    <button style={s.rewardCard} onClick={() => openZoom(full)} aria-label="Открыть карту">
      {isVideoUrl(preview) ? (
        <video src={preview} style={s.rewardMedia} autoPlay loop muted playsInline />
      ) : (
        <img src={preview} style={s.rewardMedia} loading="lazy" alt="Выпавшая карта" />
      )}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  topRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  back: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', background: 'transparent', border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', flexShrink: 0 },
  titleName: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' },
  text: { fontFamily: 'var(--font-display)', fontSize: '13px', color: 'var(--text2)', lineHeight: 1.6 },
  label: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '18px', textAlign: 'center', outline: 'none' },
  hint: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },


  barLabelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },
  barValue: { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text)' },
  barTrack: { height: '10px', background: 'var(--bg3)', borderRadius: '999px', overflow: 'hidden' },
  barFill: { height: '100%', background: 'var(--accent)', borderRadius: '999px', transition: 'width 0.3s ease' },

  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' },
  statBox: { minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 6px', textAlign: 'center' },
  statNum: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(12px, 4vw, 20px)', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  statLabel: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '2px', whiteSpace: 'nowrap' },
  rewardsSection: { display: 'flex', flexDirection: 'column', gap: '10px' },
  rewardsTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  rewardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' },
  rewardCard: { width: '100%', minWidth: 0, aspectRatio: '2 / 3', padding: 0, overflow: 'hidden', borderRadius: '8px', background: 'var(--bg3)', border: '1px solid var(--border)', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  rewardMedia: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },

  stoppedBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', textAlign: 'center' },
  stoppedTitle: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)' },
  stoppedReason: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', marginTop: '6px', lineHeight: 1.4 },

  primary: { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  secondary: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  testHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', marginBottom: '6px' },
  copyBtn: { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  testLog: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '280px', overflowY: 'auto', margin: 0 },
  danger: { width: '100%', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  disabled: { opacity: 0.5, cursor: 'default' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' },

  resetLink: { alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: '2px 0', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: '11px', textDecoration: 'underline', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  divider: { height: '1px', background: 'var(--border)', margin: '2px 0' },
  sliderHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  sliderVal: { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text)' },
  slider: { width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  checkbox: { width: '18px', height: '18px', accentColor: 'var(--accent)', cursor: 'pointer' },
  checkLabel: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },

  footer: { padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 },
};
