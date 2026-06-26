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
};

export default config;
