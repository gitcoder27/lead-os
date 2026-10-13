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

/** Re-mounted cached views restore filters through popstate; restore the same scroll surfaces. */
export function restoreMeetingScroll() {
  const positions = window.history.state?.meetingReturnScroll as Array<{ id: string; className: string; top: number }> | undefined;
  if (!Array.isArray(positions)) return;
  const path = window.location.pathname + window.location.search;
  let attempts = 0;
  const restore = () => {
    if (window.location.pathname + window.location.search !== path) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>('*'));
    const complete = positions.every((position) => {
      const element = position.id ? document.getElementById(position.id) : elements.find((el) => el.className === position.className && el.scrollHeight > el.clientHeight);
      if (!element) return false;
      element.scrollTop = position.top;
      return Math.abs(element.scrollTop - position.top) < 2;
    });
    if (!complete && ++attempts < 60) requestAnimationFrame(restore);
  };
  requestAnimationFrame(restore);
}
