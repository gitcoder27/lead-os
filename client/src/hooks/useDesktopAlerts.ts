import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useScopedStorageKey } from '@/lib/scoped-storage';
import {
  DESKTOP_ALERTS_EVENT,
  desktopAlertGeneration,
  readAlertPermission,
  readStored,
  requestAlertPermission,
  writeStored,
  type AlertPermission,
} from '@/lib/desktop-alerts';

const subscribe = (onChange: () => void) => {
  // Permission is changed in browser settings, outside the app; re-read whenever the tab comes back.
  window.addEventListener(DESKTOP_ALERTS_EVENT, onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener(DESKTOP_ALERTS_EVENT, onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
};

/**
 * Desktop (browser) alerts: the browser's permission is the gate, this person's choice is the switch.
 * The choice is remembered per person on this browser, so a shared computer never alerts the wrong one.
 */
export function useDesktopAlerts() {
  const choiceKey = useScopedStorageKey('desktop-alerts');
  const promptKey = useScopedStorageKey('desktop-alerts-prompt');
  const currentKey = useRef(choiceKey);
  currentKey.current = choiceKey;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => `${readAlertPermission()}|${readStored(choiceKey) ?? ''}|${readStored(promptKey) ?? ''}`,
    () => 'unsupported||',
  );
  const [permission, choice, prompt] = snapshot.split('|') as [AlertPermission, string, string];

  const enable = useCallback(async (): Promise<AlertPermission> => {
    const generation = desktopAlertGeneration();
    const result = readAlertPermission() === 'default' ? await requestAlertPermission() : readAlertPermission();
    if (!mounted.current || currentKey.current !== choiceKey || generation !== desktopAlertGeneration()) return 'unsupported';
    // Asking is a decision either way: a refusal should not bring the prompt back on the next visit.
    writeStored(choiceKey, result === 'granted' ? 'on' : 'off');
    writeStored(promptKey, 'seen');
    return result;
  }, [choiceKey, promptKey]);
  const disable = useCallback(() => writeStored(choiceKey, 'off'), [choiceKey]);
  const dismissPrompt = useCallback(() => writeStored(promptKey, 'seen'), [promptKey]);

  return useMemo(() => ({
    supported: permission !== 'unsupported',
    permission,
    enabled: permission === 'granted' && choice === 'on',
    /** Nothing asked yet: safe to offer once. */
    canOffer: permission === 'default' && !prompt,
    enable,
    disable,
    dismissPrompt,
  }), [permission, choice, prompt, enable, disable, dismissPrompt]);
}
