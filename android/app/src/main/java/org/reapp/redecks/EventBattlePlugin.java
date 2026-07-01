package org.reapp.redecks;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Управляет foreground-сервисом авто-дуэлей ивента. Состояние держится в
 * статических полях (сервис живёт в том же процессе и их обновляет), JS читает
 * его через getState().
 */
@CapacitorPlugin(name = "EventBattle")
public class EventBattlePlugin extends Plugin {

    public static volatile boolean running = false;
    public static volatile boolean stopRequested = false;
    public static volatile int battlesDone = 0;
    public static volatile int wins = 0;
    public static volatile int total = 0; // 0 = бесконечно
    public static volatile long nextBattleAtMs = 0;
    public static volatile long waitMs = 0;
    public static volatile String stoppedReason = "";

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        String token = call.getString("token", "");
        Integer repInt = call.getInt("repetitions", 0);
        Integer delayInt = call.getInt("delaySeconds", 40);
        Integer devInt = call.getInt("deviationSeconds", 0);

        int reps = repInt == null ? 0 : repInt;
        int delaySec = delayInt == null ? 40 : delayInt;
        int devSec = devInt == null ? 0 : devInt;

        if (token == null || token.isEmpty()) {
            call.reject("Нет токена");
            return;
        }

        Intent i = new Intent(ctx, EventBattleService.class);
        i.putExtra("token", token);
        i.putExtra("total", reps);
        i.putExtra("delayMs", (long) delaySec * 1000L);
        i.putExtra("deviationMs", (long) devSec * 1000L);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Не удалось запустить сервис" : e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopRequested = true;
        try {
            Context ctx = getContext();
            ctx.stopService(new Intent(ctx, EventBattleService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", running);
        r.put("battlesDone", battlesDone);
        r.put("wins", wins);
        r.put("total", total);
        r.put("nextBattleAtMs", nextBattleAtMs);
        r.put("waitMs", waitMs);
        r.put("stoppedReason", stoppedReason);
        call.resolve(r);
    }
}
