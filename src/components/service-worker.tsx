"use client"

import { useEffect } from "react"

/** Registers the offline service worker (production only; the dev server changes files constantly). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return
    // The build id in the URL gives each deploy its own app cache; old ones are removed on activate.
    void navigator.serviceWorker.register(`/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "1"}`, { scope: "/" }).catch(() => {})
  }, [])
  return null
}
