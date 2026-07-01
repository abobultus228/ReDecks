import { useEffect, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAppStore } from '../store';
import {
  startBattles,
  stopBattles,
  getBattleState,
  type EventBattleState,
} from '../utils/eventBattle';

const DELAY_MIN = 40;
const DEVIATION_MAX = 10;

type Phase = 'setup' | 'running' | 'stopped';

export default function EventPage() {
  const token = useAppStore((s) => s.token);

  const [phase, setPhase] = useState<Phase>('setup');
  const [state, setState] = useState<EventBattleState | null>(null);
  const [now, setNow] = useState(Date.now());

  const [reps, setReps] = useState('0');
  const [delay, setDelay] = useState('45');
  const [deviation, setDeviation] = useState('5');
  const [startError, setStartError] = useState('');

  const [confirmStop, setConfirmStop] = useState(false);
  const wasRunning = useRef(false);

  // При открытии — если сервис уже крутится, показываем экран выполнения
  useEffect(() => {
    (async () => {
      const st = await getBattleState();
      if (st?.running) {
        setState(st);
        setPhase('running');
        wasRunning.current = true;
      }
    })();
  }, []);

  // Пока идёт — опрашиваем состояние и тикаем таймер для шкалы обратного отсчёта
  useEffect(() => {
    if (phase !== 'running') return;
    let alive = true;

    const poll = async () => {
      const st = await getBattleState();
      if (!alive || !st) return;
      setState(st);
      if (st.running) {
        wasRunning.current = true;
      } else if (wasRunning.current) {
        setPhase('stopped');
      }
    };

    void poll();
    const pollId = setInterval(poll, 800);
    const tickId = setInterval(() => setNow(Date.now()), 100);
    return () => {
      alive = false;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, [phase]);

  const repsN = parseInt(reps, 10);
  const delayN = parseInt(delay, 10);
  const deviationN = parseInt(deviation, 10);

  const validReps = Number.isInteger(repsN) && repsN >= 0;
  const validDelay = Number.isInteger(delayN) && delayN >= DELAY_MIN;
  const validDeviation = Number.isInteger(deviationN) && deviationN >= 0 && deviationN <= DEVIATION_MAX;
  const canStart = validReps && validDelay && validDeviation;

  const start = async () => {
    setStartError('');
    try {
      await startBattles({
        token,
        repetitions: repsN,
        delaySeconds: delayN,
        deviationSeconds: deviationN,
      });
      wasRunning.current = false;
      setState(null);
      setPhase('running');
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    }
  };

  const doStop = async () => {
    await stopBattles();
    setConfirmStop(false);
    const st = await getBattleState();
    setState(st);
    setPhase('stopped');
  };

  if (phase === 'setup') {
    return (
      <div style={p.root}>
        <PageHeader title="Ивент" sub="авто-дуэли" />
        <div style={p.scroll}>
          <div style={p.card}>
            <NumberField label="Сколько повторений" hint="0 — бесконечно" value={reps} onChange={setReps} invalid={!validReps} />
            <div style={p.divider} />
            <NumberField label="Задержка, сек" hint={`минимум ${DELAY_MIN}`} value={delay} onChange={setDelay} invalid={!validDelay} />
            <div style={p.divider} />
            <NumberField label="Отклонение, сек" hint={`0–${DEVIATION_MAX}`} value={deviation} onChange={setDeviation} invalid={!validDeviation} />
          </div>

          {startError && <p style={p.error}>{startError}</p>}

          <button style={{ ...p.primaryBtn, ...(canStart ? {} : p.btnDisabled) }} onClick={start} disabled={!canStart}>
            Запустить
          </button>

          <p style={p.note}>
            Дуэли идут в фоне с постоянным уведомлением. Процесс сам остановится,
            если ответ сервера будет неожиданным.
          </p>
        </div>
      </div>
    );
  }

  const done = state?.battlesDone ?? 0;
  const wins = state?.wins ?? 0;
  const total = state?.total ?? 0;
  const infinite = total === 0;

  const remainingMs = state?.nextBattleAtMs ? Math.max(0, state.nextBattleAtMs - now) : 0;
  const waitMs = state?.waitMs ?? 0;
  const cdFrac = waitMs > 0 ? Math.max(0, Math.min(1, remainingMs / waitMs)) : 0;
  const progFrac = infinite ? 0 : Math.max(0, Math.min(1, done / total));

  const stopped = phase === 'stopped';

  return (
    <div style={p.root}>
      <PageHeader title="Ивент" sub={stopped ? 'остановлено' : 'идут дуэли'} />
      <div style={p.scroll}>
        {!stopped && (
          <div style={p.card}>
            <div style={p.barLabelRow}>
              <span style={p.barLabel}>До следующей дуэли</span>
              <span style={p.barValue}>{Math.ceil(remainingMs / 1000)} с</span>
            </div>
            <div style={p.barTrack}>
              <div style={{ ...p.barFill, width: `${cdFrac * 100}%` }} />
            </div>
          </div>
        )}

        <div style={p.card}>
          <div style={p.barLabelRow}>
            <span style={p.barLabel}>Прогресс</span>
            <span style={p.barValue}>{infinite ? `${done} · ∞` : `${done} / ${total}`}</span>
          </div>
          {!infinite && (
            <div style={p.barTrack}>
              <div style={{ ...p.barFill, ...p.barFillGreen, width: `${progFrac * 100}%` }} />
            </div>
          )}
        </div>

        <div style={p.statsRow}>
          <div style={p.statBox}>
            <div style={p.statNum}>{done}</div>
            <div style={p.statLabel}>битв</div>
          </div>
          <div style={p.statBox}>
            <div style={{ ...p.statNum, color: 'var(--green)' }}>{wins}</div>
            <div style={p.statLabel}>побед</div>
          </div>
          <div style={p.statBox}>
            <div style={p.statNum}>{Math.max(0, done - wins)}</div>
            <div style={p.statLabel}>поражений</div>
          </div>
        </div>

        {stopped && (
          <div style={p.stoppedBox}>
            <div style={p.stoppedTitle}>Процесс остановлен</div>
            {state?.stoppedReason && <div style={p.stoppedReason}>{state.stoppedReason}</div>}
          </div>
        )}
      </div>

      <div style={p.footer}>
        {stopped ? (
          <button style={p.primaryBtn} onClick={() => setPhase('setup')}>Назад к настройке</button>
        ) : (
          <button style={p.dangerBtn} onClick={() => setConfirmStop(true)}>Остановить</button>
        )}
      </div>

      <ConfirmDialog
        open={confirmStop}
        title="Остановить процесс?"
        confirmLabel="Остановить"
        cancelLabel="Отмена"
        danger
        onConfirm={doStop}
        onCancel={() => setConfirmStop(false)}
      />
    </div>
  );
}

function NumberField({
  label, hint, value, onChange, invalid,
}: {
  label: string; hint: string; value: string; onChange: (v: string) => void; invalid: boolean;
}) {
  return (
    <div style={p.fieldRow}>
      <div style={p.fieldText}>
        <span style={p.fieldLabel}>{label}</span>
        <span style={p.fieldHint}>{hint}</span>
      </div>
      <input
        style={{ ...p.input, ...(invalid ? p.inputInvalid : {}) }}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        inputMode="numeric"
        type="text"
      />
    </div>
  );
}

const p: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' },

  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '4px 16px' },
  divider: { height: '1px', background: 'var(--border)' },

  fieldRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 0' },
  fieldText: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  fieldLabel: { fontFamily: 'var(--font-display)', fontSize: '15px', color: 'var(--text)' },
  fieldHint: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },
  input: {
    width: '90px', textAlign: 'center', flexShrink: 0,
    background: 'var(--bg3)', color: 'var(--text)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '10px', fontFamily: 'var(--font-mono)', fontSize: '16px', outline: 'none',
  },
  inputInvalid: { borderColor: 'var(--red)' },

  primaryBtn: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: '#fff',
    background: 'var(--accent)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '14px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  dangerBtn: {
    width: '100%', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: '#fff',
    background: 'var(--red)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '14px',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  },
  btnDisabled: { opacity: 0.5, cursor: 'default' },

  note: { fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--text3)', lineHeight: 1.5, textAlign: 'center' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' },

  barLabelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0 8px' },
  barLabel: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },
  barValue: { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text)' },
  barTrack: { height: '10px', background: 'var(--bg3)', borderRadius: '999px', overflow: 'hidden', marginBottom: '14px' },
  barFill: { height: '100%', background: 'var(--accent)', borderRadius: '999px', transition: 'width 0.1s linear' },
  barFillGreen: { background: 'var(--green)', transition: 'width 0.3s ease' },

  statsRow: { display: 'flex', gap: '10px' },
  statBox: { flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', textAlign: 'center' },
  statNum: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '24px', color: 'var(--text)' },
  statLabel: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '2px' },

  stoppedBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', textAlign: 'center' },
  stoppedTitle: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)' },
  stoppedReason: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', marginTop: '6px', lineHeight: 1.4 },

  footer: { padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg)' },
};
