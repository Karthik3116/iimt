// Minimal Service Worker to pass PWA installation requirements
const CACHE_NAME = 'iimt-pwa-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch for everything (preserves your existing API logic)
  event.respondWith(fetch(event.request));
});