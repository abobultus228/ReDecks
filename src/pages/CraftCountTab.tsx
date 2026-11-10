import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import TitlePicker from '../components/TitlePicker';
import { CardZoomProvider, isVideoUrl, useCardZoom } from '../components/CardGallery';
import { getCardStackCounts, getCraftInventory, getTitleCards, getTitleContent, mergeCraftCards, resolveMediaUrl, type TitleCard } from '../api/extra';
import { searchLimitedIdTitles } from '../utils/limitedIds';
import { calculateCrafts, cardRank, type CraftProjection } from '../utils/craftCalculator';
import { planNextCraft, ranksCompleteThrough, type CraftStep, type CraftTargetRank } from '../utils/craftExecutor';
import { clearPendingCraftRecovery, getPendingCraftRecovery, savePendingCraftRecovery, type PendingCraftRecovery } from '../utils/craftRecovery';

type Source = 'regular' | 'limited';

const BATCH_SIZE = 50;
const RETRY_DELAY = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let craftRunActive = false;

function InventoryCard({ card, count }: { card: TitleCard; count?: number }) {
  const zoom = useCardZoom();
  const mid = resolveMediaUrl(card.cover?.mid || card.cover?.high || '');
  const high = resolveMediaUrl(card.cover?.high || card.cover?.mid || '');
  return (
    <button type="button" style={s.missingCard} onClick={() => high && zoom(high)} aria-label={`Открыть карту ${card.id}${count ? `, экземпляров ${count}` : ''}`}>
      {mid ? (isVideoUrl(mid)
        ? <video src={mid} style={s.missingMedia} autoPlay loop muted playsInline />
        : <img src={mid} style={s.missingMedia} loading="lazy" alt="" />)
        : <span style={s.noCover}>нет обложки</span>}
      <span style={s.cardId}>#{card.id}{count ? ` · ×${count}` : ''}</span>
    </button>
  );
}

export default function CraftCountTab() {
  const token = useAppStore((state) => state.token);
  const userId = useAppStore((state) => state.userId);
  const [source, setSource] = useState<Source>('regular');
  const [limitedQuery, setLimitedQuery] = useState('');
  const [selected, setSelected] = useState<{ id: number; label: string; slug?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [projection, setProjection] = useState<CraftProjection | null>(null);
  const [catalogCards, setCatalogCards] = useState<TitleCard[]>([]);
  const [maxRank, setMaxRank] = useState<CraftTargetRank>('D');
  const [maxCrafts, setMaxCrafts] = useState(50);
  const [armed, setArmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [craftedCards, setCraftedCards] = useState<TitleCard[]>([]);
  const [craftedCount, setCraftedCount] = useState(0);
  const [runFinished, setRunFinished] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<PendingCraftRecovery | null>(null);
  const [repairing, setRepairing] = useState(false);
  const requestRef = useRef(0);
  const stopRef = useRef(false);

  useEffect(() => () => { requestRef.current += 1; stopRef.current = true; }, []);
  useEffect(() => {
    let live = true;
    void getPendingCraftRecovery().then((pending) => {
      if (live) setPendingRecovery(pending);
    }).catch((cause) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { live = false; };
  }, [userId]);

  const reset = () => {
    if (running) return;
    requestRef.current += 1;
    setSelected(null);
    setLoading(false);
    setStatus('');
    setError('');
    setProjection(null);
    setCatalogCards([]);
    setArmed(false);
    setCraftedCards([]);
    setCraftedCount(0);
    setRunFinished(false);
  };

  const retry = async <T,>(action: () => Promise<T>, requestId: number, ignoreCancellation = false): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      if (!ignoreCancellation && requestRef.current !== requestId) throw new Error('Запрос отменён');
      try {
        return await action();
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (attempt >= 3 || !/(?:HTTP |\b)(?:429|502|503|504)\b|network|failed to fetch|timeout/i.test(message)) throw cause;
        setStatus(`Сервер не ответил — повтор через 3 секунды (${attempt + 1}/3)…`);
        await sleep(RETRY_DELAY);
      }
    }
  };

  const loadCounts = async (cards: TitleCard[], requestId: number, ignoreCancellation = false): Promise<Map<number, number>> => {
    const stacks = new Map<number, number>();
    const batches = Math.ceil(cards.length / BATCH_SIZE);
    for (let start = 0; start < cards.length; start += BATCH_SIZE) {
      const batch = Math.floor(start / BATCH_SIZE) + 1;
      setStatus(`Проверяю количество карт: ${batch} / ${batches}…`);
      const counts = await retry(() => getCardStackCounts(token, cards.slice(start, start + BATCH_SIZE).map((card) => card.id)), requestId, ignoreCancellation);
      if (!ignoreCancellation && requestRef.current !== requestId) throw new Error('Запрос отменён');
      for (const [id, count] of counts) stacks.set(id, count);
      if (start + BATCH_SIZE < cards.length) await sleep(100);
    }
    return stacks;
  };

  const loadCards = async (titleId: number, requestId: number): Promise<TitleCard[]> => {
    const cards: TitleCard[] = [];
    const seen = new Set<number>();
    let page = 1;

    while (true) {
      setStatus(`Загружаю каталог: страница ${page}, карт ${cards.length}…`);
      const response = await retry(() => getTitleCards(token, titleId, page), requestId);
      if (requestRef.current !== requestId) throw new Error('Запрос отменён');
      for (const card of response.results) {
        if (!seen.has(card.id)) {
          seen.add(card.id);
          cards.push(card);
        }
      }
      if (!response.hasMore) break;
      page += 1;
      await sleep(100);
    }

    const stacks = await loadCounts(cards, requestId);

    setStatus('Считаю безопасные крафты…');
    setCatalogCards(cards);
    setProjection(calculateCrafts(cards, stacks));
    return cards;
  };

  const selectTitle = async (id: number | null, label: string, slug?: string) => {
    if (running || craftRunActive) return;
    const requestId = ++requestRef.current;
    setSelected({ id: id ?? 0, label, slug });
    setLoading(true);
    setError('');
    setProjection(null);
    setCatalogCards([]);
    setCraftedCards([]);
    setCraftedCount(0);
    setRunFinished(false);
    setArmed(false);
    try {
      let titleId = id;
      if (titleId == null && slug) {
        setStatus('Получаю ID тайтла…');
        titleId = (await retry(() => getTitleContent(token, slug), requestId)).id;
      }
      if (requestRef.current !== requestId || titleId == null) return;
      setSelected({ id: titleId, label, slug });
      await loadCards(titleId, requestId);
    } catch (cause) {
      if (requestRef.current === requestId) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  };

  const checkMergeResult = (
    result: TitleCard & { title?: { id?: number } }, step: CraftStep,
    before: Map<number, number>, titleId: number, catalog: Map<number, TitleCard>,
  ) => {
    const resultId = Number(result?.id);
    const catalogCard = catalog.get(resultId);
    if (!catalogCard || cardRank(result.rank) !== step.to || cardRank(catalogCard.rank) !== step.to || Number(result.title?.id) !== titleId || (before.get(resultId) ?? 0) > 0) {
      throw new Error(`Сервер вернул неожиданный результат крафта #${resultId}. Инвентарь нужно пересчитать.`);
    }
  };

  const repairRecovery = async (
    pending: PendingCraftRecovery,
    cards: TitleCard[],
    requestId: number,
    send: (step: CraftStep, before: Map<number, number>) => Promise<void>,
  ): Promise<void> => {
    if (pending.userId !== userId) throw new Error('Восстановление относится к другому аккаунту.');
    for (let attempt = 0; attempt < 64; attempt++) {
      setStatus(`Восстанавливаю ранги до ${pending.repairThrough}: сверяю инвентарь…`);
      const counts = await loadCounts(cards, requestId, true);
      if (ranksCompleteThrough(cards, counts, pending.repairThrough)) {
        await clearPendingCraftRecovery();
        setPendingRecovery(null);
        return;
      }
      const inventory = await retry(() => getCraftInventory(token, userId, pending.titleId), requestId, true);
      const step = planNextCraft(cards, counts, inventory, pending.repairThrough);
      if (!step) throw new Error(`Не хватает доступных экземпляров для восстановления рангов до ${pending.repairThrough}. Журнал сохранён.`);
      await send(step, counts);
    }
    throw new Error('Восстановление превысило 64 операции. Журнал сохранён.');
  };

  const continueRecovery = async () => {
    if (craftRunActive || !pendingRecovery) return;
    craftRunActive = true;
    const requestId = ++requestRef.current;
    setRunning(true);
    setRepairing(true);
    setError('');
    setSelected({ id: pendingRecovery.titleId, label: pendingRecovery.titleLabel });
    let count = 0;
    try {
      const cards = await loadCards(pendingRecovery.titleId, requestId);
      const catalog = new Map(cards.map((card) => [card.id, card]));
      await repairRecovery(pendingRecovery, cards, requestId, async (step, before) => {
        const result = await mergeCraftCards(token, userId, step.instanceIds);
        count++;
        checkMergeResult(result, step, before, pendingRecovery.titleId, catalog);
        if (requestRef.current === requestId) setCraftedCards((old) => [...old, result]);
      });
      if (requestRef.current === requestId) setStatus(`Восстановление завершено. Дополнительных крафтов: ${count}.`);
    } catch (cause) {
      if (requestRef.current === requestId) setError(`Не удалось завершить восстановление: ${cause instanceof Error ? cause.message : String(cause)}. Новый крафт заблокирован.`);
    } finally {
      craftRunActive = false;
      if (requestRef.current === requestId) {
        try { await loadCards(pendingRecovery.titleId, requestId); } catch { /* исходная ошибка остаётся */ }
        setRunning(false);
        setRepairing(false);
        setRunFinished(true);
        let stillPending = true;
        try { stillPending = Boolean(await getPendingCraftRecovery()); } catch { /* журнал не трогаем */ }
        setStatus(`Восстановление: ${count} крафтов. ${stillPending ? 'Требуется продолжение.' : 'Готово.'}`);
      }
    }
  };

  const executeCrafts = async () => {
    if (craftRunActive || running || !selected?.id || !catalogCards.length) return;
    const limit = Math.min(200, Math.max(1, Math.floor(maxCrafts) || 1));
    const requestId = requestRef.current;
    craftRunActive = true;
    stopRef.current = false;
    setRunning(true);
    setArmed(false);
    setError('');
    setCraftedCards([]);
    setCraftedCount(0);
    setRunFinished(false);
    let count = 0;
    let stoppedByPlan = false;
    let finalStatus = '';
    try {
      if (await getPendingCraftRecovery()) throw new Error('Сначала завершите восстановление предыдущего крафта.');
      const catalogById = new Map(catalogCards.map((card) => [card.id, card]));
      const send = async (step: CraftStep, before: Map<number, number>) => {
        setStatus(`Крафт ${count + 1}/${limit}: ${step.from}→${step.to}, экземпляры ${step.instanceIds.join(' + ')}…`);
        // POST не повторяем: при сетевой ошибке результат мог уже создаться.
        const result = await mergeCraftCards(token, userId, step.instanceIds);
        count++;
        if (requestRef.current === requestId) setCraftedCount(count);
        checkMergeResult(result, step, before, selected.id, catalogById);
        if (requestRef.current === requestId) setCraftedCards((old) => [...old, result]);
      };
      while (count < limit && !stopRef.current && requestRef.current === requestId) {
        setStatus(`Крафт ${count + 1}/${limit}: сверяю карты и экземпляры…`);
        const stacks = await loadCounts(catalogCards, requestId);
        const inventory = await retry(() => getCraftInventory(token, userId, selected.id), requestId);
        const step = planNextCraft(catalogCards, stacks, inventory, maxRank);
        if (!step) { stoppedByPlan = true; break; }
        if (count + step.totalSteps > limit) break;
        if (stopRef.current || requestRef.current !== requestId) break;
        if (step.restoreCount > 0) {
          const pending: PendingCraftRecovery = { userId, titleId: selected.id, titleLabel: selected.label, repairThrough: step.from as CraftTargetRank };
          await savePendingCraftRecovery(pending);
          setPendingRecovery(pending);
          let mergeError: unknown;
          try { await send(step, stacks); } catch (cause) { mergeError = cause; }
          setRepairing(true);
          try { await repairRecovery(pending, catalogCards, requestId, send); }
          finally { setRepairing(false); }
          if (mergeError) throw mergeError;
        } else {
          await send(step, stacks);
        }
        await sleep(350);
      }
      if (requestRef.current === requestId) {
        finalStatus = stopRef.current ? `Остановлено после ${count} крафтов.` : stoppedByPlan ? `Безопасные крафты до ранга ${maxRank} закончились. Выполнено: ${count}.` : `Достигнут лимит запуска: ${count} крафтов.`;
      }
    } catch (cause) {
      if (requestRef.current === requestId) {
        finalStatus = `Крафт остановлен после ${count} подтверждённых операций.`;
        setError(`Крафт остановлен после ${count} подтверждённых операций: ${cause instanceof Error ? cause.message : String(cause)}. Если ошибка возникла во время отправки, результат мог создаться — POST не повторялся.`);
      }
    } finally {
      craftRunActive = false;
      if (requestRef.current === requestId) {
        try {
          await loadCards(selected.id, requestId);
        } catch (cause) {
          setError((old) => `${old ? `${old} ` : ''}Не удалось обновить подсчёт: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        setRunning(false);
        setRepairing(false);
        setRunFinished(true);
        setStatus(finalStatus || `Выполнено крафтов: ${count}.`);
      }
    }
  };

  const limitedResults = limitedQuery.trim() ? searchLimitedIdTitles(limitedQuery) : [];
  const missingGroups = projection?.ranks
    .map((rank) => ({ rank: rank.rank, cards: projection.missingCards.filter((card) => cardRank(card.rank) === rank.rank) }))
    .filter((group) => group.cards.length > 0) ?? [];
  const ownedGroups = projection?.ranks
    .map((rank) => ({ rank: rank.rank, cards: projection.ownedCards.filter(({ card }) => cardRank(card.rank) === rank.rank) }))
    .filter((group) => group.cards.length > 0) ?? [];

  return (
    <CardZoomProvider>
      <div style={s.root}>
        {pendingRecovery && (
          <div style={s.recoveryBox} role="alert">
            <strong>Незавершённое восстановление: {pendingRecovery.titleLabel}</strong>
            <span>Сначала нужно вернуть потраченные уникальные карты до ранга {pendingRecovery.repairThrough}. Новый крафт пока заблокирован.</span>
            {!running && <button type="button" style={s.actionButton} onClick={() => void continueRecovery()}>Продолжить восстановление</button>}
          </div>
        )}
        {!selected ? (
          <>
            <div style={s.sourceTabs}>
              <button type="button" style={{ ...s.sourceTab, ...(source === 'regular' ? s.sourceTabOn : {}) }} onClick={() => setSource('regular')}>Обычные</button>
              <button type="button" style={{ ...s.sourceTab, ...(source === 'limited' ? s.sourceTabOn : {}) }} onClick={() => setSource('limited')}>Лимитированные</button>
            </div>
            {source === 'regular' ? (
              <TitlePicker onPick={(slug, label) => { void selectTitle(null, label, slug); }} />
            ) : (
              <>
                <input
                  style={s.search}
                  value={limitedQuery}
                  onChange={(event) => setLimitedQuery(event.target.value)}
                  placeholder="Название лимитированного тайтла"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <div style={s.results}>
                  {limitedResults.slice(0, 50).map((title) => (
                    <button key={title.id} type="button" style={s.result} onClick={() => { void selectTitle(title.id, title.name); }}>
                      <span style={s.resultName}>{title.name}</span>
                      <span style={s.resultMeta}>{title.dir || `id ${title.id}`}</span>
                    </button>
                  ))}
                  {limitedQuery.trim() && limitedResults.length === 0 && <p style={s.note}>Ничего не найдено.</p>}
                  {limitedResults.length > 50 && <p style={s.note}>Показаны первые 50 — уточни поиск.</p>}
                </div>
              </>
            )}
            <p style={s.note}>Считаем только безопасные крафты F→E→D→C→B. A и S учитываются в коллекции, но не крафтятся.</p>
          </>
        ) : (
          <>
            <div style={s.selectedRow}>
              <span style={s.selectedName}>{selected.label}</span>
              <button type="button" style={s.backButton} onClick={reset} disabled={running}>Другой тайтл</button>
            </div>

            {(loading || running || runFinished) && <p style={s.status} role="status">{status}</p>}
            {error && (
              <div style={s.error} role="alert">
                <span>{error}</span>
                {!running && <button type="button" style={s.retryButton} onClick={() => { void selectTitle(selected.id || null, selected.label, selected.slug); }}>Пересчитать</button>}
              </div>
            )}

            {projection && (
              <>
                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Крафт карт</h3>
                  <p style={s.note}>До выбранного ранга, по порядку E→D→C→B. В запрос отправляются только ID физических экземпляров. Избранные, пробуждённые и улучшенные экземпляры не используются. Расчёт ниже теоретический; реальный запуск может остановиться раньше из-за защищённых экземпляров.</p>
                  <div style={s.controlRow}>
                    <label style={s.controlLabel}>Максимальный ранг
                      <select style={s.controlInput} value={maxRank} disabled={running} onChange={(event) => { setMaxRank(event.target.value as CraftTargetRank); setArmed(false); }}>
                        <option value="E">E</option><option value="D">D</option><option value="C">C</option><option value="B">B</option>
                      </select>
                    </label>
                    <label style={s.controlLabel}>Макс. крафтов за запуск
                      <input style={s.controlInput} type="number" min="1" max="200" value={maxCrafts} disabled={running} onChange={(event) => { setMaxCrafts(Number(event.target.value)); setArmed(false); }} />
                    </label>
                  </div>
                  {running ? (
                    repairing ? <p style={s.warning}>Восстанавливаем уникальные карты. Остановка применится после завершения этой цепочки.</p>
                      : <button type="button" style={s.stopButton} onClick={() => { stopRef.current = true; setStatus('Останавливаемся после текущей цепочки восстановления…'); }}>Остановить после текущей цепочки</button>
                  ) : armed ? (
                    <>
                      <p style={s.warning}>Подтвердите расход до {Math.min(200, Math.max(1, Math.floor(maxCrafts) || 1))} пар карт. Крафт необратим; операции выше ранга {maxRank} не выполняются.</p>
                      <button type="button" style={s.actionButton} disabled={Boolean(error || pendingRecovery)} onClick={() => void executeCrafts()}>Подтвердить и начать</button>
                      <button type="button" style={s.backButton} onClick={() => setArmed(false)}>Отмена</button>
                    </>
                  ) : (
                    <button type="button" style={s.actionButton} disabled={Boolean(error || pendingRecovery)} onClick={() => setArmed(true)}>Подготовить крафт</button>
                  )}
                </div>

                {craftedCards.length > 0 && (
                  <div style={s.section}>
                    <h3 style={s.sectionTitle}>Получено карт ({craftedCards.length})</h3>
                    <div style={s.missingGrid}>{craftedCards.map((card, index) => <InventoryCard key={`${index}-${card.id}`} card={card} />)}</div>
                  </div>
                )}

                <div style={s.summary}>
                  <div style={s.summaryRow}><span>Сейчас уникальных</span><strong>{projection.currentOwned} / {projection.totalCards}</strong></div>
                  <div style={s.summaryRow}><span>Сейчас экземпляров</span><strong>{projection.physicalOwned}</strong></div>
                  <div style={s.summaryRow}><span>Потенциал до B: уникальных</span><strong>{projection.projectedOwned} / {projection.totalCards}</strong></div>
                  <div style={s.summaryRow}><span>Потенциал до B: экземпляров</span><strong>{projection.projectedCopies}</strong></div>
                  <div style={s.summaryRow}><span>Потенциал новых уникальных</span><strong>+{projection.projectedOwned - projection.currentOwned}</strong></div>
                </div>

                <div style={s.section}>
                  <h3 style={s.sectionTitle}>По рангам</h3>
                  <div style={s.rankHead}><span>Ранг</span><span>Сейчас</span><span>После</span><span>Крафтов</span></div>
                  {projection.ranks.map((rank) => (
                    <div key={rank.rank} style={s.rankRow}>
                      <strong>{rank.rank}</strong>
                      <span>{rank.current}/{rank.total}</span>
                      <span>{rank.projected}/{rank.total}</span>
                      <span>{rank.crafts || '—'}</span>
                    </div>
                  ))}
                  {projection.blockedAt && <p style={s.note}>Цепочка остановилась на ранге {projection.blockedAt}; более высокие ранги не крафтим, пока он не собран.</p>}
                  <p style={s.note}>«Крафтов» включает восстановление временно потраченных карт. Последние F никогда не расходуются.</p>
                </div>

                <div style={s.section}>
                  <h3 style={s.sectionTitle}>До полной коллекции F–B</h3>
                  {projection.extraFNeeded == null ? (
                    <p style={s.note}>Одних дополнительных F недостаточно: промежуточный ранг не удаётся безопасно пройти.</p>
                  ) : (
                    <p style={s.deficit}>
                      {projection.missingF + projection.extraFNeeded} F-карт в эквиваленте
                      <span style={s.deficitDetail}>: {projection.missingF} конкретных недостающих F + {projection.extraFNeeded} расходных F для крафта.</span>
                    </p>
                  )}
                  {projection.completeThroughB && projection.surplusFEquivalent > 0 && (
                    <p style={s.note}>После закрытия F–B останется запас: {projection.surplusFEquivalent} F-экв. Возможность B→A не рассчитываем.</p>
                  )}
                  <p style={s.note}>F-эквивалент — расчёт ресурса, не обещание выпадения конкретных карт. A и S сюда не входят.</p>
                </div>

                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Имеющиеся карты ({projection.currentOwned})</h3>
                  {ownedGroups.length === 0 ? <p style={s.note}>Карт этого тайтла пока нет.</p> : ownedGroups.map((group) => (
                    <details key={group.rank} style={s.details}>
                      <summary style={s.detailsTitle}>{group.rank} — {group.cards.length}</summary>
                      <div style={s.missingGrid}>{group.cards.map(({ card, count }) => <InventoryCard key={card.id} card={card} count={count} />)}</div>
                    </details>
                  ))}
                </div>

                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Каких карт нет сейчас ({projection.missingCards.length})</h3>
                  {missingGroups.length === 0 ? <p style={s.note}>Все карты тайтла уже собраны.</p> : missingGroups.map((group) => (
                    <details key={group.rank} style={s.details}>
                      <summary style={s.detailsTitle}>{group.rank} — {group.cards.length}</summary>
                      <div style={s.missingGrid}>{group.cards.map((card) => <InventoryCard key={card.id} card={card} />)}</div>
                    </details>
                  ))}
                  {missingGroups.length > 0 && <p style={s.note}>Какие именно отсутствующие карты дадут будущие крафты, заранее неизвестно.</p>}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </CardZoomProvider>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg)' },
  sourceTabs: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  sourceTab: { background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text2)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '12px', padding: '10px', cursor: 'pointer' },
  sourceTabOn: { color: 'var(--accent)', background: 'var(--accent-soft)', borderColor: 'var(--border-active)' },
  search: { width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px', padding: '12px' },
  results: { display: 'flex', flexDirection: 'column', gap: '6px' },
  result: { display: 'flex', flexDirection: 'column', gap: '3px', width: '100%', textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', cursor: 'pointer' },
  resultName: { color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px' },
  resultMeta: { color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: '11px' },
  selectedRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' },
  selectedName: { minWidth: 0, color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  backButton: { flexShrink: 0, background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', fontSize: '11px', padding: '8px', cursor: 'pointer' },
  status: { color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '12px', background: 'var(--accent-soft)', borderRadius: 'var(--radius-sm)' },
  error: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', color: 'var(--red)', background: 'var(--surface)', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', padding: '12px', fontFamily: 'var(--font-mono)', fontSize: '12px' },
  retryButton: { flexShrink: 0, color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px', cursor: 'pointer' },
  summary: { display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface)', border: '1px solid var(--border-active)', borderRadius: 'var(--radius)', padding: '14px' },
  summaryRow: { display: 'flex', justifyContent: 'space-between', gap: '10px', color: 'var(--text2)', fontFamily: 'var(--font-display)', fontSize: '13px' },
  section: { display: 'flex', flexDirection: 'column', gap: '8px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px' },
  sectionTitle: { color: 'var(--text)', fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 800 },
  controlRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
  controlLabel: { display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text2)', fontFamily: 'var(--font-display)', fontSize: '11px', fontWeight: 700 },
  controlInput: { width: '100%', minHeight: '40px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg3)', color: 'var(--text)', padding: '0 10px', fontSize: '14px' },
  actionButton: { minHeight: '44px', border: '1px solid var(--border-active)', borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' },
  stopButton: { minHeight: '44px', border: '1px solid var(--red)', borderRadius: 'var(--radius-sm)', background: 'var(--bg3)', color: 'var(--red)', fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 800, cursor: 'pointer' },
  warning: { color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border-active)', borderRadius: '8px', padding: '10px', fontSize: '12px', lineHeight: 1.5 },
  recoveryBox: { display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--red)', borderRadius: '10px', padding: '12px', fontSize: '12px', lineHeight: 1.5 },
  rankHead: { display: 'grid', gridTemplateColumns: '0.7fr repeat(3, 1fr)', gap: '4px', color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: '10px' },
  rankRow: { display: 'grid', gridTemplateColumns: '0.7fr repeat(3, 1fr)', gap: '4px', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: '12px', padding: '7px 0', borderTop: '1px solid var(--border)' },
  note: { color: 'var(--text2)', fontFamily: 'var(--font-display)', fontSize: '12px', lineHeight: 1.5 },
  deficit: { color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 800 },
  deficitDetail: { color: 'var(--text2)', fontFamily: 'var(--font-display)', fontSize: '12px', fontWeight: 400 },
  details: { borderTop: '1px solid var(--border)', paddingTop: '8px' },
  detailsTitle: { color: 'var(--text)', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' },
  missingGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px', paddingTop: '10px' },
  missingCard: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px', cursor: 'pointer' },
  missingMedia: { width: '100%', aspectRatio: '2 / 3', objectFit: 'cover', borderRadius: '5px', background: 'var(--bg2)' },
  noCover: { width: '100%', aspectRatio: '2 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: '10px' },
  cardId: { fontFamily: 'var(--font-mono)', fontSize: '10px' },
};
