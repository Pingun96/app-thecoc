importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

const CACHE_NAME = 'thecoc-pwa-v2.3.6';
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const withBase = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  withBase('/'),
  withBase('/manifest.webmanifest'),
  withBase('/offline.html'),
  withBase('/icons/thecoc-icon-512.png'),
  withBase('/icons/apple-touch-icon.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(withBase('/'), copy));
          return response;
        })
        .catch(async () => (
          (await caches.match(withBase('/'))) || caches.match(withBase('/offline.html'))
        ))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => (
      cached || fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
    ))
  );
});

// ===== NOTIFICATION CLICK: Navigate đến đúng màn hình khi bấm thông báo =====
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const route = data.route || data.screen || '';

  const routeMap = {
    'Inventory':        '?screen=Inventory',
    'Payroll':          '?screen=Payroll',
    'Shifts':           '?screen=Shifts',
    'ScheduleTab':      '?screen=ScheduleTab',
    'Notifications':    '?screen=Notifications',
    'AttendanceReview': '?screen=AttendanceReview',
    'StaffManagement':  '?screen=StaffManagement',
  };

  const query = routeMap[route] || '';
  const targetUrl = `${self.registration.scope}${query}`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Nếu app đang mở → focus và gửi message navigate
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (query) {
            client.postMessage({ type: 'THECOC_NAVIGATE', route });
          }
          return;
        }
      }
      // App chưa mở → mở tab mới
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
