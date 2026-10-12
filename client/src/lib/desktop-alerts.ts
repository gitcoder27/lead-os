export type AlertPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export const DESKTOP_ALERTS_EVENT = 'leados-desktop-alerts';

export function readAlertPermission(): AlertPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice lasts until the tab closes, which is the best this browser allows.
  }
  window.dispatchEvent(new Event(DESKTOP_ALERTS_EVENT));
}

/** Safari still wants the callback form; everything else returns a promise. */
export function requestAlertPermission(): Promise<AlertPermission> {
  if (readAlertPermission() === 'unsupported') return Promise.resolve('unsupported');
  return new Promise((resolve) => {
    try {
      const result = Notification.requestPermission((permission) => resolve(permission));
      if (result && typeof result.then === 'function') void result.then(resolve, () => resolve(readAlertPermission()));
    } catch {
      resolve(readAlertPermission());
    }
  });
}

export interface DesktopAlert {
  title: string;
  body: string;
  /** Same tag replaces the earlier notification instead of stacking. */
  tag: string;
  onClick: () => void;
}

/** Returns false when the browser refuses (some mobile browsers only allow service-worker notifications). */
export function showDesktopAlert({ title, body, tag, onClick }: DesktopAlert): boolean {
  if (readAlertPermission() !== 'granted') return false;
  try {
    const notification = new Notification(title, { body, tag, icon: '/favicon.svg', lang: document.documentElement.lang || 'en' });
    notification.onclick = () => {
      notification.close();
      try {
        window.focus();
      } catch {
        // A browser that blocks programmatic focus still opens the tab it was clicked from.
      }
      onClick();
    };
    return true;
  } catch {
    return false;
  }
}
