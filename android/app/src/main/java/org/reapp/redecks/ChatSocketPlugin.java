package org.reapp.redecks;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/**
 * Нативный WebSocket для чата с возможностью задать заголовок Origin
 * (браузерный WebSocket в WebView этого не позволяет, и сервер remanga
 * отклоняет соединение с Origin = https://localhost).
 *
 * Поддерживает одно активное соединение за раз — этого достаточно: в чате
 * открыта одна комната.
 */
@CapacitorPlugin(name = "ChatSocket")
public class ChatSocketPlugin extends Plugin {

    private WebSocketClient client;

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url");
        String origin = call.getString("origin", "https://remanga.org");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        closeClient();

        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Origin", origin);

            client = new WebSocketClient(new URI(url), headers) {
                @Override
                public void onOpen(ServerHandshake handshake) {
                    notifyListeners("open", new JSObject());
                }

                @Override
                public void onMessage(String message) {
                    JSObject data = new JSObject();
                    data.put("data", message);
                    notifyListeners("message", data);
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    JSObject data = new JSObject();
                    data.put("code", code);
                    data.put("reason", reason == null ? "" : reason);
                    notifyListeners("close", data);
                }

                @Override
                public void onError(Exception ex) {
                    JSObject data = new JSObject();
                    data.put("message", ex.getMessage() == null ? "websocket error" : ex.getMessage());
                    notifyListeners("error", data);
                }
            };

            client.connect();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String data = call.getString("data");
        try {
            if (client != null && data != null) {
                client.send(data);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        closeClient();
        call.resolve();
    }

    private void closeClient() {
        if (client != null) {
            try { client.close(); } catch (Exception ignored) {}
            client = null;
        }
    }
}
