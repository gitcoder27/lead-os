import { useInboxAlerts } from '@/hooks/useInboxAlerts';

/** Mounted once for the signed-in app: toasts, desktop notifications and the tab title all follow the inbox. */
export function InboxAlerts() {
  useInboxAlerts();
  return null;
}
