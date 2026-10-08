/** Temporary errors can retain activity; authoritative loss of access must hide it. */
export const isTaskActivityAccessLoss = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('status' in error)) return false;
  return [401, 403, 404, 410].includes(Number(error.status));
};
