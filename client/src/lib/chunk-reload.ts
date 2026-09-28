const RELOAD_FLAG = 'leados:chunk-reload-at';
/** A second chunk failure inside this window is a real fault, not a stale deploy. */
const RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  return CHUNK_ERROR_PATTERN.test(message);
}

/**
 * Reloads the page at most once per RELOAD_WINDOW_MS so a stale tab picks up the
 * new build after a deploy. Returns false when it declined to reload (loop guard),
 * including when sessionStorage is unavailable, so callers can fall through to the
 * recovery screen instead of looping.
 */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_FLAG));
    if (last && now - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(RELOAD_FLAG, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Vite fires `vite:preloadError` when a dynamic import or its CSS/preload fails to load. */
export function installPreloadErrorReload(): () => void {
  const handler = (event: Event) => {
    if (reloadOnceForChunkError()) event.preventDefault();
  };
  window.addEventListener('vite:preloadError', handler);
  return () => window.removeEventListener('vite:preloadError', handler);
}
