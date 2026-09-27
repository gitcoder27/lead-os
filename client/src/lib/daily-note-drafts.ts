import type { DailyNoteKind } from '@/types';
import { isValidIsoDate } from './view-params';

const DRAFT_PREFIX = 'lead-os:daily-note-draft:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAPTURE_KEY = 'quick-capture';
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS_PER_SCOPE = 50;

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

function draftKey(scope: string, date: string, kind: DailyNoteKind = 'scratchpad'): string {
  // Scratchpad keeps the bare-date key so pre-kind drafts still resolve.
  return `${scopePrefix(scope)}${kind === 'scratchpad' ? date : `${date}#${kind}`}`;
}

function captureDraftKey(scope: string): string {
  return `${scopePrefix(scope)}${CAPTURE_KEY}`;
}

function store(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function legacyStore(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isDailyNoteDraftFields(value: unknown): value is DailyNoteDraft {
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

function isDailyNoteCaptureDraftFields(value: unknown): value is DailyNoteCaptureDraft {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const draft = value as DailyNoteCaptureDraft;
  return (
    typeof draft.date === 'string' &&
    isValidIsoDate(draft.date) &&
    typeof draft.text === 'string' &&
    typeof draft.requestId === 'string' &&
    UUID_PATTERN.test(draft.requestId)
  );
}

function isFresh(value: object, now = Date.now()): boolean {
  const savedAt = (value as { savedAt?: unknown }).savedAt;
  return typeof savedAt === 'number' && Number.isFinite(savedAt) && now - savedAt <= DRAFT_TTL_MS;
}

function writeStored(key: string, value: object): boolean {
  const storage = store();
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function removeStored(key: string): void {
  for (const storage of [store(), legacyStore()]) {
    try {
      storage?.removeItem(key);
    } catch {
      // ignore
    }
  }
}

// Drafts lived in sessionStorage before the localStorage switch; promote any
// same-tab remnant so a reload mid-upgrade doesn't lose text.
function readLegacy<T extends object>(key: string, valid: (value: unknown) => value is T): T | null {
  const session = legacyStore();
  if (!session) {
    return null;
  }
  try {
    const raw = session.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    session.removeItem(key);
    if (!valid(parsed)) {
      return null;
    }
    writeStored(key, parsed);
    return parsed;
  } catch {
    try {
      session.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
}

function readStored<T extends object>(key: string, valid: (value: unknown) => value is T): T | null {
  const storage = store();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return readLegacy<T>(key, valid);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed) || !isFresh(parsed)) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      return null;
    }
    return null;
  }
}

// Evict expired/malformed drafts, then oldest-first beyond the per-scope cap.
function enforceDraftCap(scope: string): void {
  const storage = store();
  if (!storage) {
    return;
  }
  const prefix = scopePrefix(scope);
  const captureKey = `${prefix}${CAPTURE_KEY}`;
  const entries: Array<{ key: string; savedAt: number }> = [];
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix) || key === captureKey) {
        continue;
      }
      let savedAt = -1;
      try {
        const raw = storage.getItem(key);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isDailyNoteDraftFields(parsed) && isFresh(parsed)) {
          savedAt = (parsed as unknown as { savedAt: number }).savedAt;
        }
      } catch {
        // malformed entries fall through to removal
      }
      if (savedAt < 0) {
        storage.removeItem(key);
      } else {
        entries.push({ key, savedAt });
      }
    }
  } catch {
    return;
  }
  entries.sort((a, b) => a.savedAt - b.savedAt);
  while (entries.length > MAX_DRAFTS_PER_SCOPE) {
    const oldest = entries.shift();
    if (!oldest) {
      break;
    }
    try {
      storage.removeItem(oldest.key);
    } catch {
      return;
    }
  }
}

export function readDailyNoteDraft(scope: string, date: string, kind: DailyNoteKind = 'scratchpad'): DailyNoteDraft | null {
  if (!scope || !date) {
    return null;
  }
  const draft = readStored(draftKey(scope, date, kind), isDailyNoteDraftFields);
  return draft ? { body: draft.body, baseBody: draft.baseBody, revision: draft.revision } : null;
}

export function writeDailyNoteDraft(scope: string, date: string, draft: DailyNoteDraft, kind: DailyNoteKind = 'scratchpad'): boolean {
  if (!scope || !date) {
    return false;
  }
  const ok = writeStored(draftKey(scope, date, kind), draft);
  if (ok) {
    enforceDraftCap(scope);
  }
  return ok;
}

export function clearDailyNoteDraft(scope: string, date: string, kind: DailyNoteKind = 'scratchpad'): void {
  removeStored(draftKey(scope, date, kind));
}

export function readDailyNoteCaptureDraft(scope: string): DailyNoteCaptureDraft | null {
  if (!scope) {
    return null;
  }
  const draft = readStored(captureDraftKey(scope), isDailyNoteCaptureDraftFields);
  return draft ? { date: draft.date, text: draft.text, requestId: draft.requestId } : null;
}

export function writeDailyNoteCaptureDraft(scope: string, draft: DailyNoteCaptureDraft): boolean {
  if (!scope) {
    return false;
  }
  return writeStored(captureDraftKey(scope), draft);
}

export function clearDailyNoteCaptureDraft(scope: string): void {
  removeStored(captureDraftKey(scope));
}

export function clearDailyNoteDraftsForScope(scope: string): void {
  if (!scope) {
    return;
  }
  const prefix = scopePrefix(scope);
  for (const storage of [store(), legacyStore()]) {
    if (!storage) {
      continue;
    }
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
          storage.removeItem(key);
        }
      }
    } catch {
      return;
    }
  }
}
