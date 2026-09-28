import { isIP } from "node:net";

/** What Express accepts for `app.set("trust proxy", …)` that we are willing to configure. */
export type TrustProxySetting = false | number | string;

const KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);
const MAX_HOPS = 10;

function isAddressOrCidr(entry: string): boolean {
  const [address, prefix, ...rest] = entry.split("/");
  if (rest.length > 0 || !address) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Parses the `TRUST_PROXY` env value. Unset, empty, `false` or `0` mean "off"
 * (Express default: `req.ip` is the socket address, `X-Forwarded-For` is ignored).
 *
 * Accepted: a hop count (`1`..`10`), `loopback` / `linklocal` / `uniquelocal`,
 * or a comma-separated list of IPs / CIDRs of the proxies to trust.
 *
 * `true` and anything else that would trust every hop is rejected on purpose:
 * it lets any client choose its own `req.ip` by sending `X-Forwarded-For`,
 * which defeats the login throttle. An invalid value throws at startup rather
 * than silently falling back, so a typo can't hide the misconfiguration.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim();
  if (!value || value.toLowerCase() === "false" || value === "0") return false;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops > MAX_HOPS) {
      throw new Error(`TRUST_PROXY hop count must be between 1 and ${MAX_HOPS}, got "${value}"`);
    }
    return hops;
  }

  const entries = value.split(",").map((entry) => entry.trim().toLowerCase());
  if (entries.every((entry) => KEYWORDS.has(entry) || isAddressOrCidr(entry))) {
    return entries.join(",");
  }

  throw new Error(
    `Invalid TRUST_PROXY "${value}". Use a hop count (1-${MAX_HOPS}), loopback, linklocal, uniquelocal, ` +
      "or a comma-separated list of proxy IPs/CIDRs. Blanket `true` is not allowed because clients could spoof X-Forwarded-For."
  );
}
