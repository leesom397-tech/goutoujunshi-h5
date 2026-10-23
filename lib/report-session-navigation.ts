const EVENT = 'chengzi:report-navigation';
const paths = new Set(['/report', '/reports', '/archive', '/capture', '/analyze', '/chat', '/relationship', '/library']);

export function reportSessionDestination(href: string, current: string): string | null {
  try {
    const from = new URL(current), to = new URL(href, from);
    if (to.origin !== from.origin || !paths.has(to.pathname) || to.username || to.password) return null;
    if (to.pathname === from.pathname && to.search === from.search) return null;
    const related = (url: URL) => url.pathname === '/report' || /^\/report\?/.test(url.searchParams.get('returnTo') || '') || url.pathname === '/chat' && url.searchParams.has('context');
    return related(from) || related(to) ? to.pathname + to.search + to.hash : null;
  } catch { return null; }
}

/** Navigation bridge also supports callers outside React event handlers. */
export function navigateReportSession(href: string): void {
  const destination = reportSessionDestination(href, location.href);
  if (destination) {
    window.dispatchEvent(new Event('chengzi:report-leaving'));
    const event = new CustomEvent(EVENT, { detail: destination, cancelable: true });
    if (!window.dispatchEvent(event)) return;
  }
  location.assign(href);
}
export const REPORT_NAVIGATION_EVENT = EVENT;
