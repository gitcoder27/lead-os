import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installPreloadErrorReload, isChunkLoadError, reloadOnceForChunkError } from '@/lib/chunk-reload';

describe('chunk reload', () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    window.sessionStorage.clear();
    vi.stubGlobal('location', { reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('recognises dynamic-import failures across browsers', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('reloads once on vite:preloadError and prevents the default throw', () => {
    const dispose = installPreloadErrorReload();
    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(first.defaultPrevented).toBe(true);

    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
    dispose();
  });

  it('allows another reload after the loop-guard window has passed', () => {
    const start = 1_000_000;
    expect(reloadOnceForChunkError(start)).toBe(true);
    expect(reloadOnceForChunkError(start + 5_000)).toBe(false);
    expect(reloadOnceForChunkError(start + 31_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when sessionStorage is unavailable (no loop possible)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(reloadOnceForChunkError()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('stops listening after dispose', () => {
    installPreloadErrorReload()();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(reload).not.toHaveBeenCalled();
  });
});
