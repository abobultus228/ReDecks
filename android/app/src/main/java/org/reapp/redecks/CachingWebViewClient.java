package org.reapp.redecks;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/**
 * Перехватывает загрузку медиа remanga.org и отдаёт из файлового кэша.
 * Всё остальное (локальный сервер приложения, прочие запросы) уходит
 * в стандартный BridgeWebViewClient через super.
 */
public class CachingWebViewClient extends BridgeWebViewClient {

    public CachingWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse cached = MediaCache.tryServe(request);
        if (cached != null) return cached;
        return super.shouldInterceptRequest(view, request);
    }
}
