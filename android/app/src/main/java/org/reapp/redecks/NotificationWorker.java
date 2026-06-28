package org.reapp.redecks;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * Раз в ~15 минут (через WorkManager): если уведомления включены — берём
 * список комнат, ищем непрочитанные (last_read_dt < last_update_dt), и на
 * каждую новую шлём локальное уведомление. Без звука; вибрация по настройке.
 */
public class NotificationWorker extends Worker {

    private static final String ROOMS_URL = "https://api.remanga.org/api/v2/chat/rooms/?name=";
    private static final String CH_SILENT = "redecks_msgs_silent";
    private static final String CH_VIBRATE = "redecks_msgs_vibrate";
    // Отдельный фиксированный id для сводного уведомления об обменах,
    // чтобы оно не конфликтовало с уведомлениями чата (там id = id комнаты).
    private static final int EX_NOTIF_ID = 90000001;
    private static final String TAG = "ReDecksNotif";

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(NotifierPlugin.PREFS, Context.MODE_PRIVATE);

        Log.d(TAG, "doWork: старт");

        // Общий рубильник выключен — ничего не делаем и даже не запрашиваем
        if (!prefs.getBoolean("enabled", false)) {
            Log.d(TAG, "doWork: выход — общий рубильник enabled=false");
            return Result.success();
        }

        String token = prefs.getString("token", "");
        if (token == null || token.isEmpty()) {
            Log.d(TAG, "doWork: выход — пустой token");
            return Result.success();
        }

        // Уведомляем только когда пользователь НЕ в приложении.
        // (Заодно не дёргаем сеть зря, пока приложение открыто.)
        if (NotifierPlugin.APP_IN_FOREGROUND) {
            Log.d(TAG, "doWork: выход — приложение на переднем плане (APP_IN_FOREGROUND=true)");
            return Result.success();
        }

        boolean vibrate = prefs.getBoolean("vibrate", true);
        boolean chatEnabled = prefs.getBoolean("chatEnabled", true);
        boolean exchangesEnabled = prefs.getBoolean("exchangesEnabled", true);
        Log.d(TAG, "doWork: chatEnabled=" + chatEnabled + " exchangesEnabled=" + exchangesEnabled);

        boolean ok = true;
        if (chatEnabled) ok &= runChat(ctx, prefs, token, vibrate);
        if (exchangesEnabled) ok &= runExchanges(ctx, prefs, token, vibrate);

        Log.d(TAG, "doWork: конец, ok=" + ok);
        // Если сеть подвела — попросим перепланировать пораньше.
        return ok ? Result.success() : Result.retry();
    }

    /** Чат: непрочитанные комнаты (last_read_dt < last_update_dt). */
    private boolean runChat(Context ctx, SharedPreferences prefs, String token, boolean vibrate) {
        Set<String> muted = new HashSet<>(Arrays.asList(prefs.getString("muted", "").split(",")));

        String body = httpGet(ROOMS_URL, token);
        if (body == null) {
            Log.w(TAG, "runChat: запрос комнат не удался");
            return false;
        }

        try {
            JSONArray rooms = new JSONArray(body);
            boolean firstRun = !prefs.getBoolean("initialized", false);
            Log.d(TAG, "runChat: комнат=" + rooms.length() + " firstRun=" + firstRun);
            int notified = 0;

            for (int i = 0; i < rooms.length(); i++) {
                JSONObject room = rooms.getJSONObject(i);
                int id = room.optInt("id", 0);
                if (id == 0) continue;

                String name = room.optString("name", "Чат");
                String lastUpdate = room.isNull("last_update_dt") ? null : room.optString("last_update_dt", null);
                String lastRead = room.isNull("last_read_dt") ? null : room.optString("last_read_dt", null);
                if (lastUpdate == null) continue;

                // непрочитано: last_read раньше last_update (иначе это наше или уже прочитано)
                boolean unread = (lastRead == null) || (lastRead.compareTo(lastUpdate) < 0);
                if (!unread) continue;
                if (muted.contains(String.valueOf(id))) continue;

                String seenKey = "seen_" + id;
                boolean isNew = lastUpdate.compareTo(prefs.getString(seenKey, "")) > 0;

                // на первом запуске только запоминаем базовую точку, не спамим
                if (!firstRun && isNew) {
                    showNotification(ctx, id, name, lastUpdate, vibrate);
                    notified++;
                }

                // Помечаем обновление «увиденным» сразу и по отдельности, а не
                // общим apply() в конце: иначе гибель процесса до конца цикла
                // сбросила бы дедуп всего прогона и дала бы повторы.
                prefs.edit().putString(seenKey, lastUpdate).apply();
            }

            Log.d(TAG, "runChat: показано уведомлений=" + notified);
            prefs.edit().putBoolean("initialized", true).apply();
        } catch (Exception e) {
            Log.e(TAG, "runChat: ошибка разбора", e);
        }
        return true;
    }

    /**
     * Обмены: входящие wait-обмены, где отправитель — НЕ пользователь.
     * Уведомляем количеством новых (которых не было в базовой линии ex_seen).
     */
    private boolean runExchanges(Context ctx, SharedPreferences prefs, String token, boolean vibrate) {
        String userId = prefs.getString("userId", "");
        if (userId == null || userId.isEmpty()) {
            Log.w(TAG, "runExchanges: пустой userId — пропуск");
            return true; // нечего запрашивать
        }

        String url = "https://api.remanga.org/api/v2/inventory/" + userId + "/exchanges/?ordering=-id&page=1";
        String body = httpGet(url, token);
        if (body == null) {
            Log.w(TAG, "runExchanges: запрос обменов не удался");
            return false;
        }

        try {
            JSONObject root = new JSONObject(body);
            JSONArray results = root.optJSONArray("results");
            if (results == null) {
                Log.w(TAG, "runExchanges: в ответе нет results");
                return true;
            }

            boolean firstRun = !prefs.getBoolean("ex_initialized", false);
            Set<String> seen = new HashSet<>(Arrays.asList(prefs.getString("ex_seen", "").split(",")));
            seen.remove("");

            int meId = -1;
            try { meId = Integer.parseInt(userId); } catch (Exception ignored) {}

            Set<String> incoming = new HashSet<>(); // текущие входящие wait id
            int newCount = 0;

            for (int i = 0; i < results.length(); i++) {
                JSONObject ex = results.optJSONObject(i);
                if (ex == null) continue;
                int id = ex.optInt("id", 0);
                if (id == 0) continue;

                String status = ex.optString("status", "");
                JSONObject creator = ex.optJSONObject("creator");
                int creatorId = creator == null ? -1 : creator.optInt("id", -1);

                // входящий: статус wait И отправитель не текущий пользователь
                if (!"wait".equals(status) || creatorId == meId) continue;

                String sid = String.valueOf(id);
                incoming.add(sid);
                if (!seen.contains(sid)) newCount++;
            }

            Log.d(TAG, "runExchanges: всего=" + results.length()
                    + " входящих wait=" + incoming.size()
                    + " новых=" + newCount
                    + " firstRun=" + firstRun
                    + " базовая_линия=" + seen.size());

            // первый прогон только запоминает базовую точку, не уведомляет
            if (!firstRun && newCount > 0) {
                showExchangeNotification(ctx, newCount, vibrate);
                Log.d(TAG, "runExchanges: показано уведомление о " + newCount + " новых");
            }

            // актуальный набор входящих сохраняем как «виденные» (и ограничивает рост)
            StringBuilder sb = new StringBuilder();
            for (String s : incoming) {
                if (sb.length() > 0) sb.append(",");
                sb.append(s);
            }
            prefs.edit()
                    .putString("ex_seen", sb.toString())
                    .putBoolean("ex_initialized", true)
                    .apply();
        } catch (Exception e) {
            Log.e(TAG, "runExchanges: ошибка разбора", e);
        }
        return true;
    }

    private void showExchangeNotification(Context ctx, int count, boolean vibrate) {
        if (NotifierPlugin.APP_IN_FOREGROUND) return;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannels(nm);

        String text = count + " " + pluralExchanges(count);
        String channel = vibrate ? CH_VIBRATE : CH_SILENT;

        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("openExchanges", true); // задел: открыть раздел обменов
        }
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, EX_NOTIF_ID, launch, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Новые обмены")
                .setContentText(text)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setSound(null);
            b.setVibrate(vibrate ? new long[]{0, 250} : new long[]{0});
        }

        try {
            nm.notify(EX_NOTIF_ID, b.build());
            Log.d(TAG, "showExchangeNotification: notify отправлен");
        } catch (SecurityException e) {
            Log.w(TAG, "showExchangeNotification: нет разрешения POST_NOTIFICATIONS");
        }
    }

    /** «1 новый обмен» / «2 новых обмена» / «5 новых обменов» */
    private String pluralExchanges(int n) {
        int m10 = n % 10, m100 = n % 100;
        if (m10 == 1 && m100 != 11) return "новый обмен";
        if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "новых обмена";
        return "новых обменов";
    }

    private void showNotification(Context ctx, int id, String roomName, String lastUpdate, boolean vibrate) {
        // Пользователь мог открыть приложение, пока шёл сетевой запрос.
        if (NotifierPlugin.APP_IN_FOREGROUND) return;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannels(nm);

        String text = roomName + " Новое сообщение " + localTime(lastUpdate);
        String channel = vibrate ? CH_VIBRATE : CH_SILENT;

        // Тап -> открыть приложение (пока без конкретного чата; roomId в extra — задел).
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("roomId", id);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, id, launch, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("ReDecks")
                .setContentText(text)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setSound(null);
            b.setVibrate(vibrate ? new long[]{0, 250} : new long[]{0});
        }

        try {
            nm.notify(id, b.build());
            Log.d(TAG, "showNotification: notify отправлен для комнаты " + id);
        } catch (SecurityException ignored) {
            Log.w(TAG, "showNotification: нет разрешения POST_NOTIFICATIONS");
        }
    }

    private void ensureChannels(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel silent = new NotificationChannel(
                CH_SILENT, "Сообщения", NotificationManager.IMPORTANCE_DEFAULT);
        silent.setSound(null, null);
        silent.enableVibration(false);
        nm.createNotificationChannel(silent);

        NotificationChannel vib = new NotificationChannel(
                CH_VIBRATE, "Сообщения (вибрация)", NotificationManager.IMPORTANCE_DEFAULT);
        vib.setSound(null, null);
        vib.enableVibration(true);
        nm.createNotificationChannel(vib);
    }

    /** Время API — московское (UTC+3). Переводим в локальную зону устройства, HH:mm. */
    private String localTime(String mskTime) {
        try {
            String iso = mskTime.replace(' ', 'T');
            int dot = iso.indexOf('.');
            if (dot >= 0) iso = iso.substring(0, dot);

            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("GMT+3"));
            Date d = in.parse(iso);

            SimpleDateFormat out = new SimpleDateFormat("HH:mm", Locale.getDefault());
            out.setTimeZone(TimeZone.getDefault());
            return out.format(d);
        } catch (Exception e) {
            return "";
        }
    }

    private String httpGet(String urlStr, String token) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Android) ReDecks");
            conn.setRequestProperty("Referer", "https://remanga.org/");
            conn.setRequestProperty("Origin", "https://remanga.org");
            conn.setRequestProperty("Accept", "application/json");

            int code = conn.getResponseCode();
            if (code != 200) {
                Log.w(TAG, "httpGet: HTTP " + code + " для " + urlStr);
                return null;
            }

            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "httpGet: сетевая ошибка для " + urlStr, e);
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
