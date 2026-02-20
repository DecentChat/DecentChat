/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & typeof globalThis

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Only skip waiting when explicitly triggered — controlled update flow.
// The app sends { type: 'SKIP_WAITING' } when the user clicks "Update now"
// or when auto-apply fires on tab visibility change.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
