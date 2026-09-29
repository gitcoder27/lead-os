import type { CaptureDefaults } from 'shared/capture-grammar';
import type { ManagerDeskCreateItemPayload } from '@/types';

/**
 * docs/57 §3 (P3-05): the Desk-style create payload (the desk capture dialog,
 * the Follow-ups / Meetings composer) as `POST /api/capture` input. The title
 * is the capture text, so tokens in it work; everything else is structured
 * `defaults`, which only fill what the title leaves open.
 */
export function deskPayloadToCapture(payload: ManagerDeskCreateItemPayload): { text: string; defaults: CaptureDefaults } {
  const defaults: CaptureDefaults = {};
  // A backlog item is parked; anything else is planned for the payload's day.
  if (payload.status === 'backlog') defaults.later = true;
  else defaults.scheduledOn = payload.date;
  if (payload.assigneeDeveloperAccountId) defaults.ownerAccountId = payload.assigneeDeveloperAccountId;
  if (payload.kind === 'meeting') defaults.kind = 'meeting';
  const labels: string[] = [];
  if (payload.category && payload.category !== 'other') labels.push(`category:${payload.category}`);
  if (payload.kind === 'decision' || payload.kind === 'waiting') labels.push(`kind:${payload.kind}`);
  if (labels.length) defaults.labels = labels;
  if (payload.priority === 'high' || payload.priority === 'critical') defaults.priority = 'high';
  if (payload.status === 'in_progress') defaults.status = 'active';
  else if (payload.status === 'waiting') defaults.status = 'blocked';
  if (payload.participants) defaults.participants = payload.participants;
  if (payload.nextAction) defaults.nextAction = payload.nextAction;
  if (payload.contextNote?.trim()) defaults.contextNote = payload.contextNote.trim();
  if (payload.plannedStartAt) defaults.startsAt = payload.plannedStartAt;
  if (payload.plannedEndAt) defaults.endsAt = payload.plannedEndAt;
  if (payload.followUpAt) defaults.followUpAt = payload.followUpAt;
  const jiraKeys = (payload.links ?? []).flatMap((link) => (link.linkType === 'issue' && link.issueKey ? [link.issueKey] : []));
  const developerAccountIds = (payload.links ?? []).flatMap((link) => (link.linkType === 'developer' && link.developerAccountId ? [link.developerAccountId] : []));
  if (jiraKeys.length || developerAccountIds.length) {
    defaults.links = { ...(jiraKeys.length ? { jiraKeys } : {}), ...(developerAccountIds.length ? { developerAccountIds } : {}) };
  }
  return { text: payload.title, defaults };
}
