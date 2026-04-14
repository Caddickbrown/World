const CACHE_NAME = 'world-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/data/concepts.json',
  '/data/items.json',
  '/src/main.js',
  '/src/simulation/World.js',
  '/src/simulation/Agent.js',
  '/src/simulation/ConceptGraph.js',
  '/src/simulation/WildHorse.js',
  '/src/renderer/WorldRenderer.js',
  '/src/renderer/TerrainRenderer.js',
  '/src/renderer/AgentRenderer.js',
  '/src/renderer/BuildingRenderer.js',
  '/src/renderer/WildHorseRenderer.js',
  '/src/renderer/SheepRenderer.js',
  '/src/renderer/HighlandCowRenderer.js',
  '/src/renderer/ButterflyRenderer.js',
  '/src/renderer/BeeRenderer.js',
  '/src/renderer/FlowerRenderer.js',
  '/src/renderer/MinimapRenderer.js',
  '/src/systems/TimeSystem.js',
  '/src/systems/WeatherSystem.js',
  '/src/systems/HistoryLog.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
