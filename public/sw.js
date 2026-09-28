/*
 * Insitu service worker: after one visit the app opens and computes without a connection.
 * Only code and engine files are cached (app chunks, fonts, the sample file, DuckDB/OCR engines
 * from jsDelivr) — never user data and never /api (the question translator needs the network).
 *
 * - Pages: network first (new deploys arrive at once), the cached page when offline.
 * - /_next/static: cache first (file names change with every build).
 * - jsDelivr engines: cache first (versioned URLs).
 * - Fonts, sample, icons: served from cache, refreshed in the background.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev"
const APP = `insitu-app-${VERSION}`
const ENGINE = "insitu-engines-v1"
const PAGE_KEY = "/__insitu_page"

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP)
      .then((cache) =>
        cache.addAll(["/fonts/NotoSans-Regular.ttf", "/fonts/NotoSans-Bold.ttf", "/samples/satislar.csv", "/icon.svg", "/manifest.webmanifest"]),
      )
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("insitu-app-") && k !== APP).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

async function networkFirstPage(request) {
  const cache = await caches.open(APP)
  // The app page under one key (it is the same for any query string); other pages by URL.
  const key = new URL(request.url).pathname === "/" ? PAGE_KEY : request
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(key, response.clone())
    return response
  } catch {
    const cached = (await cache.match(key)) || (await cache.match(PAGE_KEY))
    if (cached) return cached
    throw new Error("offline and no cached page")
  }
}

async function cacheFirst(request, cacheName, allowOpaque = false) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  // Engine scripts loaded with importScripts() in a worker are "opaque" (no-cors): their status
  // cannot be read, but jsDelivr URLs are pinned to a version, so they are safe to keep.
  const storable = (response.ok && (response.type === "basic" || response.type === "cors")) || (allowOpaque && response.type === "opaque")
  if (storable) await cache.put(request, response.clone())
  return response
}

/**
 * Worker scripts: cached like other static files, but answered with a copy that has no URL of
 * its own. A worker takes its address from the response; a cached response would carry the
 * address without its "#params=…" part, which the bundler's worker bootstrap reads to know what
 * to load — the worker would then wait forever. A URL-less copy keeps the requested address.
 */
async function workerScript(request) {
  const cache = await caches.open(APP)
  let response = await cache.match(request)
  if (!response) {
    response = await fetch(request)
    if (response.ok && response.type === "basic") await cache.put(request, response.clone())
  }
  if (!response.ok) return response
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP)
  const cached = await cache.match(request)
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone())
      return response
    })
    .catch(() => cached)
  return cached || refresh
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  const url = new URL(request.url)

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return // the translator is never cached
    if (request.mode === "navigate") return event.respondWith(networkFirstPage(request))
    if (request.destination === "worker" || request.destination === "sharedworker") return event.respondWith(workerScript(request))
    if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(request, APP))
    if (/^\/(fonts|samples)\//.test(url.pathname) || /\.(svg|png|ico|webmanifest)$/.test(url.pathname)) {
      return event.respondWith(staleWhileRevalidate(request))
    }
    return
  }
  if (url.hostname === "cdn.jsdelivr.net") return event.respondWith(cacheFirst(request, ENGINE, true))
})
