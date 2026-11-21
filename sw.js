const cacheName = 'serendipity-shell-v1';
const shell = [
  './', './index.html', './style.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './app.js', './auth.js', './api.js', './config.js', './db.js', './demo.js', './player.js', './rank.js', './refresh.js',
  './ui/dom.js', './ui/feed.js', './ui/people.js', './ui/settings.js', './ui/setup.js'
];
const paths = new Set(shell.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('serendipity-shell-') && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  url.search = '';
  if (request.method !== 'GET' || !paths.has(url.href)) return;
  event.respondWith(fetch(request).then(async response => {
    if (response.ok) await (await caches.open(cacheName)).put(url.href, response.clone());
    return response;
  }).catch(() => caches.match(url.href)));
});
