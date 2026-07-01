package org.reapp.redecks;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Random;

/**
 * Foreground-сервис авто-дуэлей ивента: в цикле POST-ит матч, считает победы,
 * держит постоянное уведомление и wake-lock, чтобы работать при закрытом
 * приложении. Останавливается сам при неожиданном ответе (cooldown != 30,
 * другая структура, ошибка) или по команде из плагина.
 */
public class EventBattleService extends Service {

    private static final String TAG = "EventBattle";
    private static final String CH_ID = "event_battle";
    private static final int NOTIF_ID = 90000002;
    private static final int STOP_REQUEST_CODE = 90000003;
    private static final String ACTION_STOP = "org.reapp.redecks.action.EVENT_BATTLE_STOP";
    private static final String MATCH_URL =
            "https://api.remanga.org/api/v2/events/card-battle/pvp/match/";

    private Thread worker;
    private PowerManager.WakeLock wakeLock;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Нажатие кнопки "Остановить" в уведомлении — просто выставляем флаг,
        // рабочий цикл сам увидит его на ближайшей проверке и корректно завершится
        // через finish() (снимет wake-lock, обновит уведомление, остановит сервис).
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            EventBattlePlugin.stopRequested = true;
            return START_NOT_STICKY;
        }

        final String token = intent == null ? "" : intent.getStringExtra("token");
        final int total = intent == null ? 0 : intent.getIntExtra("total", 0);
        final long delayMs = intent == null ? 40000L : intent.getLongExtra("delayMs", 40000L);
        final long deviationMs = intent == null ? 0L : intent.getLongExtra("deviationMs", 0L);

        ensureChannel();
        startAsForeground(buildNotification("Запуск…"));
        acquireWakeLock();

        EventBattlePlugin.running = true;
        EventBattlePlugin.stopRequested = false;
        EventBattlePlugin.battlesDone = 0;
        EventBattlePlugin.wins = 0;
        EventBattlePlugin.total = total;
        EventBattlePlugin.stoppedReason = "";
        EventBattlePlugin.nextBattleAtMs = 0;
        EventBattlePlugin.waitMs = 0;

        worker = new Thread(() -> runLoop(token, total, delayMs, deviationMs));
        worker.start();

        return START_NOT_STICKY;
    }

    private void runLoop(String token, int total, long delayMs, long deviationMs) {
        Random rnd = new Random();
        try {
            while (!EventBattlePlugin.stopRequested) {
                String outcome = doMatch(token);

                if (!"won".equals(outcome) && !"lost".equals(outcome)) {
                    // неожиданный ответ/ошибка — стоп
                    finish(outcome);
                    return;
                }

                EventBattlePlugin.battlesDone++;
                if ("won".equals(outcome)) EventBattlePlugin.wins++;
                updateNotification();

                if (total > 0 && EventBattlePlugin.battlesDone >= total) {
                    finish("Готово: выполнено " + EventBattlePlugin.battlesDone);
                    return;
                }

                // пауза: задержка ± отклонение
                long dev = deviationMs <= 0 ? 0 : (long) ((rnd.nextDouble() * 2 - 1) * deviationMs);
                long wait = delayMs + dev;
                if (wait < 1000) wait = 1000;
                EventBattlePlugin.waitMs = wait;
                EventBattlePlugin.nextBattleAtMs = System.currentTimeMillis() + wait;

                long slept = 0;
                while (slept < wait && !EventBattlePlugin.stopRequested) {
                    Thread.sleep(250);
                    slept += 250;
                }
            }
            finish("Остановлено");
        } catch (InterruptedException e) {
            finish("Остановлено");
        }
    }

    /** Возвращает "won", "lost" или человекочитаемую причину ошибки. */
    private String doMatch(String token) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(MATCH_URL).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(20000);
            conn.setDoOutput(false); // content-length: 0

            conn.setRequestProperty("accept", "*/*");
            conn.setRequestProperty("accept-language", "en-US,en;q=0.9,ru;q=0.8,zh-CN;q=0.7,zh;q=0.6");
            conn.setRequestProperty("authorization", "Bearer " + token);
            conn.setRequestProperty("origin", "https://remanga.org");
            conn.setRequestProperty("priority", "u=1, i");
            conn.setRequestProperty("referer", "https://remanga.org/");
            conn.setRequestProperty("sec-ch-ua",
                    "\"Google Chrome\";v=\"149\", \"Chromium\";v=\"149\", \"Not)A;Brand\";v=\"24\"");
            conn.setRequestProperty("sec-ch-ua-mobile", "?0");
            conn.setRequestProperty("sec-ch-ua-platform", "\"Windows\"");
            conn.setRequestProperty("sec-fetch-dest", "empty");
            conn.setRequestProperty("sec-fetch-mode", "cors");
            conn.setRequestProperty("sec-fetch-site", "same-site");
            conn.setRequestProperty("user-agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                            "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36");

            conn.connect();
            int code = conn.getResponseCode();
            if (code != 200 && code != 201) {
                return "Ошибка сервера (HTTP " + code + ")";
            }

            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();

            JSONObject root = new JSONObject(sb.toString());
            JSONObject result = root.optJSONObject("result");
            if (result == null || !result.has("won") || !result.has("cooldown_seconds")) {
                return "Неожиданный ответ сервера";
            }
            int cooldown = result.optInt("cooldown_seconds", -1);
            if (cooldown < 20 || cooldown > 30) {
                return "Другой cooldown (" + cooldown + ") — остановка";
            }
            return result.optBoolean("won", false) ? "won" : "lost";
        } catch (Exception e) {
            Log.w(TAG, "doMatch error", e);
            return "Сетевая ошибка";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void finish(String reason) {
        EventBattlePlugin.stoppedReason = reason;
        EventBattlePlugin.running = false;
        EventBattlePlugin.nextBattleAtMs = 0;
        releaseWakeLock();
        // финальное (снимаемое) уведомление с итогом
        postSummary(reason);
        stopForegroundCompat();
        stopSelf();
    }

    // ─── Уведомления ──────────────────────────────────────────────────────────

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = new NotificationChannel(
                CH_ID, "Авто-дуэли ивента", NotificationManager.IMPORTANCE_LOW);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    private String statusText() {
        int done = EventBattlePlugin.battlesDone;
        int total = EventBattlePlugin.total;
        int wins = EventBattlePlugin.wins;
        String progress = total > 0 ? (done + " / " + total) : String.valueOf(done);
        return "Битв: " + progress + " · Побед: " + wins;
    }

    private Notification buildNotification(String text) {
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, NOTIF_ID, launch, flags);

        return new NotificationCompat.Builder(this, CH_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Ивент — дуэли идут")
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(buildStopAction())
                .build();
    }

    /** Кнопка "Остановить" в уведомлении — шлёт intent с ACTION_STOP этому же сервису. */
    private NotificationCompat.Action buildStopAction() {
        Intent stopIntent = new Intent(this, EventBattleService.class);
        stopIntent.setAction(ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        // Обычный getService (не getForegroundService) — нажатие на кнопку уведомления
        // считается пользовательским действием на переднем плане, доп. startForeground()
        // здесь не требуется.
        PendingIntent stopPi = PendingIntent.getService(this, STOP_REQUEST_CODE, stopIntent, flags);
        return new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "Остановить", stopPi).build();
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
                .setContentTitle("Ивент — остановлено")
                .setContentText(statusText() + " · " + reason)
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

    // ─── Wake lock ──────────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "redecks:eventbattle");
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
        EventBattlePlugin.stopRequested = true;
        EventBattlePlugin.running = false;
        releaseWakeLock();
    }
}
