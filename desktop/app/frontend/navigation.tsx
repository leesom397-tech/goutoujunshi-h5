import { useMemo, useSyncExternalStore } from "react";

const eventName = "chengzi:desktop-route";
const snapshot = () => location.pathname + location.search + location.hash;
const subscribe = (callback: () => void) => {
  window.addEventListener(eventName, callback);
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener("popstate", callback); window.removeEventListener("hashchange", callback); };
};
export function useDesktopLocation() { return useSyncExternalStore(subscribe, snapshot, () => "/workspace"); }
export function navigate(href: string, replace = false, options: { scroll?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.username || url.password) throw new Error("只能在应用内打开本地页面。");
  history.replaceState({ ...history.state, desktopScroll: [scrollX, scrollY] }, "");
  history[replace ? "replaceState" : "pushState"]({ desktopScroll: [0, 0] }, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(eventName));
  if (options.scroll !== false) requestAnimationFrame(() => url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView() : window.scrollTo(0, 0));
}
const router = {
  push: (href: string, options?: { scroll?: boolean }) => navigate(href, false, options),
  replace: (href: string, options?: { scroll?: boolean }) => navigate(href, true, options),
  back: () => history.back(), forward: () => history.forward(), refresh: () => location.reload(),
  prefetch: async (_href: string) => {},
};
export const useRouter = () => router;
export function usePathname() { return new URL(useDesktopLocation(), location.origin).pathname; }
export function useSearchParams() { const value = useDesktopLocation(); return useMemo(() => new URL(value, location.origin).searchParams, [value]); }
export const useParams = () => ({});
export function redirect(href: string): never { navigate(href, true); throw new Error("页面正在跳转。"); }
export function notFound(): never { throw new Error("页面不存在。"); }

export function installDesktopNavigation(routes: ReadonlySet<string>) {
  if (location.pathname === "/") history.replaceState(null, "", "/workspace" + location.search + location.hash);
  history.scrollRestoration = "manual";
  window.addEventListener("chengzi:desktop-navigate", event => {
    const href: unknown = (event as CustomEvent).detail;
    if (typeof href !== "string") return;
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !routes.has(url.pathname) || url.username || url.password) return;
      navigate(url.href, false, { scroll: url.pathname !== "/report" });
    } catch { /* An invalid native destination cannot navigate the renderer. */ }
  });
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || anchor.hasAttribute("download") || anchor.target && anchor.target !== "_self") return;
    const target = new URL(anchor.href, location.href);
    if (target.origin !== location.origin || !routes.has(target.pathname) || target.pathname === location.pathname && target.search === location.search && target.hash) return;
    event.preventDefault(); navigate(target.href, false, { scroll: target.pathname !== "/report" });
  });
  window.addEventListener("popstate", event => {
    const position = event.state?.desktopScroll;
    if (Array.isArray(position) && position.length === 2 && position.every(Number.isFinite)) requestAnimationFrame(() => window.scrollTo(position[0], position[1]));
  });
}
