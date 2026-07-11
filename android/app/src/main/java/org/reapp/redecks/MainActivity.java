package org.reapp.redecks;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;
import androidx.lifecycle.ProcessLifecycleOwner;

import com.getcapacitor.BridgeActivity;

/**
 * Прячет статус-бар (шторку уведомлений) И панель навигации Android
 * (кнопки домой / назад / недавние), пока приложение открыто.
 *
 * Используется «immersive sticky»: панели скрыты, при свайпе от края
 * показываются на пару секунд и снова прячутся.
 *
 * Флаги переустанавливаются в onWindowFocusChanged и onResume, потому что
 * Android сбрасывает их при возврате фокуса (после диалогов, сворачивания,
 * смены ориентации и т.п.).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ChatSocketPlugin.class);
        registerPlugin(NotifierPlugin.class);
        registerPlugin(EventBattlePlugin.class);
        registerPlugin(ChapterReadPlugin.class);
        registerPlugin(MediaCachePlugin.class);
        super.onCreate(savedInstanceState);
        hideSystemBars();
        configureWebViewForMedia();

        // Надёжное отслеживание foreground всего процесса.
        ProcessLifecycleOwner.get().getLifecycle().addObserver(new DefaultLifecycleObserver() {
            @Override public void onStart(LifecycleOwner owner) { NotifierPlugin.APP_IN_FOREGROUND = true; }
            @Override public void onStop(LifecycleOwner owner)  { NotifierPlugin.APP_IN_FOREGROUND = false; }
        });
    }

    /**
     * Чинит загрузку картинок/видео с remanga.org после включения DDoS-Guard.
     *
     * Страница приложения открыта с https://localhost, а медиа грузится с
     * remanga.org — то есть для этих запросов куки remanga.org являются
     * СТОРОННИМИ (third-party) и WebView по умолчанию их не отправляет.
     * DDoS-Guard же теперь требует куку __ddg1_, без неё отдаёт челлендж
     * вместо картинки. Разрешаем сторонние куки и выставляем тот же
     * десктопный User-Agent, что и у нативных запросов, чтобы отпечаток
     * совпадал с тем, которому DDoS-Guard выдал __ddg1_.
     */
    private void configureWebViewForMedia() {
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;

            CookieManager cm = CookieManager.getInstance();
            cm.setAcceptCookie(true);
            cm.setAcceptThirdPartyCookies(webView, true);

            WebSettings settings = webView.getSettings();
            settings.setUserAgentString(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                + "AppleWebKit/537.36 (KHTML, like Gecko) "
                + "Chrome/149.0.0.0 Safari/537.36"
            );

            cm.flush();

            // Файловый кэш медиа: инициализируем и вешаем перехватчик запросов.
            MediaCache.init(getApplicationContext());
            getBridge().setWebViewClient(new CachingWebViewClient(getBridge()));
        } catch (Exception ignored) {
            // если что-то пойдёт не так — просто не трогаем WebView
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        final View decor = getWindow().getDecorView();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            final WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }

        // Рисуем под вырезом/панелями на всю площадь экрана
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }
}
