"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { registerWebMcpTools } from "postext-sandbox/webmcp";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { createSiteTools, type SiteToolDeps } from "@/lib/webmcp/siteTools";

/** Registers the site's WebMCP tools (`document.modelContext`) on every
 *  page, so an agent in the browser can find, read and open pages, browse
 *  the Cookbook and switch language or theme without clicking through the
 *  interface. Renders nothing. */
export function SiteWebMcp() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const theme = useTheme();
  // The tools are registered once; they read what is current when called.
  const live = useRef({ locale, pathname, router, theme });
  useEffect(() => {
    live.current = { locale, pathname, router, theme };
  });

  useEffect(() => {
    const deps: SiteToolDeps = {
      locale: () => live.current.locale,
      path: () => live.current.pathname,
      title: () => document.title,
      address: () => `${live.current.pathname}${window.location.search}${window.location.hash}`,
      navigate: (path, toLocale) => {
        const { locale: from, pathname: at, router: r } = live.current;
        const [page, fragment] = path.split("#");
        if (fragment === undefined) {
          r.push(path, { locale: toLocale });
          return;
        }
        // The same page at another fragment: assigned, so the page's own
        // `hashchange` listeners (the Sandbox's book and page links) hear it.
        if (toLocale === from && (page.split("?")[0] || "/") === at) {
          window.location.hash = `#${fragment}`;
          return;
        }
        // Another page at a fragment is loaded whole: a page reads its
        // fragment as it starts (the Sandbox opens the book it names, a
        // docs page lands on the heading), which a client-side route
        // change is too late for. After the tool has answered.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.setTimeout(() => window.location.assign(`/${toLocale}${path === "/" ? "" : path}`), 60);
      },
      theme: { get: () => live.current.theme.theme, set: (t) => live.current.theme.setTheme(t) },
      fetch: (url, init) => fetch(url, init),
    };
    const controller = new AbortController();
    registerWebMcpTools(createSiteTools(deps), controller.signal);
    return () => controller.abort();
  }, []);

  return null;
}
