const CACHE_NAME = 'world-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/guide.html',
  '/style.css',
  '/manifest.json',
  '/data/concepts.json',
  '/data/items.json',
  '/src/main.js',
  '/src/renderer/AgentRenderer.js',
  '/src/renderer/BeeRenderer.js',
  '/src/renderer/BirdFlockRenderer.js',
  '/src/renderer/BuildingRenderer.js',
  '/src/renderer/ButterflyRenderer.js',
  '/src/renderer/DeerRenderer.js',
  '/src/renderer/EagleRenderer.js',
  '/src/renderer/FlowerRenderer.js',
  '/src/renderer/FoxRenderer.js',
  '/src/renderer/FrogRenderer.js',
  '/src/renderer/HighlandCowRenderer.js',
  '/src/renderer/InsectSwarmRenderer.js',
  '/src/renderer/MinimapRenderer.js',
  '/src/renderer/PigRenderer.js',
  '/src/renderer/RabbitRenderer.js',
  '/src/renderer/RainbowRenderer.js',
  '/src/renderer/RobinRenderer.js',
  '/src/renderer/SheepRenderer.js',
  '/src/renderer/TerrainRenderer.js',
  '/src/renderer/WhaleRenderer.js',
  '/src/renderer/WildHorseRenderer.js',
  '/src/renderer/WolfRenderer.js',
  '/src/renderer/WorldRenderer.js',
  '/src/simulation/Agent.js',
  '/src/simulation/ConceptGraph.js',
  '/src/simulation/Deer.js',
  '/src/simulation/FishShoal.js',
  '/src/simulation/Fox.js',
  '/src/simulation/Frog.js',
  '/src/simulation/GatheringSystem.js',
  '/src/simulation/InsectSwarm.js',
  '/src/simulation/Inventory.js',
  '/src/simulation/PopulationManager.js',
  '/src/simulation/Predator.js',
  '/src/simulation/SpatialGrid.js',
  '/src/simulation/TileItems.js',
  '/src/simulation/Whale.js',
  '/src/simulation/WildHorse.js',
  '/src/simulation/Wolf.js',
  '/src/simulation/World.js',
  '/src/systems/Achievements.js',
  '/src/systems/AnimalSkillSystem.js',
  '/src/systems/AudioSystem.js',
  '/src/systems/ChunkSystem.js',
  '/src/systems/ConflictSystem.js',
  '/src/systems/CraftingSystem.js',
  '/src/systems/DisasterSystem.js',
  '/src/systems/DiseaseSystem.js',
  '/src/systems/EcologySystem.js',
  '/src/systems/FireSystem.js',
  '/src/systems/HistoryLog.js',
  '/src/systems/LineageTracker.js',
  '/src/systems/SettlementSystem.js',
  '/src/systems/TimeSystem.js',
  '/src/systems/TradingSystem.js',
  '/src/systems/UtilityAI.js',
  '/src/systems/WeatherSystem.js',
  '/src/workers/SimulationWorker.js',
  '/src/workers/TerrainWorker.js',
  // Three.js CDN modules (CORS-enabled) so offline mode can boot
  'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/controls/OrbitControls.js',
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
