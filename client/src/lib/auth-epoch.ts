import type { QueryClient } from '@tanstack/react-query';

// A pending callback can outlive its component. Account/session changes revoke its lease.
const epochs = new WeakMap<QueryClient, number>();
export const authEpoch = (client: QueryClient) => epochs.get(client) ?? 0;
export function advanceAuthEpoch(client: QueryClient) {
  epochs.set(client, authEpoch(client) + 1);
}
