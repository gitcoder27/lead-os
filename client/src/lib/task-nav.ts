export function navigateToTaskPage(taskKey: string, replace = false, eventId?: number) {
  const target = `/t/${encodeURIComponent(taskKey)}${eventId && Number.isSafeInteger(eventId) && eventId > 0 ? `?event=${eventId}` : ''}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
