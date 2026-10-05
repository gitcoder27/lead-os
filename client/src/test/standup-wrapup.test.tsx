import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StandupWrapUp } from '@/components/team-tracker/standup/StandupWrapUp';
import { buildTeamRecap, buildFollowThrough, publicDay } from '@/lib/standup-wrapup';
import { loadStandupSession, saveStandupSession, type StandupSession } from '@/lib/standup';
import type { ManagerSurfaceTask, TrackerDeveloperDay } from '@/types';

const work = (taskKey: string, title: string, status = 'open', ownerType = 'developer') => ({ taskKey, title, status, ownerType, ownerId: 'a', position: 0 } as ManagerSurfaceTask);
const person = (id: string, name: string, tasks: ManagerSurfaceTask[] = [], status = 'on_track') => ({
  developer: { accountId: id, displayName: name }, availability: { state: 'active' }, tasks, status,
  plannedItems: [], completedItems: [], droppedItems: [], checkIns: [], recentCheckIns: [],
} as unknown as TrackerDeveloperDay);
const days = [person('a', 'Alice', [work('T-1', 'Build API', 'active'), work('T-2', 'Release'), work('T-3', 'Await access', 'blocked')]), person('b', 'Bob', [], 'waiting')];
const session: StandupSession = {
  roundId: 'round', reviewed: ['a'], acknowledged: ['a'], flagged: ['a'], flagReasons: { a: 'Private staffing concern' },
  followUpPlans: { a: { title: 'Get API credentials', followUpAt: '2026-10-06T09:00:00Z' } },
  log: [
    { accountId: 'a', taskKey: 'T-8', taskTitle: 'Old task retained', kind: 'done', at: '2026-10-05T09:00:00Z' },
    { accountId: 'a', taskKey: 'T-1', kind: 'update', private: true, at: '2026-10-05T09:00:00Z' },
    { accountId: 'a', kind: 'checkin', detail: 'Private note body', at: '2026-10-05T09:00:00Z' },
  ], noteDrafts: { a: { text: 'Unsent draft secret', requestId: 'draft', visibility: 'private' } },
};
function setup(s: StandupSession = { ...session, noteDrafts: {} }) {
  const props = { days, session: s, taskDrafts: [], onRecoverTask: vi.fn(), onRecoverNote: vi.fn(), onJump: vi.fn(), onBack: vi.fn(), onEnd: vi.fn(), onCopy: vi.fn(), onCopyTeam: vi.fn(), onCopyActions: vi.fn(), onToggleFollowUp: vi.fn(), onPlanChange: vi.fn(), onOpenTask: vi.fn() };
  render(<StandupWrapUp {...props} />);
  return props;
}

describe('useful standup wrap-up', () => {
  it('shows current, next, blocked and acknowledged actions with titles even after removal', () => {
    const props = setup();
    const recap = screen.getByRole('region', { name: 'Team recap' });
    expect(within(recap).getByText('Build API')).toBeInTheDocument();
    expect(within(recap).getByText('Release')).toBeInTheDocument();
    expect(within(recap).getByText('Await access')).toBeInTheDocument();
    expect(within(recap).getByText('Closed T-8 · Old task retained')).toBeInTheDocument();
    expect(within(recap).getByText('Work shown from the board; review still needed.')).toBeInTheDocument();
    fireEvent.click(within(recap).getByRole('button', { name: /T-1 Build API/ }));
    expect(props.onOpenTask).toHaveBeenCalledWith('T-1');
    fireEvent.click(screen.getByRole('button', { name: 'Copy team recap' }));
    expect(props.onCopyTeam).toHaveBeenCalledOnce();
  });
  it('offers unselected concerns and editable owner/title/check-by actions', () => {
    const props = setup();
    expect(screen.getByLabelText('Next action for Alice')).toHaveValue('Get API credentials');
    fireEvent.change(screen.getByLabelText('Next action for Alice'), { target: { value: 'Ask support for credentials' } });
    expect(props.onPlanChange).toHaveBeenCalledWith('a', expect.objectContaining({ title: 'Ask support for credentials' }));
    fireEvent.change(screen.getByLabelText('Check by for Alice'), { target: { value: '2026-10-08' } });
    expect(props.onPlanChange).toHaveBeenLastCalledWith('a', { title: 'Get API credentials', followUpAt: new Date('2026-10-08T09:00:00').toISOString() });
    fireEvent.click(screen.getByRole('checkbox', { name: /Bob Waiting/ }));
    expect(props.onToggleFollowUp).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: 'Remove follow-up for Alice' }));
    expect(props.onToggleFollowUp).toHaveBeenLastCalledWith('a');
  });
  it('requires a nonempty action before finishing and retains draft recovery', () => {
    const props = setup({ ...session, followUpPlans: { a: { title: ' ' } } });
    expect(screen.getByRole('button', { name: 'Finish standup' })).toBeDisabled();
    fireEvent.click(within(screen.getByLabelText('Unsent person notes')).getByRole('button', { name: 'Alice' }));
    expect(props.onRecoverNote).toHaveBeenCalledWith('a');
  });
  it('locks actions on retry so a sealed request cannot be edited', () => {
    setup({ ...session, noteDrafts: {}, request: { requestId: 'round' } as never });
    expect(screen.getByLabelText('Next action for Alice')).toBeDisabled();
    expect(screen.getByLabelText('Check by for Alice')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove follow-up for Alice' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry finish' })).toBeEnabled();
  });
  it('keeps team copy free of private flags, notes, drafts and manager-owned work', () => {
    const self = person('a', 'Alice', [work('T-PRIVATE', 'Secret hiring plan', 'active', 'manager'), work('T-2', 'Release')]);
    self.developer.isSelf = true;
    const text = buildTeamRecap('2026-10-05', [self, days[1]!], { ...session, log: [...session.log, { accountId: 'a', taskKey: 'T-PRIVATE', kind: 'current', at: 'now' }] });
    expect(text).toContain('Next: T-2 · Release');
    expect(text).toContain('Closed T-8 · Old task retained');
    expect(text).toContain('Bob · Waiting · Not visited');
    for (const secret of ['Private staffing', 'Secret hiring', 'T-PRIVATE', 'Private note', 'Unsent draft', 'Logged update']) expect(text).not.toContain(secret);
    expect(buildFollowThrough([self], session)).toContain('Get API credentials · Owner: You');
    expect(buildFollowThrough([self], session)).toContain('Private staffing concern');
    expect(publicDay({ ...self, tasks: undefined, currentItem: { title: 'Private legacy work' } as never }).currentItem).toBeUndefined();
  });
  it('restores action edits across reopening but ignores malformed local plans', () => {
    saveStandupSession('wrapup-test', session);
    expect(loadStandupSession('wrapup-test').followUpPlans).toEqual(session.followUpPlans);
    window.sessionStorage.setItem('wrapup-test', JSON.stringify({ ...session, followUpPlans: { a: { title: 7 }, b: { title: 'Valid', followUpAt: 'bad' } } }));
    expect(loadStandupSession('wrapup-test').followUpPlans).toEqual({ b: { title: 'Valid' } });
    window.sessionStorage.removeItem('wrapup-test');
  });
  it('makes an empty round understandable without inventing actions', () => {
    setup({ reviewed: [], flagged: [], log: [] });
    expect(screen.getByText('No follow-ups selected')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Worth a follow-up 2' })).toBeInTheDocument();
  });
});
