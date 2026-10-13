import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateToMeeting, backFromMeeting, restoreMeetingScroll } from '@/lib/meeting-nav';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
describe('meeting return navigation', () => {
  it('keeps the source filters and scroll in its history entry', () => {
    window.history.replaceState(null, '', '/tasks?view=meetings&priority=high');
    const panel = document.createElement('main'); panel.id = 'task-list'; panel.scrollTop = 250; document.body.append(panel);
    const replace = vi.spyOn(window.history, 'replaceState');
    navigateToMeeting('T-42');
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ meetingReturnScroll: [{ id: 'task-list', className: '', top: 250 }] }), '');
    expect(window.location.pathname + window.location.search).toBe('/t/T-42?mode=meeting');
    expect(window.history.state.meetingOrigin).toBe('/tasks?view=meetings&priority=high');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    backFromMeeting(); expect(back).toHaveBeenCalled();
  });
  it('returns a direct link to Tasks Meetings and restores the saved scroll after popstate', () => {
    window.history.replaceState(null, '', '/t/T-1?mode=meeting');
    backFromMeeting(); expect(window.location.pathname + window.location.search).toBe('/tasks?view=meetings');
    const panel = document.createElement('main'); panel.id = 'list'; document.body.append(panel);
    window.history.replaceState({ meetingReturnScroll: [{ id: 'list', className: '', top: 120 }] }, '');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    restoreMeetingScroll(); expect(panel.scrollTop).toBe(120);
  });
});
