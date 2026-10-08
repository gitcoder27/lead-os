import type { CapturePersonCandidate } from 'shared/capture-grammar';

/**
 * The fictional team the public landing page shows. Nothing here comes from a
 * workspace: the landing page never calls a workspace API.
 */
export const DEMO_PEOPLE: readonly CapturePersonCandidate[] = [
  { accountId: 'priya', displayName: 'Priya Nair', kind: 'developer' },
  { accountId: 'marcus', displayName: 'Marcus Webb', kind: 'developer' },
  { accountId: 'lena', displayName: 'Lena Okafor', kind: 'developer' },
  { accountId: 'tom', displayName: 'Tom Becker', kind: 'developer' },
  { accountId: 'aiko', displayName: 'Aiko Tanaka', kind: 'developer' },
  { accountId: 'dana', displayName: 'Dana Silva', kind: 'contact' },
];

export const DEMO_NAMES = new Map(DEMO_PEOPLE.map((person) => [person.accountId, person.displayName]));

export function firstName(accountId: string): string {
  return (DEMO_NAMES.get(accountId) ?? accountId).split(' ')[0]!;
}

export interface CaptureExample {
  label: string;
  text: string;
}

/** The hero's "Try" chips — one per thing a lead captures all day. */
export const CAPTURE_EXAMPLES: readonly CaptureExample[] = [
  { label: 'Wait on someone', text: 'Ask @priya for the RCA draft /w !fri' },
  { label: 'Delegate', text: '@marcus fix the login timeout #PAY-412 !due:mon' },
  { label: 'Plan tomorrow', text: 'Review the rollout checklist !tomorrow !!' },
  { label: 'Meeting', text: 'Release go/no-go /m !thu +release' },
  { label: 'Private note', text: '/note Lena wants to own the on-call rota' },
];

/** The first example plays once on load; the rest are a click away. */
export const INTRO_EXAMPLE = CAPTURE_EXAMPLES[0]!;
