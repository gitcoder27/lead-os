/**
 * Where "Request access" on the public landing page goes. Read once at build
 * time from `VITE_LEADOS_ACCESS_URL`; only https: and mailto: URLs are used,
 * so a typo can never become a script link. Null hides the button.
 */
export function resolveAccessRequestUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? value : null;
  } catch {
    return null;
  }
}

export const ACCESS_REQUEST_URL = resolveAccessRequestUrl(import.meta.env.VITE_LEADOS_ACCESS_URL);
