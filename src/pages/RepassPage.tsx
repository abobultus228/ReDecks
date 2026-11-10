import { useEffect, useRef, useState } from 'react';
import PageHeader from '../components/PageHeader';
import { collectAllChapters, getTitleContent, type ChapterRef } from '../api/extra';
import { findRepassTitles, getActiveRepassGroups } from '../api/repass';
import type { RepassTaskGroup } from '../utils/repassLogic';
import { getChapterReadState } from '../utils/chapterRead';
import { useAppStore } from '../store';
import { getPendingRepassRestore, recoverRepassChapter, runRepassChapter } from '../utils/repassRun';

interface PreparedTitle {
  id: number;
  name: string;
  branchId: number;
  chapter: ChapterRef;
  matches: string[];
}

type Phase = 'idle' | 'preparing' | 'ready' | 'running' | 'done' | 'repairing';
let activeRun = false;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function RepassPage() {
  const { token, userId } = useAppStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [groups, setGroups] = useState<RepassTaskGroup[]>([]);
  const [titles, setTitles] = useState<PreparedTitle[]>([]);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [restoreNeeded, setRestoreNeeded] = useState(false);
  const [done, setDone] = useState<number[]>([]);
  const mounted = useRef(true);
  const searchId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    if (activeRun) {
      setError('Re:pass уже выполняется. Дождитесь завершения, затем откройте вкладку снова.');
      return () => { mounted.current = false; };
    }
    let cancelled = false;
    const recover = async () => {
      try {
        const pending = await getPendingRepassRestore(userId);
        if (!pending) return;
        if (!cancelled) setRestoreNeeded(true);
        if (!cancelled) {
          setPhase('repairing');
          setProgress(`Восстанавливаем отметку главы ${pending.chapterId}…`);
        }
        await recoverRepassChapter(token, userId);
        if (!cancelled) {
          setRestoreNeeded(false);
          setProgress('Исходная отметка главы восстановлена.');
        }
      } catch (cause) {
        if (!cancelled) setError(`Автовосстановление не удалось: ${message(cause)}. Повторите восстановление перед новым запуском.`);
      } finally {
        if (!cancelled) setPhase('idle');
      }
    };
    void recover();
    return () => { cancelled = true; mounted.current = false; searchId.current++; };
  }, [token, userId]);

  const retryRecovery = async () => {
    setPhase('repairing');
    setError('');
    try {
      await recoverRepassChapter(token, userId);
      setRestoreNeeded(false);
      setProgress('Исходная отметка главы восстановлена.');
    } catch (cause) {
      setError(`Не удалось восстановить главу: ${message(cause)}`);
    } finally {
      setPhase('idle');
    }
  };

  const prepare = async () => {
    if (activeRun) {
      setError('Re:pass уже выполняется.');
      return;
    }
    const currentSearch = ++searchId.current;
    setPhase('preparing');
    setError('');
    setDone([]);
    setTitles([]);
    setGroups([]);
    setProgress('Получаем задания на сегодня…');
    try {
      if (await getPendingRepassRestore(userId)) {
        setRestoreNeeded(true);
        throw new Error('Сначала восстановите исходную отметку главы.');
      }
      const nextGroups = await getActiveRepassGroups(token);
      if (currentSearch !== searchId.current) return;
      setGroups(nextGroups);
      const prepared: PreparedTitle[] = [];
      for await (const match of findRepassTitles(token, nextGroups, setProgress, () => currentSearch === searchId.current)) {
        if (currentSearch !== searchId.current) return;
        try {
          setProgress(`Проверяем главы: ${match.title.main_name ?? match.title.dir}…`);
          const content = await getTitleContent(token, match.title.dir);
          if (!content.active_branch) continue;
          const chapters = await collectAllChapters(token, content.active_branch);
          const chapter = chapters.find((item) => !item.viewed) ?? chapters[0];
          if (!chapter) continue;
          prepared.push({
            id: Number(match.title.id),
            name: match.title.main_name || match.title.secondary_name || match.title.dir,
            branchId: content.active_branch,
            chapter,
            matches: match.matches,
          });
          setTitles([...prepared]);
          if (prepared.length === 3) break;
        } catch (cause) {
          // Недоступный тайтл пропускаем, но проблемы авторизации/лимита показываем.
          if (/\b(401|403|429)\b/.test(message(cause))) throw cause;
        }
      }
      if (currentSearch !== searchId.current) return;
      if (prepared.length < 3) throw new Error(`Подходящих тайтлов с доступными главами найдено ${prepared.length} из 3. Чтение не запущено.`);
      setProgress('Три тайтла готовы. Проверьте список и запустите чтение.');
      setPhase('ready');
    } catch (cause) {
      if (currentSearch !== searchId.current) return;
      setError(message(cause));
      setPhase('idle');
    }
  };

  const run = async () => {
    if (activeRun || titles.length !== 3) return;
    activeRun = true;
    setPhase('running');
    setError('');
    setDone([]);
    try {
      const nativeState = await getChapterReadState();
      if (nativeState?.running) throw new Error('Сейчас работает чтение глав. Остановите его перед запуском Re:pass.');
      if (await getPendingRepassRestore(userId)) {
        setRestoreNeeded(true);
        throw new Error('Сначала восстановите исходную отметку главы.');
      }
      for (let index = 0; index < titles.length; index++) {
        const title = titles[index];
        if (mounted.current) setProgress(`${index + 1}/3 · ${title.name}: проверяем статус главы…`);
        // Между поиском и запуском статус мог измениться — читаем свежие данные.
        const chapters = await collectAllChapters(token, title.branchId);
        const chapter = chapters.find((item) => item.id === title.chapter.id);
        if (!chapter) throw new Error(`Глава тайтла «${title.name}» больше недоступна.`);
        if (mounted.current) setProgress(`${index + 1}/3 · ${title.name}: читаем главу ${chapter.id}…`);
        await runRepassChapter(token, { userId, chapterId: chapter.id, titleName: title.name, originallyViewed: chapter.viewed });
        if (mounted.current) setDone((old) => [...old, title.id]);
      }
      if (mounted.current) {
        setPhase('done');
        setProgress('Готово: по одной главе из трёх тайтлов прочитано, исходные отметки сохранены.');
      }
    } catch (cause) {
      if (mounted.current) {
        setPhase('idle');
        setError(`Чтение остановлено: ${message(cause)}`);
        try { setRestoreNeeded(Boolean(await getPendingRepassRestore(userId))); }
        catch { setRestoreNeeded(true); }
      }
    } finally {
      activeRun = false;
    }
  };

  const busy = phase === 'preparing' || phase === 'running' || phase === 'repairing';
  return (
    <div style={s.root}>
      <PageHeader title="Re:pass" sub="задания и главы" />
      <div style={s.body}>
        <div style={s.intro}>
          Найдём три тайтла под активные задания Re:pass и прочитаем по одной главе. Если глава была непрочитанной, после чтения вернём её в непрочитанные.
        </div>
        <button type="button" style={{ ...s.button, ...(busy ? s.disabled : {}) }} disabled={busy} onClick={() => void prepare()}>
          {phase === 'preparing' ? 'Подбираем тайтлы…' : 'Найти 3 тайтла'}
        </button>
        {progress && <div role="status" style={s.progress}>{progress}</div>}
        {error && <div role="alert" style={s.error}>{error}</div>}
        {restoreNeeded && phase !== 'running' && (
          <button type="button" style={s.secondaryButton} onClick={() => void retryRecovery()}>Восстановить отметку главы</button>
        )}
        {groups.length > 0 && (
          <section style={s.section}>
            <h2 style={s.heading}>Активные задания</h2>
            {groups.map((group, index) => <div key={`${group.kind}-${index}`} style={s.group}>{index + 1}. {group.kind === 'genres' ? 'Жанр' : 'Категория'}: {group.names.join(' / ')}</div>)}
          </section>
        )}
        {titles.length > 0 && (
          <section style={s.section}>
            <h2 style={s.heading}>Подходящие тайтлы · {titles.length}/3</h2>
            {titles.map((title, index) => (
              <div key={title.id} style={s.titleCard}>
                <div style={s.titleName}>{index + 1}. {title.name} {done.includes(title.id) ? '✓' : ''}</div>
                <div style={s.meta}>Глава {title.chapter.id} · {title.chapter.viewed ? 'уже прочитана' : 'сейчас непрочитана'}</div>
                <div style={s.meta}>Метки заданий: {title.matches.join(' · ')}</div>
              </div>
            ))}
          </section>
        )}
        {phase === 'ready' && titles.length === 3 && !error && (
          <button type="button" style={s.button} onClick={() => void run()}>Прочитать 3 главы</button>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },
  body: { flex: 1, overflowY: 'auto', padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: '14px' },
  intro: { color: 'var(--text2)', fontSize: '14px', lineHeight: 1.55 },
  button: { width: '100%', minHeight: '46px', border: '1px solid var(--border-active)', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' },
  disabled: { opacity: 0.55, cursor: 'default' },
  secondaryButton: { minHeight: '40px', border: '1px solid var(--border-active)', borderRadius: 'var(--radius-sm)', background: 'var(--bg3)', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer' },
  progress: { color: 'var(--text2)', fontSize: '13px', lineHeight: 1.45 },
  error: { color: 'var(--red, #ff7b83)', background: 'var(--bg3)', border: '1px solid var(--red, #ff7b83)', borderRadius: '10px', padding: '12px', fontSize: '13px', lineHeight: 1.5 },
  section: { display: 'flex', flexDirection: 'column', gap: '8px' },
  heading: { margin: '4px 0', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '15px' },
  group: { color: 'var(--text2)', fontSize: '13px', lineHeight: 1.4, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg2)' },
  titleCard: { padding: '12px', border: '1px solid var(--border)', borderRadius: '12px', background: 'var(--bg2)', display: 'flex', flexDirection: 'column', gap: '5px' },
  titleName: { color: 'var(--text)', fontWeight: 700, fontSize: '14px' },
  meta: { color: 'var(--text3)', fontSize: '12px', lineHeight: 1.4 },
};
