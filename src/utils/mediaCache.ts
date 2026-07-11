import { Capacitor, registerPlugin } from '@capacitor/core';

export interface MediaCacheConfig {
  enabled: boolean;
  limitMb: number;
  usageBytes: number;
}

interface MediaCacheNativePlugin {
  getConfig(): Promise<MediaCacheConfig>;
  setConfig(opts: { enabled: boolean; limitMb: number }): Promise<MediaCacheConfig>;
  clear(): Promise<{ usageBytes: number }>;
}

const Native = registerPlugin<MediaCacheNativePlugin>('MediaCache');

export const MEDIA_CACHE_MIN_MB = 200;
export const MEDIA_CACHE_MAX_MB = 2000;

export function mediaCacheAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

const DEFAULTS: MediaCacheConfig = { enabled: false, limitMb: 500, usageBytes: 0 };

export async function getMediaCacheConfig(): Promise<MediaCacheConfig> {
  if (!mediaCacheAvailable()) return { ...DEFAULTS };
  try {
    return await Native.getConfig();
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setMediaCacheConfig(enabled: boolean, limitMb: number): Promise<MediaCacheConfig> {
  if (!mediaCacheAvailable()) return { ...DEFAULTS, enabled, limitMb };
  const clamped = Math.max(MEDIA_CACHE_MIN_MB, Math.min(MEDIA_CACHE_MAX_MB, Math.round(limitMb)));
  return await Native.setConfig({ enabled, limitMb: clamped });
}

export async function clearMediaCache(): Promise<number> {
  if (!mediaCacheAvailable()) return 0;
  try {
    const r = await Native.clear();
    return r?.usageBytes ?? 0;
  } catch {
    return 0;
  }
}

/** Байты → человекочитаемо (МБ/ГБ). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 МБ';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;
  return `${(mb / 1024).toFixed(2)} ГБ`;
}
