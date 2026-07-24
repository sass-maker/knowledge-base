import { useEffect, useState } from "react";

export const ROUTES = [
  "/",
  "/domains",
  "/query",
  "/ingest",
  "/evals",
  "/traces",
  "/settings",
] as const;

export type AppPath = (typeof ROUTES)[number];

const NAVIGATION_EVENT = "knowledgebase:navigate";

export function normalizePath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function isAppPath(pathname: string): pathname is AppPath {
  return (ROUTES as readonly string[]).includes(normalizePath(pathname));
}

export function navigate(href: string): void {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url);
    return;
  }
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const sync = () => setPathname(normalizePath(window.location.pathname));
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, []);

  return pathname;
}
