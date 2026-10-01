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
 * Управляет foreground-сервисом чтения глав выбранного тайтла.
 * Состояние — в статических полях (сервис в том же процессе их обновляет),
 * JS читает через getState().
 */
@CapacitorPlugin(name = "ChapterRead")
public class ChapterReadPlugin extends Plugin {

    public static volatile boolean running = false;
    public static volatile boolean stopRequested = false;
    public static volatile int target = 0;
    public static volatile int branchId = 0;
    public static volatile int readsDone = 0;
    public static volatile int coins = 0;
    public static volatile int cards = 0;
    public static volatile String rewardCardsJson = "[]";
    public static volatile String stoppedReason = "";

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        String token = call.getString("token", "");
        Integer branchInt = call.getInt("branchId", 0);
        Integer targetInt = call.getInt("target", 0);
        Integer delayInt = call.getInt("delayMs", 1000);
        Boolean likeB = call.getBoolean("like", Boolean.TRUE);
        Boolean ignore502B = call.getBoolean("ignore502", Boolean.FALSE);

        int branchId = branchInt == null ? 0 : branchInt;
        int tgt = targetInt == null ? 0 : targetInt;
        long delayMs = delayInt == null ? 1000L : (long) (int) delayInt;
        if (delayMs < 300L) delayMs = 300L;
        if (delayMs > 1000L) delayMs = 1000L;
        boolean like = likeB == null || likeB;
        boolean ignore502 = Boolean.TRUE.equals(ignore502B);

        if (token == null || token.isEmpty()) { call.reject("Нет токена"); return; }
        if (branchId <= 0) { call.reject("Нет branchId"); return; }
        if (tgt <= 0) { call.reject("Неверное число глав"); return; }
        if (running) { call.reject("Чтение уже запущено"); return; }

        // сброс состояния до старта, чтобы JS не увидел старую причину
        stopRequested = false;
        running = false;
        readsDone = 0;
        coins = 0;
        cards = 0;
        rewardCardsJson = "[]";
        target = tgt;
        ChapterReadPlugin.branchId = branchId;
        stoppedReason = "";

        Intent i = new Intent(ctx, ChapterReadService.class);
        i.putExtra("token", token);
        i.putExtra("branchId", branchId);
        i.putExtra("target", tgt);
        i.putExtra("delayMs", delayMs);
        i.putExtra("like", like);
        i.putExtra("ignore502", ignore502);

        try {
            running = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
            call.resolve();
        } catch (Exception e) {
            running = false;
            call.reject(e.getMessage() == null ? "Не удалось запустить сервис" : e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopRequested = true;
        try {
            Context ctx = getContext();
            ctx.stopService(new Intent(ctx, ChapterReadService.class));
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", running);
        r.put("target", target);
        r.put("branchId", branchId);
        r.put("readsDone", readsDone);
        r.put("coins", coins);
        r.put("cards", cards);
        try {
            r.put("rewardCards", new org.json.JSONArray(rewardCardsJson));
        } catch (Exception ignored) {
            r.put("rewardCards", new org.json.JSONArray());
        }
        r.put("stoppedReason", stoppedReason);
        call.resolve(r);
    }

    /** Тестовый запрос views/ на одну главу с полным логом запроса и ответа. */
    @PluginMethod
    public void testViews(PluginCall call) {
        final String token = call.getString("token", "");
        Integer chapterInt = call.getInt("chapterId", 0);
        final int chapterId = chapterInt == null ? 0 : chapterInt;

        if (token == null || token.isEmpty()) { call.reject("Нет токена"); return; }
        if (chapterId <= 0) { call.reject("Нет chapterId"); return; }

        new Thread(() -> {
            String log = ChapterReadService.debugViews(token, chapterId);
            JSObject r = new JSObject();
            r.put("log", log);
            call.resolve(r);
        }).start();
    }
}
