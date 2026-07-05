import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import ConfirmDialog from '../components/ConfirmDialog';
import { captureAllCookies } from '../utils/cookies';
import { getDailyRemaining, addDailyRead, DAILY_MAX } from '../utils/dailyLimit';
import {
  startChapterRead,
  stopChapterRead,
  getChapterReadState,
  getNativeCookies,
  testViews,
  type ChapterReadState,
} from '../utils/chapterRead';
import type { LimitedTitle } from '../utils/limitedTitles';

type Phase = 'intro' | 'count' | 'run';
const MAX_PER_RUN = 500;

export default function LimitedRun({
  title, onBack,
}: {
  title: LimitedTitle;
  onBack: () => void;
}) {
  const token = useAppStore((s) => s.token);

  const [phase, setPhase] = useState<Phase>('intro');
  const [cookie, setCookie] = useState('');
  const [nativeCookie, setNativeCookie] = useState('');
  const [cookieBusy, setCookieBusy] = useState(false);
  const [error, setError] = useState('');

  const [count, setCount] = useState('50');
  const [remaining, setRemaining] = useState(DAILY_MAX);
  // Режим запроса: true — слать куки (прежнее поведение), false — голый Bearer.
  const [sendCookies, setSendCookies] = useState(true);

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
      const log = await testViews(token, TEST_CHAPTER, sendCookies);
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
      if (st?.running) {
        setState(st);
        setPhase('run');
        wasRunning.current = true;
        dailyAdded.current = false;
      }
    })();
  }, []);

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

  const getCookies = async () => {
    setError('');
    setCookieBusy(true);
    try {
      const c = await captureAllCookies();
      if (!c) throw new Error('Куки пустые');
      setCookie(c);
      setNativeCookie(await getNativeCookies());
      setPhase('count');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCookieBusy(false);
    }
  };

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
        cookie: sendCookies ? cookie : '',
        branchId: title.branchId,
        target: countN,
        sendCookies,
      });
      setPhase('run');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const doStop = async () => {
    setConfirmStop(false);
    await stopChapterRead();
  };

  // ─── UI ───────────────────────────────────────────────────────────────────

  const done = state?.readsDone ?? 0;
  const target = state?.target ?? countN;
  const coins = state?.coins ?? 0;
  const cards = state?.cards ?? 0;
  const frac = target > 0 ? Math.max(0, Math.min(1, done / target)) : 0;
  const running = state?.running ?? false;
  const finished = phase === 'run' && !running && wasRunning.current;

  return (
    <div style={s.root}>
      <div style={s.topRow}>
        <button style={s.back} onClick={onBack}>← назад</button>
        <span style={s.titleName}>{title.name}</span>
      </div>

      <div style={s.body}>
        {phase === 'intro' && (
          <div style={s.card}>
            <p style={s.text}>
              Для чтения глав нужны твои свежие куки. Откроется браузер — войди
              на remanga.org (если ещё не вошёл), и куки заберутся автоматически.
            </p>
            {error && <p style={s.error}>{error}</p>}
            <button
              style={{ ...s.primary, ...(cookieBusy ? s.disabled : {}) }}
              onClick={getCookies}
              disabled={cookieBusy}
            >
              {cookieBusy ? 'Открываю браузер…' : 'Получить куки'}
            </button>
          </div>
        )}

        {phase === 'count' && (
          <div style={s.card}>
            <p style={s.ok}>✓ Куки получены</p>
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
            {remaining <= 0 && <p style={s.error}>Дневной лимит {DAILY_MAX} исчерпан.</p>}
            {error && <p style={s.error}>{error}</p>}

            <details>
              <summary style={s.hint}>
                document.cookie (JS) — {cookie.split(';').filter(Boolean).length} шт.
              </summary>
              <div style={s.cookieDump}>{cookie || '(пусто)'}</div>
            </details>
            <details>
              <summary style={s.hint}>
                CookieManager (уходят в запрос, вкл. HttpOnly) — {nativeCookie.split(';').filter(Boolean).length} шт.
              </summary>
              <div style={s.cookieDump}>{nativeCookie || '(пусто)'}</div>
            </details>

            <label style={s.label}>Режим запроса</label>
            <div style={s.seg}>
              <button
                style={{ ...s.segBtn, ...(!sendCookies ? s.segOn : {}) }}
                onClick={() => setSendCookies(false)}
              >
                Голый токен
              </button>
              <button
                style={{ ...s.segBtn, ...(sendCookies ? s.segOn : {}) }}
                onClick={() => setSendCookies(true)}
              >
                С куки
              </button>
            </div>
            <p style={s.hint}>
              {sendCookies
                ? 'В запросы чтения/сброса добавляется Cookie (вкл. HttpOnly).'
                : 'Куки не отправляются — только Authorization: Bearer.'}
            </p>

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
    </div>
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
  ok: { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--green)' },
  label: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '18px', textAlign: 'center', outline: 'none' },
  hint: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)' },

  seg: { display: 'flex', gap: '6px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px' },
  segBtn: { flex: 1, background: 'transparent', color: 'var(--text2)', border: 'none', borderRadius: '6px', padding: '10px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  segOn: { background: 'var(--accent)', color: '#fff' },

  barLabelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  barLabel: { fontFamily: 'var(--font-display)', fontSize: '14px', color: 'var(--text2)' },
  barValue: { fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text)' },
  barTrack: { height: '10px', background: 'var(--bg3)', borderRadius: '999px', overflow: 'hidden' },
  barFill: { height: '100%', background: 'var(--accent)', borderRadius: '999px', transition: 'width 0.3s ease' },

  statsRow: { display: 'flex', gap: '10px' },
  statBox: { flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px', textAlign: 'center' },
  statNum: { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '20px', color: 'var(--text)' },
  statLabel: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text3)', marginTop: '2px' },

  stoppedBox: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', textAlign: 'center' },
  stoppedTitle: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: 'var(--text)' },
  stoppedReason: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text3)', marginTop: '6px', lineHeight: 1.4 },

  primary: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  secondary: { background: 'var(--bg3)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  testHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', marginBottom: '6px' },
  copyBtn: { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  testLog: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '280px', overflowY: 'auto', margin: 0 },
  danger: { width: '100%', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '13px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '14px', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' },
  disabled: { opacity: 0.5, cursor: 'default' },
  error: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' },
  cookieDump: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text2)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px', marginTop: '6px', wordBreak: 'break-all', maxHeight: '160px', overflowY: 'auto' },

  footer: { padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 },
};
