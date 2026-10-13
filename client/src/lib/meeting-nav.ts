/** Keep the originating history entry and its own scroll containers intact. */
export function navigateToMeeting(key: string) {
  const scrollers = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((el) => el.scrollTop > 0);
  window.history.replaceState({ ...window.history.state, meetingReturnScroll: scrollers.map((el) => ({ id: el.id, className: el.className, top: el.scrollTop })) }, '');
  window.history.pushState({ meetingOrigin: window.location.pathname + window.location.search }, '', `/t/${encodeURIComponent(key)}?mode=meeting`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
export function backFromMeeting() {
  if (typeof window.history.state?.meetingOrigin === 'string') window.history.back();
  else { window.history.replaceState(null, '', '/tasks?view=meetings'); window.dispatchEvent(new PopStateEvent('popstate')); }
}
