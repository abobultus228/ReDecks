package org.reapp.redecks;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
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
        String userId = call.getString("userId", "");
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        boolean chatEnabled = Boolean.TRUE.equals(call.getBoolean("chatEnabled", true));
        boolean exchangesEnabled = Boolean.TRUE.equals(call.getBoolean("exchangesEnabled", true));
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
                .putString("userId", userId == null ? "" : userId)
                .putBoolean("enabled", enabled)
                .putBoolean("chatEnabled", chatEnabled)
                .putBoolean("exchangesEnabled", exchangesEnabled)
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

    /**
     * Базовая линия обменов: id входящих wait-обменов, которые пользователь
     * уже видел (приложение на переднем плане их показало). Воркер потом
     * уведомляет только о появившихся позже.
     */
    @PluginMethod
    public void setExchangeBaseline(PluginCall call) {
        Context ctx = getContext();
        StringBuilder ids = new StringBuilder();
        JSArray arr = call.getArray("ids");
        if (arr != null) {
            try {
                for (int i = 0; i < arr.length(); i++) {
                    if (ids.length() > 0) ids.append(",");
                    ids.append(arr.getInt(i));
                }
            } catch (Exception ignored) {}
        }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("ex_seen", ids.toString())
                .putBoolean("ex_initialized", true)
                .apply();
        call.resolve();
    }

    /** Инфо об устройстве для онбординга: вендор, версия, статус оптимизации батареи. */
    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        res.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        res.put("model", Build.MODEL == null ? "" : Build.MODEL);
        res.put("sdkInt", Build.VERSION.SDK_INT);
        res.put("ignoringBatteryOptimizations", isIgnoringBattery(ctx));
        call.resolve(res);
    }

    /** Открывает системный экран «О приложении» (оттуда доступны батарея и тумблеры вендора). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Системный диалог «игнорировать оптимизацию батареи». Универсален для большинства вендоров. */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        if (isIgnoringBattery(ctx)) {
            res.put("already", true);
            call.resolve(res);
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
        } catch (Exception e) {
            // На части прошивок intent отсутствует — откроем экран настроек приложения.
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:" + ctx.getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
            } catch (Exception ignored) {}
        }
        res.put("already", false);
        call.resolve(res);
    }

    private boolean isIgnoringBattery(Context ctx) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
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
