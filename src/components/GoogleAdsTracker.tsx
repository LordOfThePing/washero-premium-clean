import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  initGoogleAds,
  isGoogleAdsEnabled,
  trackGoogleAdsEvent,
  trackGoogleAdsPageView,
} from "@/lib/google-ads";
import { syncAttributionFromWindow } from "@/lib/attribution";

/**
 * Global Google Ads tracker: gtag init, SPA pageviews, attribution capture,
 * and delegated CTA click events (reservar / WhatsApp links).
 */
export function GoogleAdsTracker() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const lastPageRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isGoogleAdsEnabled() || typeof window === "undefined") return;
    void initGoogleAds();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    syncAttributionFromWindow();
  }, [pathname, searchStr]);

  useEffect(() => {
    if (!isGoogleAdsEnabled() || typeof window === "undefined") return;

    const pageKey = `${pathname}${searchStr}`;
    if (lastPageRef.current === pageKey) return;
    lastPageRef.current = pageKey;

    trackGoogleAdsPageView({
      page_path: `${pathname}${searchStr}`,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [pathname, searchStr]);

  useEffect(() => {
    if (!isGoogleAdsEnabled() || typeof window === "undefined") return;

    function handleClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;

      const lower = href.toLowerCase();
      if (lower.includes("wa.me") || lower.includes("whatsapp.com")) {
        trackGoogleAdsEvent("click_whatsapp", { link_url: href });
        return;
      }

      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === "/reservar" || url.pathname.endsWith("/reservar")) {
          trackGoogleAdsEvent("click_reservar_cta", { link_url: href });
        }
      } catch {
        if (href.includes("/reservar")) {
          trackGoogleAdsEvent("click_reservar_cta", { link_url: href });
        }
      }
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
