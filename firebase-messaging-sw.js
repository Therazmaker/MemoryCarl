// firebase-messaging-sw.js (minimal + clean)

// Permite activar la nueva versión rápido
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Recibe señal desde la página para saltar waiting
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
