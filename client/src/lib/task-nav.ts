export function navigateToTaskPage(taskKey: string, replace = false) {
  const target = `/t/${encodeURIComponent(taskKey)}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
