import { z } from "zod";

/** `YYYY-MM-DD` that names a real day: `2026-02-31` and `2026-13-01` match the shape but are rejected. */
export function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().startsWith(value);
}

export function calendarDate(message = "date must be YYYY-MM-DD") {
  return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine(isRealIsoDate, message.replace("YYYY-MM-DD", "a real calendar date"));
}
