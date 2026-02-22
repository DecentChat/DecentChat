/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & typeof globalThis
declare const __APP_VERSION__: string
declare const __COMMIT_HASH__: string

const SW_BUILD_ID = `${__APP_VERSION__}:${__COMMIT_HASH__}`

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      client.postMessage({ type: 'DC_SW_ACTIVATED', buildId: SW_BUILD_ID })
    }
  })())
})

// Prefer fresh app shell on normal refresh to avoid stale-runtime reconnect bugs.
// Fall back to cache when offline.
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  const sameOrigin = url.origin === self.location.origin
  const isRuntimeChunk = sameOrigin &&
    url.pathname.startsWith('/assets/') &&
    /\.(js|css)$/.test(url.pathname)

  if (isRuntimeChunk) {
    event.respondWith((async () => {
      try {
        const request = new Request(event.request, { cache: 'no-store' })
        return await fetch(request)
      } catch {
        const cached = await caches.match(event.request, { ignoreSearch: true })
        if (cached) return cached
        throw new Error(`Runtime chunk unavailable: ${url.pathname}`)
      }
    })())
    return
  }

  if (event.request.mode !== 'navigate') return

  event.respondWith((async () => {
    try {
      const request = new Request(event.request, { cache: 'no-store' })
      return await fetch(request)
    } catch {
      const cached = await caches.match(event.request, { ignoreSearch: true })
      if (cached) return cached
      return (await caches.match('/index.html', { ignoreSearch: true })) as Response
    }
  })())
})

// Only skip waiting when explicitly triggered — controlled update flow.
// The app sends { type: 'SKIP_WAITING' } when the user clicks "Update now"
// or when auto-apply fires on tab visibility change.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
})
