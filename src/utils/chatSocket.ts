import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Обёртка над WebSocket чата.
 *
 * На Android браузерный WebSocket шлёт Origin = https://localhost, и сервер
 * remanga может отклонить рукопожатие. Поэтому при наличии нативного плагина
 * `ChatSocket` соединение идёт через него с правильным Origin. Если плагина
 * нет (веб/разработка или плагин ещё не собран) — используем обычный WebSocket.
 */

interface ChatSocketNativePlugin {
  connect(opts: { url: string; origin: string }): Promise<void>;
  send(opts: { data: string }): Promise<void>;
  close(): Promise<void>;
  addListener(
    event: 'open' | 'message' | 'close' | 'error',
    cb: (data: { data?: string; message?: string }) => void,
  ): Promise<{ remove: () => void }>;
}

const Native = registerPlugin<ChatSocketNativePlugin>('ChatSocket');

const ORIGIN = 'https://remanga.org';

export interface SocketCallbacks {
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
  onError?: (message?: string) => void;
}

export interface ChatSocketHandle {
  send: (data: string) => void;
  close: () => void;
}

export function openChatSocket(url: string, cb: SocketCallbacks): ChatSocketHandle {
  const useNative =
    Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ChatSocket');

  if (useNative) {
    const listeners: { remove: () => void }[] = [];
    let closed = false;

    (async () => {
      try {
        listeners.push(await Native.addListener('open', () => cb.onOpen?.()));
        listeners.push(await Native.addListener('message', (d) => cb.onMessage?.(d?.data ?? '')));
        listeners.push(await Native.addListener('close', () => cb.onClose?.()));
        listeners.push(await Native.addListener('error', (d) => cb.onError?.(d?.message)));
        await Native.connect({ url, origin: ORIGIN });
      } catch (e) {
        cb.onError?.(e instanceof Error ? e.message : String(e));
      }
    })();

    return {
      send: (data) => { void Native.send({ data }); },
      close: () => {
        if (closed) return;
        closed = true;
        listeners.forEach((l) => l.remove());
        void Native.close();
      },
    };
  }

  // Веб/разработка: обычный WebSocket (Origin задаёт сам WebView)
  const ws = new WebSocket(url);
  ws.onopen = () => cb.onOpen?.();
  ws.onmessage = (e) => cb.onMessage?.(typeof e.data === 'string' ? e.data : '');
  ws.onclose = () => cb.onClose?.();
  ws.onerror = () => cb.onError?.();

  return {
    send: (data) => { if (ws.readyState === WebSocket.OPEN) ws.send(data); },
    close: () => { try { ws.close(); } catch { /* ignore */ } },
  };
}
