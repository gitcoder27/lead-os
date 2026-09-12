import { isValidIsoDate } from './view-params';

const DRAFT_PREFIX = 'lead-os:daily-note-draft:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTURE_KEY = 'quick-capture';

export interface DailyNoteDraft {
  body: string;
  baseBody: string;
  revision: number;
}

export interface DailyNoteCaptureDraft {
  date: string;
  text: string;
  requestId: string;
}

function scopePrefix(scope: string): string {
  return `${DRAFT_PREFIX}${encodeURIComponent(scope)}:`;
}

function draftKey(scope: string, date: string): string {
  return `${scopePrefix(scope)}${date}`;
}

function captureDraftKey(scope: string): string {
  return `${scopePrefix(scope)}${CAPTURE_KEY}`;
}

function isDailyNoteDraft(value: unknown): value is DailyNoteDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const draft = value as DailyNoteDraft;
  return (
    typeof draft.body === 'string' &&
    typeof draft.baseBody === 'string' &&
    Number.isInteger(draft.revision) &&
    draft.revision >= 0
  );
}

export function readDailyNoteDraft(scope: string, date: string): DailyNoteDraft | null {
  if (typeof window === 'undefined' || !scope || !date) {
    return null;
  }

  const key = draftKey(scope, date);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isDailyNoteDraft(parsed)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeDailyNoteDraft(scope: string, date: string, draft: DailyNoteDraft): boolean {
  if (typeof window === 'undefined' || !scope || !date) {
    return false;
  }

  try {
    window.sessionStorage.setItem(draftKey(scope, date), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDailyNoteDraft(scope: string, date: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(draftKey(scope, date));
  } catch {
    return;
  }
}

export function readDailyNoteCaptureDraft(scope: string): DailyNoteCaptureDraft | null {
  if (typeof window === 'undefined' || !scope) {
    return null;
  }

  const key = captureDraftKey(scope);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as DailyNoteCaptureDraft;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.date !== 'string' ||
      !isValidIsoDate(parsed.date) ||
      typeof parsed.text !== 'string' ||
      typeof parsed.requestId !== 'string' ||
      !UUID_PATTERN.test(parsed.requestId)
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeDailyNoteCaptureDraft(scope: string, draft: DailyNoteCaptureDraft): boolean {
  if (typeof window === 'undefined' || !scope) {
    return false;
  }
  try {
    window.sessionStorage.setItem(captureDraftKey(scope), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDailyNoteCaptureDraft(scope: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.sessionStorage.removeItem(captureDraftKey(scope));
  } catch {
    return;
  }
}

export function clearDailyNoteDraftsForScope(scope: string): void {
  if (typeof window === 'undefined' || !scope) {
    return;
  }

  const prefix = scopePrefix(scope);
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(prefix)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    return;
  }
}
