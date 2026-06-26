package org.reapp.redecks;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.TimeUnit;

/**
 * Мост из JS в фоновый уведомитель. Сохраняет настройки в SharedPreferences
 * (их читает NotificationWorker) и включает/выключает периодическую задачу
 * WorkManager (минимальный интервал — 15 минут).
 */
@CapacitorPlugin(name = "Notifier")
public class NotifierPlugin extends Plugin {

    static final String PREFS = "redecks_notify";
    static final String WORK_NAME = "redecks-notify";

    /** true, пока приложение на переднем плане. Ставится из MainActivity
     *  (onStart/onStop). Worker живёт в том же процессе и читает этот флаг,
     *  чтобы не уведомлять, когда пользователь в приложении. Если процесс
     *  холодно поднят самим WorkManager (приложение убито), MainActivity не
     *  создаётся и флаг остаётся false — что и значит «не в приложении». */
    public static volatile boolean APP_IN_FOREGROUND = false;

    @PluginMethod
    public void setConfig(PluginCall call) {
        Context ctx = getContext();

        String token = call.getString("token", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        boolean vibrate = Boolean.TRUE.equals(call.getBoolean("vibrate", true));

        StringBuilder muted = new StringBuilder();
        JSArray arr = call.getArray("mutedRooms");
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    if (muted.length() > 0) muted.append(",");
                    muted.append(arr.getInt(i));
                }
            } catch (Exception ignored) {}
        }

        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString("token", token == null ? "" : token)
                .putBoolean("enabled", enabled)
                .putBoolean("vibrate", vibrate)
                .putString("muted", muted.toString())
                .apply();

        if (enabled) {
            scheduleWork(ctx);
        } else {
            WorkManager.getInstance(ctx).cancelUniqueWork(WORK_NAME);
        }
        call.resolve();
    }

    private void scheduleWork(Context ctx) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();

        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(
                NotificationWorker.class, 15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build();

        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, req);
    }
}
