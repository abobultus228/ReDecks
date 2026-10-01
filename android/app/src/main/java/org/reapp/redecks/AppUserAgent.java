package org.reapp.redecks;

import android.content.Context;

/**
 * Единый User-Agent приложения.
 *
 * ВАЖНО про DDoS-Guard: он привязывает куку __ddg* к тому User-Agent, под
 * которым эта кука получена. Получаем мы её в браузере логина (InAppBrowser
 * открывает remanga.org и проходит челлендж), а у него UA задан фиксированно
 * через OverrideUserAgent в capacitor.config.ts. Значит и все остальные
 * запросы (главный WebView, нативные загрузки картинок/медиа, API, фоновые
 * сервисы) должны идти под ТЕМ ЖЕ UA — иначе DDoS-Guard считает куку чужой и
 * вместо картинки отдаёт челлендж.
 *
 * Поэтому UA здесь фиксированный и ОБЯЗАН совпадать со строкой
 * OverrideUserAgent в capacitor.config.ts. Меняешь там — меняй и тут.
 *
 * (Динамический per-device UA пришлось убрать: браузер логина принимает только
 *  статичный UA из конфига, а он — единственное место, где мы можем пройти
 *  челлендж DDoS-Guard, так что UA всего приложения обязан быть таким же.)
 */
public final class AppUserAgent {

    /** ДОЛЖЕН совпадать с OverrideUserAgent в capacitor.config.ts. */
    public static final String UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 "
        + "(KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36";

    private AppUserAgent() {}

    /** Оставлено для совместимости вызовов (ничего не делает). */
    public static void init(Context ctx) { /* no-op */ }

    /** Оставлено для совместимости вызовов; выставляет UA на WebView в MainActivity. */
    public static String computeAndStore(Context ctx) { return UA; }

    /** Единый UA приложения. Безопасно с любого потока. */
    public static String get() { return UA; }
}
