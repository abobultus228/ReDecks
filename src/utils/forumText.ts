// Общие утилиты форума: множественное число, «сколько назад», HTML→текст.

/** Русская форма множественного числа. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** created_at на ReManga — московское время (без зоны). Возвращает epoch ms. */
export function parseMskDate(s: string): number {
  if (!s) return NaN;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) return Date.parse(s);
  const ms = (m[3] || '').slice(0, 3).padEnd(3, '0');
  return Date.parse(`${m[1]}T${m[2]}.${ms}+03:00`);
}

/** «5 минут назад» из даты поста. Считается один раз при загрузке. */
export function timeAgo(created: string, nowMs: number): string {
  const t = parseMskDate(created);
  if (!Number.isFinite(t)) return '';
  return agoFromSeconds((nowMs - t) / 1000);
}

/** «5 секунд/минут/часов/дней/недель назад» из числа секунд (поле date у комментариев). */
export function agoFromSeconds(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  if (sec < 60) return `${sec} ${plural(sec, 'секунду', 'секунды', 'секунд')} назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${plural(h, 'час', 'часа', 'часов')} назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
  const w = Math.floor(d / 7);
  return `${w} ${plural(w, 'неделю', 'недели', 'недель')} назад`;
}

/** Декодирует HTML-сущности (&lt; &quot; …) безопасно. */
function decodeEntities(s: string): string {
  const ta = document.createElement('textarea');
  ta.innerHTML = s || '';
  return ta.value;
}

/** Превращает HTML форума (в том числе экранированный API) в обычный текст. */
export function htmlToText(raw: string): string {
  if (!raw) return '';

  let html = raw;
  // Посты и комментарии могут содержать один или два слоя экранирования тегов.
  for (let i = 0; i < 2 && /&(?:amp;)*lt;\s*\/?\s*[a-z]/i.test(html); i++) {
    html = decodeEntities(html);
  }

  // Не вставляем серверный HTML в интерфейс: разбираем его только для извлечения текста.
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const parts: string[] = [];
  const blockTags = new Set(['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  function appendText(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    // Карты уже приходят в attachments и отображаются отдельно.
    if (tag === 'renode' || tag === 'script' || tag === 'style' || tag === 'template') return;
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (blockTags.has(tag)) parts.push('\n');
    element.childNodes.forEach(appendText);
    if (blockTags.has(tag)) parts.push('\n');
  }

  body.childNodes.forEach(appendText);
  return parts.join('').replace(/\u00a0/g, ' ').replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Комментарии проходят ту же очистку, что и посты. */
export function htmlCommentToText(raw: string): string {
  return htmlToText(raw);
}

/** Экранирует пользовательский ввод, чтобы не поломать HTML. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Оборачивает текст комментария в разметку, которую ждёт сервер. */
export function wrapCommentText(text: string): string {
  return `<p dir="ltr"><span style="white-space: pre-wrap;">${escapeHtml(text)}</span></p>`;
}
