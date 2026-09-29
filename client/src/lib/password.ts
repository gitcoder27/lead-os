/**
 * Minimum length for a new password. Mirrors `PASSWORD_MIN_LENGTH` in
 * server/src/services/auth.service.ts (docs/56 P2-01: raised from 6); the
 * server is the authority and this only gives an early hint.
 */
export const MIN_PASSWORD_LENGTH = 8;
