package org.reapp.redecks;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Файловый кэш картинок/видео с remanga.org.
 *
 * Механика: WebView перед загрузкой медиа зовёт shouldInterceptRequest →
 * tryServe(). Если файл есть в кэше — отдаём с диска (сеть не трогаем).
 * Если нет — качаем нативно (тот же UA/куки, что и API), сохраняем, отдаём.
 * Размер ограничен лимитом; при превышении удаляются самые старые файлы (LRU
 * по времени последнего доступа).
 */
public final class MediaCache {
    private static final String TAG = "MediaCache";
    private static final String PREFS = "redecks_media_cache";
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        + "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

    private static volatile boolean enabled = false;
    private static volatile long limitBytes = 500L * 1024 * 1024;
    private static Context appContext;
    private static File dir;
    private static final AtomicLong totalSize = new AtomicLong(0);
    private static final Object initLock = new Object();
    private static final ConcurrentHashMap<String, Object> keyLocks = new ConcurrentHashMap<>();

    private MediaCache() {}

    // ── Настройка / состояние ──────────────────────────────────────────────────

    public static void init(Context ctx) {
        synchronized (initLock) {
            if (dir != null) return;
            appContext = ctx.getApplicationContext();
            File base = appContext.getExternalCacheDir();
            if (base == null) base = appContext.getCacheDir();
            dir = new File(base, "media-cache");
            if (!dir.exists()) dir.mkdirs();

            SharedPreferences sp = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            enabled = sp.getBoolean("enabled", false);
            limitBytes = clampMb(sp.getInt("limit_mb", 500)) * 1024L * 1024L;

            long sum = 0;
            File[] files = dir.listFiles();
            if (files != null) for (File f : files) sum += f.length();
            totalSize.set(sum);
        }
    }

    private static int clampMb(int mb) { return Math.max(200, Math.min(2000, mb)); }

    public static boolean isEnabled() { return enabled; }
    public static long getLimitBytes() { return limitBytes; }
    public static int getLimitMb() { return (int) (limitBytes / (1024 * 1024)); }
    public static long getUsage() { return totalSize.get(); }

    public static void setEnabled(boolean e) {
        enabled = e;
        persist();
    }

    public static void setLimitMb(int mb) {
        limitBytes = clampMb(mb) * 1024L * 1024L;
        persist();
        evictIfNeeded();
    }

    public static void clear() {
        File[] files = (dir == null) ? null : dir.listFiles();
        if (files != null) for (File f : files) { //noinspection ResultOfMethodCallIgnored
            f.delete(); }
        totalSize.set(0);
    }

    private static void persist() {
        if (appContext == null) return;
        appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean("enabled", enabled)
            .putInt("limit_mb", getLimitMb())
            .apply();
    }

    // ── Перехват запроса ───────────────────────────────────────────────────────

    public static WebResourceResponse tryServe(WebResourceRequest request) {
        try {
            if (!enabled || dir == null || request == null) return null;
            if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

            Uri uri = request.getUrl();
            if (uri == null) return null;
            String host = uri.getHost();
            if (host == null || !(host.equals("remanga.org") || host.endsWith(".remanga.org"))) return null;
            String path = uri.getPath();
            if (path == null || !isMediaPath(path)) return null;

            String url = uri.toString();
            String key = keyFor(url);
            File file = new File(dir, key);

            if (!file.exists() || file.length() == 0) {
                Object lock = keyLocks.computeIfAbsent(key, k -> new Object());
                synchronized (lock) {
                    if (!file.exists() || file.length() == 0) {
                        if (!download(url, file)) return null; // не вышло — пусть грузит WebView сам
                        totalSize.addAndGet(file.length());
                        evictIfNeeded();
                    }
                }
                keyLocks.remove(key);
            }

            file.setLastModified(System.currentTimeMillis()); // отметка «недавно использован»

            String mime = mimeFor(path);
            String range = request.getRequestHeaders().get("Range");
            return (range != null) ? partial(file, mime, range) : full(file, mime);
        } catch (Exception e) {
            Log.w(TAG, "tryServe", e);
            return null;
        }
    }

    private static WebResourceResponse full(File file, String mime) throws IOException {
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "public, max-age=31536000");
        h.put("Content-Length", String.valueOf(file.length()));
        return new WebResourceResponse(mime, null, 200, "OK", h, new FileInputStream(file));
    }

    private static WebResourceResponse partial(File file, String mime, String rangeHeader) throws IOException {
        long len = file.length();
        long start = 0, end = len - 1;
        try {
            String r = rangeHeader.trim();
            if (r.startsWith("bytes=")) r = r.substring(6);
            String[] parts = r.split("-", 2);
            if (!parts[0].isEmpty()) start = Long.parseLong(parts[0].trim());
            if (parts.length > 1 && !parts[1].isEmpty()) end = Long.parseLong(parts[1].trim());
        } catch (Exception ignore) { /* берём весь файл */ }
        if (start < 0) start = 0;
        if (end >= len) end = len - 1;
        if (start > end) { start = 0; end = len - 1; }
        long count = end - start + 1;

        FileInputStream fis = new FileInputStream(file);
        //noinspection ResultOfMethodCallIgnored
        fis.skip(start);

        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
        h.put("Content-Length", String.valueOf(count));
        h.put("Cache-Control", "public, max-age=31536000");
        return new WebResourceResponse(mime, null, 206, "Partial Content", h, new BoundedInputStream(fis, count));
    }

    // ── Скачивание и вытеснение ────────────────────────────────────────────────

    private static boolean download(String url, File target) {
        HttpURLConnection conn = null;
        File tmp = new File(target.getAbsolutePath() + ".tmp");
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Referer", "https://remanga.org/");
            conn.setRequestProperty("Accept", "*/*");
            try {
                String cookie = CookieManager.getInstance().getCookie("https://remanga.org");
                if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
            } catch (Exception ignore) {}

            int code = conn.getResponseCode();
            if (code != 200) return false;

            // не кэшируем не-медиа (например, HTML-челлендж DDoS-Guard с кодом 200)
            String ct = conn.getContentType();
            if (ct != null) {
                String c = ct.toLowerCase();
                if (!c.startsWith("image/") && !c.startsWith("video/")) return false;
            }

            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[16 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            }
            if (tmp.length() == 0) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return false; }

            //noinspection ResultOfMethodCallIgnored
            target.delete();
            if (!tmp.renameTo(target)) { //noinspection ResultOfMethodCallIgnored
                tmp.delete(); return false; }
            return true;
        } catch (Exception e) {
            Log.w(TAG, "download", e);
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static synchronized void evictIfNeeded() {
        if (dir == null) return;
        while (totalSize.get() > limitBytes) {
            File[] files = dir.listFiles();
            if (files == null || files.length == 0) { totalSize.set(0); return; }
            File oldest = null;
            for (File f : files) {
                if (f.getName().endsWith(".tmp")) continue;
                if (oldest == null || f.lastModified() < oldest.lastModified()) oldest = f;
            }
            if (oldest == null) return;
            long sz = oldest.length();
            if (oldest.delete()) totalSize.addAndGet(-sz);
            else return; // не смогли удалить — выходим, чтобы не крутиться вечно
        }
    }

    // ── Утилиты ────────────────────────────────────────────────────────────────

    private static boolean isMediaPath(String path) {
        String p = path.toLowerCase();
        if (p.startsWith("/media/")) return true;
        return p.endsWith(".webp") || p.endsWith(".jpg") || p.endsWith(".jpeg")
            || p.endsWith(".png") || p.endsWith(".gif") || p.endsWith(".avif")
            || p.endsWith(".webm") || p.endsWith(".mp4");
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".avif")) return "image/avif";
        if (p.endsWith(".webm")) return "video/webm";
        if (p.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static String keyFor(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(url.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(url.hashCode());
        }
    }

    /** Ограничивает чтение первыми N байтами (для Range-ответов). */
    private static final class BoundedInputStream extends InputStream {
        private final InputStream src;
        private long left;

        BoundedInputStream(InputStream src, long limit) { this.src = src; this.left = limit; }

        @Override public int read() throws IOException {
            if (left <= 0) return -1;
            int b = src.read();
            if (b >= 0) left--;
            return b;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int toRead = (int) Math.min(len, left);
            int n = src.read(b, off, toRead);
            if (n > 0) left -= n;
            return n;
        }

        @Override public void close() throws IOException { src.close(); }
    }
}
