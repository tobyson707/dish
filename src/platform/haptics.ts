// Haptics adapter: web vibration where supported; Capacitor Haptics later.
export function tap(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate(ms)
  } catch {
    /* unsupported */
  }
}
