import { InAppBrowser } from '@awesome-cordova-plugins/in-app-browser';

/**
 * Открывает remanga.org во встроенном браузере и, как только пользователь
 * залогинен (в cookie есть token), возвращает всю строку document.cookie.
 *
 * Важно: document.cookie отдаёт только НЕ-HttpOnly куки. Если серверу для
 * отметки чтения нужен HttpOnly-кука (напр. sessionid) — этого не хватит,
 * и придётся слать запросы изнутри страницы (проверяем на тесте).
 */
export function captureAllCookies(): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    let browser: ReturnType<typeof InAppBrowser.create>;

    try {
      browser = InAppBrowser.create(
        'https://remanga.org/',
        '_blank',
        'location=yes,clearcache=no,clearsessioncache=no'
      );
    } catch {
      reject(new Error('Не удалось открыть браузер'));
      return;
    }

    const finish = (cookie: string) => {
      if (done) return;
      done = true;
      try { browser.close(); } catch { /* ignore */ }
      resolve(cookie);
    };

    browser.on('loadstop').subscribe(async () => {
      try {
        const res = await browser.executeScript({ code: 'document.cookie' });
        const cookie = Array.isArray(res) ? String(res[0] ?? '') : String(res ?? '');
        if (/(?:^|;\s*)token=/.test(cookie)) {
          finish(cookie);
        }
      } catch {
        /* пока не залогинен — ждём следующего loadstop */
      }
    });

    browser.on('exit').subscribe(() => {
      if (!done) {
        done = true;
        reject(new Error('Окно закрыто до входа'));
      }
    });
  });
}
