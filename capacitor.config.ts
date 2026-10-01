import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.reapp.redecks',
  appName: 'ReDecks',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Для разработки можно раскомментировать:
    // url: 'http://192.168.x.x:5173',
    // cleartext: true,
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    Preferences: {
      group: 'ReDecks',
    },
    StatusBar: {
      overlaysWebView: true,
      style: 'DARK',
  },
  },
  cordova: {
    preferences: {
      // UA встроенного браузера (InAppBrowser) — «чистый» мобильный Chrome без маркера `wv`.
      // Иначе вход «Войти через Google» падает с 403 disallowed_useragent, т.к. Google
      // запрещает OAuth во встроенных WebView и детектит их по `; wv` в user-agent.
      // Мобильный UA — чтобы страница логина remanga открывалась в мобильной вёрстке.
      OverrideUserAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36',
    },
  },
};

export default config;
