// The small amount of code that only matters inside the native apps.
//
// It reads Capacitor off the global object rather than importing it, so www/
// stays plain ES modules with no build step. In a browser none of this runs.

export function setUpNative (hooks) {
  const cap = globalThis.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return false;
  const plugins = cap.Plugins || {};

  // Draw under the status bar so the table fills the screen; the CSS safe-area
  // padding keeps the rails clear of it.
  if (plugins.StatusBar) {
    plugins.StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    plugins.StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  }
  if (plugins.SplashScreen) {
    plugins.SplashScreen.hide().catch(() => {});
  }

  // Android's back button should close whatever is open, not drop out of the
  // game. Only when nothing is open does it leave.
  if (plugins.App) {
    plugins.App.addListener('backButton', () => {
      if (hooks && hooks.onBack && hooks.onBack()) return;
      plugins.App.exitApp();
    });
    // Pause the bots when the app goes to the background.
    plugins.App.addListener('appStateChange', state => {
      if (hooks && hooks.onAppState) hooks.onAppState(state.isActive);
    });
  }

  return true;
}

export function tap (style) {
  const cap = globalThis.Capacitor;
  const haptics = cap && cap.Plugins && cap.Plugins.Haptics;
  if (!haptics) return;
  haptics.impact({ style: style || 'Light' }).catch(() => {});
}
