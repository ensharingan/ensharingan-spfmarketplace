// Spare Parts Finder — service worker
// v2: never cache server-rendered or API routes, and keep the app shell fresh.

const CACHE_NAME = 'spf-marketplace-v2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/vehicles.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Routes that must always come from the network: they're generated per-request
// and a cached copy would serve stale prices, stock or search results.
const NEVER_CACHE = [
  '/api/',
  '/part/',
  '/brand/',
  '/shop/',
  '/sitemap',
  '/feed.xml',
  '/robots.txt',
  '/admin'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll fails the whole install if any single asset 404s
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Live data and third-party media always go straight to the network
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('cloudinary.com')) return;
  if (url.hostname.includes('google-analytics.com')) return;
  if (url.hostname.includes('googletagmanager.com')) return;
  if (url.origin === self.location.origin && NEVER_CACHE.some(p => url.pathname.startsWith(p))) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(req).then(cached => {
          if (cached) return cached;
          if (req.mode === 'navigate') return caches.match('/index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        })
      )
  );
});

// Let the page tell the worker to activate immediately after an update
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Spare Parts Finder', {
      body: data.body || 'You have a new notification',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
