package org.reapp.redecks;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Foreground-сервис чтения глав выбранного тайтла: сбрасывает прочитанные
 * главы, читает их по кругу (с повторным сбросом) до нужного числа. Держит постоянное уведомление со статистикой и wake-lock.
 *
 * 429: пауза 3с → 6с → пропуск главы. Любая иная ошибка — стоп процесса.
 */
public class ChapterReadService extends Service {

    private static final String TAG = "ChapterRead";
    private static final String CH_ID = "chapter_read";
    private static final int NOTIF_ID = 90000003;
    public static final String ACTION_STOP = "org.reapp.redecks.CHAPTER_READ_STOP";

    private static final String API_V2 = "https://api.remanga.org/api/v2";
    private static final String VIEWS_URL = "https://api.remanga.org/api/activity/views/";
    private static final String VOTES_URL = "https://api.remanga.org/api/activity/votes/";

    private static final long READ_DELAY_MS = 1000;
    /** Задержка между главами (300..1000 мс), задаётся при старте прогона. */
    private static volatile long readDelayMs = READ_DELAY_MS;
    /** Лайкать ли главы (POST votes/); задаётся при старте прогона. */
    private static volatile boolean likeEnabled = true;
    private static final long[] RETRY_DELAYS = { 3000, 6000 };

    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private StopReceiver stopReceiver;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        AppUserAgent.init(getApplicationContext());
        final String token = intent == null ? "" : intent.getStringExtra("token");
        final int branchId = intent == null ? 0 : intent.getIntExtra("branchId", 0);
        final int target = intent == null ? 0 : intent.getIntExtra("target", 0);
        final long delayMs = intent == null ? READ_DELAY_MS : intent.getLongExtra("delayMs", READ_DELAY_MS);
        final boolean ignore502 = intent != null && intent.getBooleanExtra("ignore502", false);
        readDelayMs = Math.max(300L, Math.min(1000L, delayMs));
        likeEnabled = intent == null || intent.getBooleanExtra("like", true);

        ensureChannel();
        registerStop();
        try {
            startAsForeground(buildNotification("Запуск…"));
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
            ChapterReadPlugin.stoppedReason = "Не удалось запустить сервис";
            ChapterReadPlugin.running = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        acquireWakeLock();

        ChapterReadPlugin.running = true;

        worker = new Thread(() -> runLoop(token, branchId, target, ignore502));
        worker.start();
        return START_NOT_STICKY;
    }

    private void runLoop(String token, int branchId, int target, boolean ignore502) {
        try {
            ChapterSets sets;
            try {
                sets = collectChapters(token, branchId);
            } catch (Exception e) {
                finish("Ошибка при получении глав");
                return;
            }
            if (sets.all.isEmpty()) {
                finish("Нет глав у этого тайтла");
                return;
            }

            // Читаем ВЕСЬ набор глав.
            List<Integer> readingSet = sets.all;

            // Первый сброс — только реально прочитанные главы (если они есть).
            // Никогда-не-читанные и так непрочитаны: их первое прочтение даст карту.
            if (!sets.viewed.isEmpty()) {
                if (!markUnread(token, sets.viewed)) {
                    finish("Не удалось сбросить главы");
                    return;
                }
            }

            // Главы, за которые уже проголосовали в этом прогоне (как rated у друга):
            // votes/ шлём один раз на главу, повторно нельзя (это переключатель).
            Set<Integer> voted = new HashSet<>();
            JSONArray rewardCards = new JSONArray();

            while (ChapterReadPlugin.readsDone < target && !ChapterReadPlugin.stopRequested) {
                int before = ChapterReadPlugin.readsDone;

                for (int id : readingSet) {
                    if (ChapterReadPlugin.readsDone >= target || ChapterReadPlugin.stopRequested) break;

                    // Как в рабочем клиенте: перед первым чтением главы голосуем за неё
                    // (POST votes/). Вероятный триггер выпадения карты. Один раз на главу.
                    // Управляется галочкой «лайкать».
                    if (likeEnabled && !voted.contains(id)) {
                        int vc = doVote(token, id);
                        voted.add(id);
                        Log.i(TAG, "vote id=" + id + " status=" + vc);
                    }

                    // 429: 3с → 6с → пропуск главы. Если включено, 502 повторяем
                    // через 3с на той же главе до успеха или остановки.
                    int attempt = 0;
                    boolean skip = false;
                    ReadResult rr;
                    while (true) {
                        rr = doRead(token, id);
                        if (rr.status == 429) {
                            if (attempt < RETRY_DELAYS.length) {
                                sleepMs(RETRY_DELAYS[attempt]);
                                attempt++;
                                if (ChapterReadPlugin.stopRequested) { skip = true; break; }
                                continue;
                            } else {
                                skip = true; // исчерпали попытки — следующая глава
                                break;
                            }
                        }
                        if (rr.status == 502 && ignore502) {
                            sleepMs(3000);
                            if (ChapterReadPlugin.stopRequested) break;
                            continue;
                        }
                        break;
                    }

                    if (ChapterReadPlugin.stopRequested) break;
                    if (skip) continue;

                    if (rr.status == 200 || rr.status == 204) {
                        // Карты приходят прямо в ответе views/ (как у друга).
                        ChapterReadPlugin.readsDone++;
                        ChapterReadPlugin.coins += rr.coins;
                        ChapterReadPlugin.cards += rr.cards;
                        for (RewardCard card : rr.rewardCards) {
                            rewardCards.put(new JSONObject().put("mid", card.mid).put("high", card.high));
                        }
                        ChapterReadPlugin.rewardCardsJson = rewardCards.toString();
                        updateNotification();
                        sleepMs(readDelayMs);
                    } else {
                        // любая иная ошибка — стоп
                        finish("Ошибка: HTTP " + rr.status);
                        return;
                    }
                }

                if (ChapterReadPlugin.stopRequested) break;

                // защита от бесконечного цикла, если весь проход ушёл в 429-пропуски
                if (ChapterReadPlugin.readsDone == before) {
                    finish("Слишком много 429 подряд");
                    return;
                }

                // главы кончились — снова сброс всего набора и с начала.
                // После первого прохода прочитанными стали все главы набора.
                if (ChapterReadPlugin.readsDone < target) {
                    if (!markUnread(token, readingSet)) {
                        finish("Не удалось сбросить главы");
                        return;
                    }
                    sleepMs(500);
                }
            }

            finish(ChapterReadPlugin.stopRequested ? "Остановлено" : "Готово");
        } catch (Exception e) {
            finish("Ошибка: " + e.getClass().getSimpleName());
        }
    }

    private void finish(String reason) {
        ChapterReadPlugin.stoppedReason = reason;
        ChapterReadPlugin.running = false;
        releaseWakeLock();
        postSummary(reason);
        stopForegroundCompat();
        stopSelf();
    }

    // ─── HTTP ────────────────────────────────────────────────────────────────

    private static class ReadResult {
        int status;
        int coins;
        int cards;
        final List<RewardCard> rewardCards = new ArrayList<>();
    }

    private static class RewardCard {
        final String mid;
        final String high;

        RewardCard(String mid, String high) {
            this.mid = mid;
            this.high = high;
        }
    }

    private static void applyHeaders(HttpURLConnection conn, String token, boolean json) {
        conn.setRequestProperty("accept", "*/*");
        conn.setRequestProperty("accept-language", "en-US,en;q=0.9,ru;q=0.8,zh-CN;q=0.7,zh;q=0.6");
        conn.setRequestProperty("authorization", "Bearer " + token);
        conn.setRequestProperty("origin", "https://remanga.org");
        conn.setRequestProperty("priority", "u=1, i");
        conn.setRequestProperty("referer", "https://remanga.org/");
        conn.setRequestProperty("sec-ch-ua",
                "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"");
        conn.setRequestProperty("sec-ch-ua-mobile", "?0");
        conn.setRequestProperty("sec-ch-ua-platform", "\"Android\"");
        conn.setRequestProperty("sec-fetch-dest", "empty");
        conn.setRequestProperty("sec-fetch-mode", "cors");
        conn.setRequestProperty("sec-fetch-site", "same-site");
        conn.setRequestProperty("user-agent", AppUserAgent.get());
        if (json) conn.setRequestProperty("content-type", "application/json");
    }

    private static String readBody(InputStream is) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(is, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) sb.append(line);
        r.close();
        return sb.toString();
    }

    private String httpGet(String urlStr, String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(100000);
            conn.setReadTimeout(100000);
            applyHeaders(conn, token, false);
            if (conn.getResponseCode() != 200) return null;
            return readBody(conn.getInputStream());
        } catch (Exception e) {
            Log.w(TAG, "httpGet", e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static class ChapterSets {
        final List<Integer> all = new ArrayList<>();     // все главы ветки — читаем их
        final List<Integer> viewed = new ArrayList<>();  // только прочитанные — их сбрасываем на 1-м проходе
    }

    private ChapterSets collectChapters(String token, int branchId) throws Exception {
        ChapterSets s = new ChapterSets();
        int page = 1;
        while (true) {
            String url = API_V2 + "/titles/chapters/?branch_id=" + branchId
                    + "&chapter=&ordering=index&page=" + page + "&user_data=1";
            String body = httpGet(url, token);
            if (body == null) throw new Exception("chapters null");

            JSONObject root = new JSONObject(body);
            JSONArray results = root.optJSONArray("results");
            if (results == null) break;
            for (int i = 0; i < results.length(); i++) {
                JSONObject ch = results.optJSONObject(i);
                if (ch != null && ch.has("id")) {
                    int id = ch.optInt("id");
                    s.all.add(id);
                    if (ch.optBoolean("viewed", false)) s.viewed.add(id);
                }
            }
            Object next = root.opt("next");
            if (next == null || next == JSONObject.NULL || results.length() == 0) break;
            page = (next instanceof Number) ? ((Number) next).intValue() : page + 1;
        }
        return s;
    }

    private boolean markUnread(String token, List<Integer> ids) {
        HttpURLConnection conn = null;
        try {
            JSONArray arr = new JSONArray();
            for (int id : ids) arr.put(id);
            String body = new JSONObject().put("chapter_ids", arr).toString();

            conn = (HttpURLConnection) new URL(VIEWS_URL).openConnection();
            conn.setRequestMethod("DELETE");
            conn.setConnectTimeout(100000);
            conn.setReadTimeout(100000);
            applyHeaders(conn, token, true);
            conn.setDoOutput(true);
            byte[] b = body.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(b.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(b); }

            int code = conn.getResponseCode();
            return code < 400;
        } catch (Exception e) {
            Log.w(TAG, "markUnread", e);
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private ReadResult doRead(String token, int chapterId) {
        HttpURLConnection conn = null;
        ReadResult rr = new ReadResult();
        try {
            conn = (HttpURLConnection) new URL(VIEWS_URL).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(100000);
            conn.setReadTimeout(100000);
            applyHeaders(conn, token, true);
            conn.setDoOutput(true);
            byte[] b = ("{\"chapter\":" + chapterId + "}").getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(b.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(b); }

            int code = conn.getResponseCode();
            rr.status = code;
            if (code == 200) {
                String body = readBody(conn.getInputStream());
                try {
                    JSONObject response = new JSONObject(body);
                    JSONArray rewards = response.optJSONArray("rewards");
                    if (rewards == null && response.opt("rewards") instanceof JSONObject) {
                        rewards = new JSONArray().put(response.optJSONObject("rewards"));
                    }
                    if (rewards == null) {
                        Object reward = response.opt("reward");
                        if (reward instanceof JSONArray) rewards = (JSONArray) reward;
                        else if (reward instanceof JSONObject) rewards = new JSONArray().put(reward);
                    }
                    if (rewards != null) {
                        for (int i = 0; i < rewards.length(); i++) {
                            JSONObject r = rewards.optJSONObject(i);
                            if (r == null) continue;
                            if ("coins".equals(r.optString("type", ""))) rr.coins += r.optInt("value", 0);
                            else {
                                rr.cards += 1;
                                RewardCard card = findRewardCard(r);
                                if (card != null) rr.rewardCards.add(card);
                            }
                        }
                    } else {
                        RewardCard card = findRewardCard(response);
                        if (card != null) {
                            rr.cards += 1;
                            rr.rewardCards.add(card);
                        }
                    }
                } catch (Exception ignore) { /* тело без наград — не страшно */ }
            }
            return rr;
        } catch (Exception e) {
            Log.w(TAG, "doRead", e);
            rr.status = -1; // сетевая ошибка → трактуется как «иная ошибка» → стоп
            return rr;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** Обложка может лежать прямо в reward или внутри value/item/card. */
    private static RewardCard findRewardCard(Object node) {
        if (node instanceof JSONObject) {
            JSONObject obj = (JSONObject) node;
            for (String key : new String[] { "card", "item", "value", "reward" }) {
                RewardCard nested = findRewardCard(obj.opt(key));
                if (nested != null) return nested;
            }

            JSONObject cover = obj.optJSONObject("cover");
            if (cover != null) {
                String mid = cover.optString("mid", cover.optString("low", ""));
                String high = cover.optString("high", "");
                if (mid.isEmpty()) mid = high;
                if (high.isEmpty()) high = mid;
                if (isCardImage(mid) || isCardImage(high)) return new RewardCard(mid, high);
            }

            JSONArray keys = obj.names();
            if (keys != null) {
                for (int i = 0; i < keys.length(); i++) {
                    String key = keys.optString(i, "");
                    if ("card".equals(key) || "item".equals(key) || "value".equals(key) || "reward".equals(key)) continue;
                    RewardCard nested = findRewardCard(obj.opt(key));
                    if (nested != null) return nested;
                }
            }
        } else if (node instanceof JSONArray) {
            JSONArray arr = (JSONArray) node;
            for (int i = 0; i < arr.length(); i++) {
                RewardCard nested = findRewardCard(arr.opt(i));
                if (nested != null) return nested;
            }
        } else if (node instanceof String) {
            String path = (String) node;
            if (isCardImage(path)) return new RewardCard(path, path);
        }
        return null;
    }

    private static boolean isCardImage(String path) {
        return path != null && path.contains("card-item/");
    }

    /** Голос/лайк за главу: POST votes/ {"chapter_ids":[id]}. Один раз на главу. */
    private int doVote(String token, int chapterId) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(VOTES_URL).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(100000);
            conn.setReadTimeout(100000);
            applyHeaders(conn, token, true);
            conn.setDoOutput(true);
            byte[] b = ("{\"chapter_ids\":[" + chapterId + "]}").getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(b.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(b); }
            return conn.getResponseCode();
        } catch (Exception e) {
            Log.w(TAG, "doVote", e);
            return -1;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * Тестовый запрос: шлёт views/ на указанную главу и возвращает
     * полный текст запроса (метод, URL, заголовки, тело) и ответа
     * (статус, заголовки, тело). Для ручной проверки «наполненности».
     */
    static String debugViews(String token, int chapterId) {
        StringBuilder sb = new StringBuilder();
        HttpURLConnection conn = null;
        try {
            String reqBody = "{\"chapter\":" + chapterId + "}";

            conn = (HttpURLConnection) new URL(VIEWS_URL).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(100000);
            conn.setReadTimeout(100000);
            applyHeaders(conn, token, true);
            conn.setDoOutput(true);

            sb.append("=== REQUEST ===\n");
            sb.append("POST ").append(VIEWS_URL).append("\n");
            sb.append("-- headers --\n");
            for (Map.Entry<String, List<String>> e : conn.getRequestProperties().entrySet()) {
                sb.append(e.getKey()).append(": ").append(joinValues(e.getValue())).append("\n");
            }
            sb.append("-- body --\n").append(reqBody).append("\n\n");

            byte[] b = reqBody.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(b.length);
            try (OutputStream os = conn.getOutputStream()) { os.write(b); }

            int code = conn.getResponseCode();
            sb.append("=== RESPONSE ===\n");
            sb.append("status: ").append(code).append("\n");
            sb.append("-- headers --\n");
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                String key = e.getKey() == null ? "(status-line)" : e.getKey();
                sb.append(key).append(": ").append(joinValues(e.getValue())).append("\n");
            }
            InputStream is = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            String respBody = "";
            try { if (is != null) respBody = readBody(is); } catch (Exception ignore) {}
            sb.append("-- body --\n").append(respBody).append("\n");
        } catch (Exception e) {
            sb.append("EXCEPTION: ").append(e.toString()).append("\n");
        } finally {
            if (conn != null) conn.disconnect();
        }
        Log.i(TAG, "TEST VIEWS chapter=" + chapterId + "\n" + sb);
        return sb.toString();
    }

    private static String joinValues(List<String> values) {
        if (values == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) sb.append(", ");
            sb.append(values.get(i));
        }
        return sb.toString();
    }

    private void sleepMs(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }

    // ─── Уведомление ─────────────────────────────────────────────────────────

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CH_ID, "Чтение глав", NotificationManager.IMPORTANCE_LOW);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    private String statusText() {
        return "Прочитано " + ChapterReadPlugin.readsDone + "/" + ChapterReadPlugin.target
                + " · \u26A1 " + ChapterReadPlugin.coins
                + " · \uD83C\uDCCF " + ChapterReadPlugin.cards;
    }

    private PendingIntent launchPendingIntent() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, NOTIF_ID, launch, flags);
    }

    private PendingIntent stopPendingIntent() {
        Intent stopIntent = new Intent(ACTION_STOP).setPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(this, 1, stopIntent, flags);
    }

    private Notification buildNotification(String text) {
        return new NotificationCompat.Builder(this, CH_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Чтение глав")
                .setContentText(text)
                .setContentIntent(launchPendingIntent())
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Остановить", stopPendingIntent())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void updateNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(NOTIF_ID, buildNotification(statusText())); } catch (SecurityException ignored) {}
        }
    }

    private void postSummary(String reason) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification n = new NotificationCompat.Builder(this, CH_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Чтение глав — " + reason)
                .setContentText(statusText())
                .setContentIntent(launchPendingIntent())
                .setOngoing(false)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
        try { nm.notify(NOTIF_ID + 1, n); } catch (SecurityException ignored) {}
    }

    private void startAsForeground(Notification n) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
    }

    // ─── Стоп из уведомления ─────────────────────────────────────────────────

    public static class StopReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            ChapterReadPlugin.stopRequested = true;
            try { context.stopService(new Intent(context, ChapterReadService.class)); } catch (Exception ignored) {}
        }
    }

    private void registerStop() {
        if (stopReceiver != null) return;
        stopReceiver = new StopReceiver();
        IntentFilter filter = new IntentFilter(ACTION_STOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(stopReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(stopReceiver, filter);
        }
    }

    // ─── Wake lock ────────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "redecks:chapterread");
                wakeLock.acquire();
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        ChapterReadPlugin.stopRequested = true;
        ChapterReadPlugin.running = false;
        if (stopReceiver != null) {
            try { unregisterReceiver(stopReceiver); } catch (Exception ignored) {}
            stopReceiver = null;
        }
        releaseWakeLock();
    }
}
