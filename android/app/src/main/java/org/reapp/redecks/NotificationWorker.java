package org.reapp.redecks;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

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

    public NotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences prefs = ctx.getSharedPreferences(NotifierPlugin.PREFS, Context.MODE_PRIVATE);

        // Общий рубильник выключен — ничего не делаем и даже не запрашиваем
        if (!prefs.getBoolean("enabled", false)) return Result.success();

        String token = prefs.getString("token", "");
        if (token == null || token.isEmpty()) return Result.success();

        boolean vibrate = prefs.getBoolean("vibrate", true);
        Set<String> muted = new HashSet<>(Arrays.asList(prefs.getString("muted", "").split(",")));

        String body = httpGet(ROOMS_URL, token);
        if (body == null) return Result.retry();

        try {
            JSONArray rooms = new JSONArray(body);
            boolean firstRun = !prefs.getBoolean("initialized", false);
            SharedPreferences.Editor editor = prefs.edit();

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
                editor.putString(seenKey, lastUpdate);

                // на первом запуске только запоминаем базовую точку, не спамим
                if (!firstRun && isNew) {
                    showNotification(ctx, id, name, lastUpdate, vibrate);
                }
            }

            editor.putBoolean("initialized", true);
            editor.apply();
        } catch (Exception e) {
            return Result.success();
        }
        return Result.success();
    }

    private void showNotification(Context ctx, int id, String roomName, String lastUpdate, boolean vibrate) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannels(nm);

        String text = roomName + " Новое сообщение " + localTime(lastUpdate);
        String channel = vibrate ? CH_VIBRATE : CH_SILENT;

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("ReDecks")
                .setContentText(text)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            b.setSound(null);
            b.setVibrate(vibrate ? new long[]{0, 250} : new long[]{0});
        }

        try {
            nm.notify(id, b.build());
        } catch (SecurityException ignored) {
            // нет разрешения POST_NOTIFICATIONS — молча пропускаем
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

            if (conn.getResponseCode() != 200) return null;

            BufferedReader r = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
