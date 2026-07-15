const CACHE = 'moonfall-v14-cinematic-hunt';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/card-back.webp',
  './assets/logo.webp',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './assets/werewolf.webp',
  './assets/villager.webp',
  './assets/seer.webp',
  './assets/witch.webp',
  './assets/hunter.webp',
  './assets/cupid.webp',
  './assets/little-girl.webp',
  './assets/thief.webp',
  './assets/sheriff.webp',
  './assets/storyteller.webp',
  './assets/sprites/bg/square-night.webp',
  './assets/sprites/bg/square-day.webp',
  './assets/sprites/sheets/werewolf.webp',
  './assets/sprites/sheets/villager.webp',
  './assets/sprites/sheets/seer.webp',
  './assets/sprites/sheets/witch.webp',
  './assets/sprites/sheets/hunter.webp',
  './assets/sprites/sheets/cupid.webp',
  './assets/sprites/sheets/little-girl.webp',
  './assets/sprites/sheets/thief.webp',
  './assets/sprites/sheets/sheriff.webp',
  './assets/sprites/props/arrow.png',
  './assets/sprites/props/potion-green.png',
  './assets/sprites/props/potion-red.png',
  './assets/sprites/props/crystal-ball.png',
  './assets/sprites/props/badge.png',
  './assets/sprites/props/vote-token.png',
  './assets/sfx/impactSoft_medium_002.ogg',
  './assets/sfx/impactPunch_heavy_000.ogg',
  './assets/sfx/impactGlass_medium_003.ogg',
  './assets/sfx/impactBell_heavy_001.ogg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('./', copy));
      return response;
    }).catch(() => caches.match('./')));
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
