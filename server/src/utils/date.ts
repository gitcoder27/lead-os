function formatIsoDate(date: Date, timeZone?: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to format ISO date");
  }

  return `${year}-${month}-${day}`;
}

export function todayIsoDate(now = new Date(), timeZone?: string): string {
  return formatIsoDate(now, timeZone);
}

export function isoDatePart(value: string | null | undefined, timeZone?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return formatIsoDate(date, timeZone);
}

function shiftIsoDate(dateStr: string, days: number): string {
  const shifted = addDays(new Date(`${dateStr}T00:00:00.000Z`), days);
  return formatIsoDate(shifted, "UTC");
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function endOfWeekIsoDate(now = new Date(), timeZone?: string): string {
  const today = todayIsoDate(now, timeZone);
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const add = 7 - day;
  return shiftIsoDate(today, add);
}

export function isOlderThanHours(isoDate: string, hours: number, now = new Date()): boolean {
  const dt = new Date(isoDate);
  return dt.getTime() < now.getTime() - hours * 60 * 60 * 1000;
}
