import { sanitizeNavPreferences, type NavPreferences, type NavSanitizeOptions } from '@/types';

const KEY_PREFIX = 'lead-os:nav-preferences:';

function cacheKey(scope: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(scope)}`;
}

/**
 * Last-known server preference per auth scope, kept in localStorage so the
 * header can render the customized layout before the preferences query lands.
 * The server remains the source of truth; this only prevents a layout flash.
 */
export function readNavPreferencesCache(scope: string, options: NavSanitizeOptions = {}): NavPreferences | null {
  if (typeof window === 'undefined' || !scope) {
    return null;
  }

  const key = cacheKey(scope);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(key);
      return null;
    }
    const candidate = parsed as NavPreferences;
    return sanitizeNavPreferences(candidate.topNav, candidate.moreNav, options);
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeNavPreferencesCache(scope: string, preferences: NavPreferences): boolean {
  if (typeof window === 'undefined' || !scope) {
    return false;
  }
  try {
    window.localStorage.setItem(cacheKey(scope), JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearNavPreferencesCacheForScope(scope: string): void {
  if (typeof window === 'undefined' || !scope) {
    return;
  }
  try {
    window.localStorage.removeItem(cacheKey(scope));
  } catch {
    return;
  }
}
