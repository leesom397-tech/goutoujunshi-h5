"use client";
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { REPORT_NAVIGATION_EVENT, navigateReportSession, reportSessionDestination } from '@/lib/report-session-navigation';

/** Keep report round trips inside this document, preserving session memory. */
export function ReportSessionNavigation() {
  const router = useRouter();
  useEffect(() => {
    const navigate = (event: Event) => {
      const destination = (event as CustomEvent).detail;
      if (typeof destination !== 'string' || !reportSessionDestination(destination, location.href)) return;
      event.preventDefault(); router.push(destination, { scroll: !destination.startsWith('/report?') });
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return;
      const destination = reportSessionDestination(anchor.href, location.href);
      if (!destination) return;
      event.preventDefault(); navigateReportSession(destination);
    };
    window.addEventListener(REPORT_NAVIGATION_EVENT, navigate);
    document.addEventListener('click', click);
    return () => { window.removeEventListener(REPORT_NAVIGATION_EVENT, navigate); document.removeEventListener('click', click); };
  }, [router]);
  return null;
}
