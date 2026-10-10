import type { RequestHandler } from "express";
import { HttpError } from "./errorHandler";
/** Process-local fixed windows. Proxy trust is configured centrally by createApp. */
export function authIpLimit(limit: number, windowMs = 15 * 60000): RequestHandler {
  const windows = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    let entry = windows.get(ip);
    if (!entry || entry.until <= now) {
      for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
      if (windows.size >= 10000) windows.delete(windows.keys().next().value!);
      entry = { count: 0, until: now + windowMs }; windows.set(ip, entry);
    }
    if (++entry.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((entry.until - now) / 1000)));
      next(new HttpError(429, "Too many attempts. Try again in a few minutes.")); return;
    }
    next();
  };
}
