import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser';
import { Capacitor } from '@capacitor/core';

/** Доступно только на устройстве (нужен встроенный браузер и общий CookieManager). */
export function ddosGuardAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Открывает remanga.org во встроенном браузере, ждёт прохождения DDoS-Guard
 * (появления куки __ddg* и загрузки реальной страницы), затем закрывает.
 *
 * Браузер и нативные загрузки картинок делят один CookieManager и один UA
 * (OverrideUserAgent == AppUserAgent.UA), поэтому свежая __ddg* сразу становится
 * валидной для нативных запросов — картинки начинают грузиться.
 *
 * Резолвит true, если доступ обновлён (кука появилась) или пользователь сам
 * закрыл окно после загрузки сайта; false — по таймауту.
 */
export function refreshDdosGuard(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!ddosGuardAvailable()) { resolve(false); return; }

    let done = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let loadSub: { unsubscribe: () => void } | null = null;
    let exitSub: { unsubscribe: () => void } | null = null;
    const started = Date.now();

    const browser = InAppBrowser.create(
      'https://remanga.org/',
      '_blank',
      'location=yes,clearcache=no,clearsessioncache=no',
    );

    const cleanup = () => {
      if (poll) { clearInterval(poll); poll = null; }
      try { loadSub?.unsubscribe(); } catch { /* ignore */ }
      try { exitSub?.unsubscribe(); } catch { /* ignore */ }
    };

    const finish = (ok: boolean, close: boolean) => {
      if (done) return;
      done = true;
      cleanup();
      if (close) { try { browser.close(); } catch { /* ignore */ } }
      resolve(ok);
    };

    // Проверяем, прошли ли DDoS-Guard: есть кука __ddg*, страница догрузилась,
    // и прошло достаточно времени, чтобы это была реальная страница, а не
    // промежуточный челлендж (он тоже успевает поставить часть кук).
    const check = async () => {
      if (done) return;
      try {
        const res = await browser.executeScript({
          code: 'JSON.stringify({c:document.cookie,r:document.readyState})',
        });
        const raw = Array.isArray(res) ? res[0] : res;
        const parsed = JSON.parse(String(raw ?? '{}')) as { c?: string; r?: string };
        const hasDdg = typeof parsed.c === 'string' && parsed.c.includes('__ddg');
        const elapsed = Date.now() - started;
        if (hasDdg && parsed.r === 'complete' && elapsed > 6000) {
          finish(true, true);
        }
      } catch {
        // страница ещё грузится / челлендж — пробуем позже
      }
    };

    loadSub = browser.on('loadstop').subscribe(() => { void check(); });
    poll = setInterval(() => { void check(); }, 900);
    // Пользователь сам закрыл окно (увидел, что сайт загрузился) — кука уже в CookieManager.
    exitSub = browser.on('exit').subscribe(() => { finish(true, false); });
    // Предохранитель от вечного ожидания.
    setTimeout(() => finish(false, true), 45000);
  });
}
