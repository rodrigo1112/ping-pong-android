import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arcade.pingpong',
  appName: 'Ping Pong',
  webDir: 'www',
  loggingBehavior: 'none',
  android: {
    backgroundColor: '#0b0f19',
    webContentsDebuggingEnabled: false,
    loggingBehavior: 'none',
    zoomEnabled: false,
  },
};

export default config;
