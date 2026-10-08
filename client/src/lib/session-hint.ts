/**
 * A non-secret hint that this browser had a session last time, so the boot
 * screen can show the Today skeleton to returning managers and a blank canvas
 * to first-time visitors (who are about to see the landing page). The cookie
 * stays the only source of truth; a wrong hint only changes the loader.
 */
const KEY = 'lead-os:signed-in';

export function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSessionHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the hint is optional.
  }
}
