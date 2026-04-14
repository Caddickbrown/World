import * as THREE from 'three';
import { World, TILE_SIZE, TileType } from './simulation/World.js';
import { Agent }             from './simulation/Agent.js';
import { ConceptGraph }      from './simulation/ConceptGraph.js';
import { WorldRenderer }     from './renderer/WorldRenderer.js';
import { TerrainRenderer }   from './renderer/TerrainRenderer.js';
import { AgentRenderer }     from './renderer/AgentRenderer.js';
import { BuildingRenderer }  from './renderer/BuildingRenderer.js';
import { WildHorse }         from './simulation/WildHorse.js';
import { WildHorseRenderer } from './renderer/WildHorseRenderer.js';
import { SheepRenderer }     from './renderer/SheepRenderer.js';
import { HighlandCowRenderer } from './renderer/HighlandCowRenderer.js';
import { ButterflyRenderer } from './renderer/ButterflyRenderer.js';
import { BeeRenderer }       from './renderer/BeeRenderer.js';
import { FlowerRenderer }    from './renderer/FlowerRenderer.js';
import { TimeSystem }        from './systems/TimeSystem.js';
import { WeatherSystem }     from './systems/WeatherSystem.js';
import { MinimapRenderer }   from './renderer/MinimapRenderer.js';
import { HistoryLog }        from './systems/HistoryLog.js';

const AGENT_COUNT = 12;
const WILD_HORSE_COUNT = 4;

// ── Error handling ──────────────────────────────────────────────────────────

function showError(msg, err) {
  try {
    const banner = document.getElementById('error-banner');
    const el = document.getElementById('error-message');
    if (banner && el) {
      el.textContent = typeof msg === 'string' ? msg : String(msg);
      banner.classList.remove('hidden');
    }
    console.error('[World]', msg, err ?? '');
  } catch (e) {
    console.error('[World] showError failed', e);
  }
}

function hideError() {
  const banner = document.getElementById('error-banner');
  if (banner) banner.classList.add('hidden');
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function init() {
  let conceptsData;
  try {
    const res = await fetch('./data/concepts.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    conceptsData = await res.json();
    if (!Array.isArray(conceptsData)) throw new Error('concepts.json must be an array');
  } catch (e) {
    showError('Could not load concepts.json – run via a local server', e);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = 'Error: run via python -m http.server 8080';
    return;
  }

  // Load item definitions
  let itemDefs = new Map();
  try {
    const itemRes = await fetch('./data/items.json');
    if (itemRes.ok) {
      const itemsData = await itemRes.json();
      for (const item of itemsData) itemDefs.set(item.id, item);
    }
  } catch (e) {
    console.warn('Could not load items.json, inventory system disabled:', e);
  }

  const canvas = document.getElementById('world-canvas');
  if (!canvas) {
    showError('Canvas element not found');
    return;
  }

  let world; let conceptGraph; let terrainRenderer; let ar; let buildingRenderer; let time; let weather;
  let horses = [];
  let horseRenderer;
  let butterflyRenderer;
  let beeRenderer;
  let sheepRenderer;
  let highlandCowRenderer;
  let flowerRenderer;
  try {
  world = new World();
  world.naturalFires = new Map();
  let lightningCooldown = 0;
  conceptGraph = new ConceptGraph(conceptsData);
  const agents = world.getSpawnPoints(AGENT_COUNT).map(p => new Agent(p.x, p.z));

  const wr = new WorldRenderer(canvas);
  terrainRenderer = new TerrainRenderer(wr.scene, world);
  ar = new AgentRenderer(wr.scene, agents, world);
  buildingRenderer = new BuildingRenderer(wr.scene, world);
  horses = world.getWildHorseSpawnPoints(WILD_HORSE_COUNT).map(p => new WildHorse(p.x, p.z));
  horseRenderer     = new WildHorseRenderer(wr.scene, horses, world);
  sheepRenderer     = new SheepRenderer(wr.scene, world);
  highlandCowRenderer = new HighlandCowRenderer(wr.scene, world);
  butterflyRenderer = new ButterflyRenderer(wr.scene, world);
  beeRenderer       = new BeeRenderer(wr.scene, world);
  flowerRenderer    = new FlowerRenderer(wr.scene, world);

  time = new TimeSystem();
  weather = new WeatherSystem();

  // ── Minimap & History Log ──────────────────────────────────────────────
  const minimap = new MinimapRenderer(world);
  const historyLog = new HistoryLog();

  // Display current seed
  const seedEl = document.getElementById('world-seed');
  if (seedEl) seedEl.textContent = 'Seed: ' + world.seed;

  // ── Fade out loading screen ───────────────────────────────────────────
  const loading = document.getElementById('loading');
  loading.classList.add('fade-out');
  loading.addEventListener('transitionend', () => loading.remove(), { once: true });

  // ── Speed controls ─────────────────────────────────────────────────────
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const speed = Number(btn.dataset.speed);
      time.setSpeed(speed);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ── Info panel ─────────────────────────────────────────────────────────
  let selectedAgent = null;
  let selectedTile  = null;
  let gameOver = false;
  let gameOverAutoResetId = null;

  document.getElementById('info-close').addEventListener('click', () => {
    if (selectedAgent) selectedAgent.selected = false;
    selectedAgent = null;
    selectedTile  = null;
    document.getElementById('info-panel').classList.add('hidden');
  });

  // ── Stats (persisted to localStorage) ────────────────────────────────────
  const STATS_KEY = 'world-game-stats';
  const stats = (() => {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw) return { ...{ gameOvers: 0, worldsPlayed: 0, totalBirths: 0, longestSurvival: 0, peakPopulation: 0, bestDiscoveries: 0 }, ...JSON.parse(raw) };
    } catch (_) {}
    return { gameOvers: 0, worldsPlayed: 0, totalBirths: 0, longestSurvival: 0, peakPopulation: 0, bestDiscoveries: 0 };
  })();
  function saveStats() {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (_) {}
  }
  function updateStatsDisplay() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('stat-game-overs', stats.gameOvers);
    set('stat-worlds', stats.worldsPlayed);
    set('stat-births', stats.totalBirths);
    set('stat-days', stats.longestSurvival > 0 ? `Day ${stats.longestSurvival}` : '—');
    set('stat-peak', stats.peakPopulation);
    set('stat-discoveries', stats.bestDiscoveries);
  }

  // ── Hamburger / settings ───────────────────────────────────────────────
  const hamburgerBtn  = document.getElementById('hamburger-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const popSlider     = document.getElementById('pop-slider');
  const popValue      = document.getElementById('pop-value');
  const maxPopSlider  = document.getElementById('max-pop-slider');
  const maxPopValue   = document.getElementById('max-pop-value');

  popSlider.addEventListener('input', () => {
    popValue.textContent = popSlider.value;
  });
  maxPopSlider.addEventListener('input', () => {
    maxPopValue.textContent = maxPopSlider.value;
  });

  hamburgerBtn.addEventListener('click', () => {
    const isOpen = !settingsPanel.classList.contains('hidden');
    settingsPanel.classList.toggle('hidden', isOpen);
    hamburgerBtn.classList.toggle('open', !isOpen);
    if (!isOpen) updateStatsDisplay();
  });

  // Close settings if user clicks outside it
  document.addEventListener('click', e => {
    if (!settingsPanel.contains(e.target) && e.target !== hamburgerBtn) {
      settingsPanel.classList.add('hidden');
      hamburgerBtn.classList.remove('open');
    }
  });

  function resetWorld() {
    try {
    terrainRenderer.dispose();
    ar.dispose();
    buildingRenderer.dispose();
    horseRenderer?.dispose();
    sheepRenderer?.dispose();
    highlandCowRenderer?.dispose();
    butterflyRenderer?.dispose();
    beeRenderer?.dispose();
    flowerRenderer?.dispose();

    world = new World();
    world.naturalFires = new Map();
    lightningCooldown = 0;
    conceptGraph = new ConceptGraph(conceptsData);
    agents.length = 0;
    const startPop = Number(popSlider.value);
    world.getSpawnPoints(startPop).forEach(p => agents.push(new Agent(p.x, p.z)));

    terrainRenderer = new TerrainRenderer(wr.scene, world);
    ar = new AgentRenderer(wr.scene, agents, world);
    buildingRenderer = new BuildingRenderer(wr.scene, world);
    horses.length = 0;
    world.getWildHorseSpawnPoints(WILD_HORSE_COUNT).forEach(p => horses.push(new WildHorse(p.x, p.z)));
    horseRenderer     = new WildHorseRenderer(wr.scene, horses, world);
    sheepRenderer     = new SheepRenderer(wr.scene, world);
    highlandCowRenderer = new HighlandCowRenderer(wr.scene, world);
    butterflyRenderer = new ButterflyRenderer(wr.scene, world);
    beeRenderer       = new BeeRenderer(wr.scene, world);
    flowerRenderer    = new FlowerRenderer(wr.scene, world);

    time.gameTime = (8 / 24) * 120; // reset to 08:00
    birthGameTimes.length = 0;
    weather.current = 'CLEAR';
    weather._timer  = 0;
    gameOver = false;
    if (gameOverAutoResetId) {
      clearTimeout(gameOverAutoResetId);
      gameOverAutoResetId = null;
    }
    if (selectedAgent) selectedAgent.selected = false;
    selectedAgent = null;
    selectedTile  = null;
    document.getElementById('info-panel').classList.add('hidden');
    document.getElementById('game-over').classList.add('hidden');
    settingsPanel.classList.add('hidden');
    hamburgerBtn.classList.remove('open');

    stats.worldsPlayed++;
    saveStats();

    minimap.world = world;
    minimap._renderTerrain();
    historyLog.entries.length = 0;
    if (seedEl) seedEl.textContent = 'Seed: ' + world.seed;

    showNotification('A new world begins...', 'env');
    } catch (e) {
      showError('Reset failed', e);
    }
  }

  document.getElementById('reset-btn').addEventListener('click', resetWorld);
  document.getElementById('game-over-reset').addEventListener('click', resetWorld);

  // ── Seed input UI ─────────────────────────────────────────────────────
  const seedBtn = document.getElementById('seed-btn');
  const seedInput = document.getElementById('seed-input');
  if (seedBtn && seedInput) {
    seedBtn.addEventListener('click', () => {
      const val = Number(seedInput.value);
      if (!isNaN(val) && val >= 0) {
        // Dispose and rebuild world with custom seed
        terrainRenderer.dispose();
        ar.dispose();
        buildingRenderer.dispose();
        horseRenderer?.dispose();
        sheepRenderer?.dispose();
        highlandCowRenderer?.dispose();
        butterflyRenderer?.dispose();
        beeRenderer?.dispose();
        flowerRenderer?.dispose();

        world = new World(val);
        world.naturalFires = new Map();
        lightningCooldown = 0;
        conceptGraph = new ConceptGraph(conceptsData);
        agents.length = 0;
        const startPop = Number(popSlider.value);
        world.getSpawnPoints(startPop).forEach(p => agents.push(new Agent(p.x, p.z)));

        terrainRenderer = new TerrainRenderer(wr.scene, world);
        ar = new AgentRenderer(wr.scene, agents, world);
        buildingRenderer = new BuildingRenderer(wr.scene, world);
        horses.length = 0;
        world.getWildHorseSpawnPoints(WILD_HORSE_COUNT).forEach(p => horses.push(new WildHorse(p.x, p.z)));
        horseRenderer     = new WildHorseRenderer(wr.scene, horses, world);
        sheepRenderer     = new SheepRenderer(wr.scene, world);
        highlandCowRenderer = new HighlandCowRenderer(wr.scene, world);
        butterflyRenderer = new ButterflyRenderer(wr.scene, world);
        beeRenderer       = new BeeRenderer(wr.scene, world);
        flowerRenderer    = new FlowerRenderer(wr.scene, world);

        minimap.world = world;
        minimap._renderTerrain();
        historyLog.entries.length = 0;

        time.gameTime = (8 / 24) * 120;
        birthGameTimes.length = 0;
        weather.current = 'CLEAR';
        weather._timer  = 0;
        gameOver = false;
        if (gameOverAutoResetId) { clearTimeout(gameOverAutoResetId); gameOverAutoResetId = null; }
        if (selectedAgent) selectedAgent.selected = false;
        selectedAgent = null;
        selectedTile  = null;
        document.getElementById('info-panel').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');

        if (seedEl) seedEl.textContent = 'Seed: ' + world.seed;
        seedInput.value = '';
        showNotification('New world from seed ' + val, 'env');
      }
    });
  }

  // ── Save / Load ───────────────────────────────────────────────────────
  const SAVE_KEY = 'world-save';
  document.addEventListener('keydown', e => {
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      try {
        const saveData = world.serialize(agents, conceptGraph, time.gameTime, { current: weather.current, timer: weather._timer });
        localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
        showNotification('World saved!', 'env');
      } catch (err) {
        console.error('Save failed', err);
        showNotification('Save failed.', 'env');
      }
    }
    // Ctrl+L to load
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) { showNotification('No save found.', 'env'); return; }
        const saveData = JSON.parse(raw);

        terrainRenderer.dispose();
        ar.dispose();
        buildingRenderer.dispose();
        horseRenderer?.dispose();
        sheepRenderer?.dispose();
        highlandCowRenderer?.dispose();
        butterflyRenderer?.dispose();
        beeRenderer?.dispose();
        flowerRenderer?.dispose();

        world = World.deserialize(saveData);
        world.naturalFires = new Map();
        lightningCooldown = 0;
        conceptGraph = new ConceptGraph(conceptsData);
        if (saveData.conceptGraph && conceptGraph.deserialize) {
          conceptGraph.deserialize(saveData.conceptGraph);
        }
        agents.length = 0;
        if (saveData.agents) {
          for (const ad of saveData.agents) {
            const a = new Agent(ad.x, ad.z);
            a.health = ad.health ?? 1;
            if (ad.knowledge) ad.knowledge.forEach(k => a.knowledge.add(k));
            if (ad.inventory?.deserialize) a.inventory.deserialize(ad.inventory);
            agents.push(a);
          }
        }

        terrainRenderer = new TerrainRenderer(wr.scene, world);
        ar = new AgentRenderer(wr.scene, agents, world);
        buildingRenderer = new BuildingRenderer(wr.scene, world);
        horses.length = 0;
        world.getWildHorseSpawnPoints(WILD_HORSE_COUNT).forEach(p => horses.push(new WildHorse(p.x, p.z)));
        horseRenderer     = new WildHorseRenderer(wr.scene, horses, world);
        sheepRenderer     = new SheepRenderer(wr.scene, world);
        highlandCowRenderer = new HighlandCowRenderer(wr.scene, world);
        butterflyRenderer = new ButterflyRenderer(wr.scene, world);
        beeRenderer       = new BeeRenderer(wr.scene, world);
        flowerRenderer    = new FlowerRenderer(wr.scene, world);

        minimap.world = world;
        minimap._renderTerrain();
        historyLog.entries.length = 0;

        if (saveData.gameTime) time.gameTime = saveData.gameTime;
        if (saveData.weatherState) {
          weather.current = saveData.weatherState.current ?? 'CLEAR';
          weather._timer  = saveData.weatherState.timer ?? 0;
        }
        birthGameTimes.length = 0;
        gameOver = false;
        if (gameOverAutoResetId) { clearTimeout(gameOverAutoResetId); gameOverAutoResetId = null; }
        if (selectedAgent) selectedAgent.selected = false;
        selectedAgent = null;
        selectedTile  = null;
        document.getElementById('info-panel').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');

        if (seedEl) seedEl.textContent = 'Seed: ' + world.seed;
        showNotification('World loaded from save!', 'env');
      } catch (err) {
        console.error('Load failed', err);
        showNotification('Load failed.', 'env');
      }
    }
  });

  // ── Minimap toggle (M key) ────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'm' || e.key === 'M') {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      minimap.visible = !minimap.visible;
      minimap.canvas.style.display = minimap.visible ? 'block' : 'none';
    }
  });

  const errDismiss = document.getElementById('error-dismiss');
  if (errDismiss) errDismiss.addEventListener('click', hideError);

  window.onerror = (msg, source, line, col, err) => {
    showError(msg || 'An unexpected error occurred', err);
    return true;
  };
  window.onunhandledrejection = (e) => {
    showError(e.reason?.message || 'Promise rejected', e.reason);
  };

  // ── Discoveries modal ─────────────────────────────────────────────────
  const discoveriesModal = document.getElementById('discoveries-modal');
  document.getElementById('discoveries-modal-close').addEventListener('click', () => {
    discoveriesModal.classList.add('hidden');
  });
  discoveriesModal.addEventListener('click', e => {
    if (e.target === discoveriesModal) discoveriesModal.classList.add('hidden');
  });
  document.addEventListener('click', e => {
    if (e.target?.id === 'discoveries-view-all' || e.target?.closest('#discoveries-view-all')) {
      const discovered = window._lastDiscovered ?? [];
      const alive = window._lastAlive ?? 0;
      const modalList = document.getElementById('discoveries-modal-list');
      modalList.innerHTML = discovered.map(c =>
        `<div class="concept-item">
          <span class="concept-dot"></span>
          <span>${c.icon ?? ''} ${c.name}</span>
          <span class="concept-spread">${c.knownCount}/${alive}</span>
        </div>`
      ).join('');
      discoveriesModal.classList.remove('hidden');
    }
  });

  // ── Click detection ────────────────────────────────────────────────────
  // We raycast to the ground plane (y=0) to get a world position, then
  // find the nearest live agent within a generous pick radius. This is far
  // more reliable than trying to intersect tiny capsule meshes.
  const raycaster   = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundPoint = new THREE.Vector3();
  const PICK_RADIUS = TILE_SIZE * 1.5; // 3 world-units ≈ 1.5 tiles
  let mouseDownAt  = null;
  let dragAgent    = null;  // agent being dragged
  let isDragging   = false; // true once mouse moves >5px with dragAgent

  const findNearestAgent = (wx, wz) => {
    let hit = null, bestDist = PICK_RADIUS;
    for (const agent of agents) {
      if (agent.health <= 0) continue;
      const dist = Math.hypot(wx - agent.x * TILE_SIZE, wz - agent.z * TILE_SIZE);
      if (dist < bestDist) { bestDist = dist; hit = agent; }
    }
    return hit;
  };

  canvas.addEventListener('mousedown', e => {
    mouseDownAt = { x: e.clientX, y: e.clientY };
    // Check if clicking near an agent (may become a drag)
    const ndc = wr.getNDC(e);
    raycaster.setFromCamera(ndc, wr.camera);
    if (raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
      dragAgent  = findNearestAgent(groundPoint.x, groundPoint.z);
      isDragging = false;
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (!mouseDownAt || !dragAgent) return;
    const dx = e.clientX - mouseDownAt.x;
    const dy = e.clientY - mouseDownAt.y;
    if (!isDragging && Math.hypot(dx, dy) > 5) isDragging = true;
    if (isDragging) {
      const ndc = wr.getNDC(e);
      raycaster.setFromCamera(ndc, wr.camera);
      if (raycaster.ray.intersectPlane(groundPlane, groundPoint)) {
        dragAgent.x       = groundPoint.x / TILE_SIZE;
        dragAgent.z       = groundPoint.z / TILE_SIZE;
        dragAgent.targetX = dragAgent.x;
        dragAgent.targetZ = dragAgent.z;
      }
    }
  });

  canvas.addEventListener('mouseup', e => {
    if (!mouseDownAt) return;

    // Finish drag: snap agent to nearest valid tile
    if (isDragging && dragAgent) {
      const tileX = Math.round(dragAgent.x);
      const tileZ = Math.round(dragAgent.z);
      const tile  = world.getTile(tileX, tileZ);
      if (tile && tile.type !== TileType.WATER && tile.type !== TileType.DEEP_WATER) {
        dragAgent.x = tileX; dragAgent.z = tileZ;
        dragAgent.targetX = tileX; dragAgent.targetZ = tileZ;
      } else {
        // Revert to last valid position (targetX/Z before drag started)
        dragAgent.x = dragAgent.targetX; dragAgent.z = dragAgent.targetZ;
      }
      mouseDownAt = null; dragAgent = null; isDragging = false;
      return;
    }
    dragAgent  = null;
    isDragging = false;

    const dx = e.clientX - mouseDownAt.x;
    const dy = e.clientY - mouseDownAt.y;
    mouseDownAt = null;
    if (Math.hypot(dx, dy) > 5) return; // was a camera drag

    const ndc = wr.getNDC(e);
    raycaster.setFromCamera(ndc, wr.camera);
    if (!raycaster.ray.intersectPlane(groundPlane, groundPoint)) return;

    // Find nearest live agent to the click position
    const hit = findNearestAgent(groundPoint.x, groundPoint.z);

    if (hit) {
      if (selectedAgent) selectedAgent.selected = false;
      selectedAgent = hit;
      selectedTile  = null;
      hit.selected = true;
      updateInfoPanel(hit);
      document.getElementById('info-panel').classList.remove('hidden');
    } else {
      if (selectedAgent) selectedAgent.selected = false;
      selectedAgent = null;
      selectedTile  = null;

      // Check for nearby animal before falling back to tile
      const animal = terrainRenderer.hitTestAnimals(groundPoint.x, groundPoint.z);
      if (animal) {
        document.getElementById('info-content').innerHTML = `
          <div class="info-name">${animal.icon} ${animal.label}</div>
          <div class="info-state" style="opacity:.7;font-size:12px">Wildlife</div>
          <div style="margin-top:10px;font-size:12px;opacity:.85">${animal.description}</div>
        `;
        document.getElementById('info-panel').classList.remove('hidden');
      } else {
        // Check for tile click
        const tx = Math.floor(groundPoint.x / TILE_SIZE);
        const tz = Math.floor(groundPoint.z / TILE_SIZE);
        const tile = world.getTile(tx, tz);
        if (tile) {
          selectedTile = tile;
          updateTileInfoPanel(tile);
          document.getElementById('info-panel').classList.remove('hidden');
        } else {
          document.getElementById('info-panel').classList.add('hidden');
        }
      }
    }
  });

  // ── HUD update (throttled) ─────────────────────────────────────────────
  let lastHudUpdate = 0;
  const birthGameTimes = []; // gameTime when each birth occurred

  function updateHUD() {
    try {
    const now = performance.now();
    if (now - lastHudUpdate < 500) return;
    lastHudUpdate = now;

    const aliveAgents = agents.filter(a => a?.health > 0);
    const alive = aliveAgents.length;
    const aliveIds = new Set(aliveAgents.map(a => a.id));
    const hasAgriculture = aliveAgents.some(a => a.knowledge.has('agriculture'));
    const maxPop = Number(maxPopSlider?.value ?? 100);
    const carryingCapacity = Math.min(maxPop, Math.floor(world.getCarryingCapacity() * (hasAgriculture ? 1.25 : 1)));
    document.getElementById('population').textContent = `${alive} / ${carryingCapacity}`;

    // Replenishment rate: average births per game day (rolling 5-day window)
    const REPLENISH_WINDOW_DAYS = 5;
    const windowStart = time.gameTime - REPLENISH_WINDOW_DAYS * time.dayLength;
    const recent = birthGameTimes.filter(t => t > windowStart);
    const birthsInWindow = recent.length;
    if (birthGameTimes.length > 200) {
      birthGameTimes.length = 0;
      birthGameTimes.push(...recent);
    }
    const elapsedDays = time.gameTime / time.dayLength;
    const windowDays  = Math.min(REPLENISH_WINDOW_DAYS, Math.max(1, elapsedDays));
    const replenishRate = elapsedDays >= 1
      ? (birthsInWindow / windowDays).toFixed(2)
      : '—';
    document.getElementById('replenishment').textContent = `${replenishRate}/day`;
    const timeLabels = [[0, '🌙'], [0.2, '🌅'], [0.45, '☀️'], [0.7, '🌆'], [0.9, '🌙']];
    const tod = time.timeOfDay;
    const timeIcon = [...timeLabels].filter(([t]) => tod >= t).pop()?.[1] ?? '☀️';
    const todHours = tod * 24;
    const hh = Math.floor(todHours).toString().padStart(2, '0');
    const mm = Math.floor((todHours % 1) * 60).toString().padStart(2, '0');

    document.getElementById('world-day').textContent     = `Day ${time.day}`;
    document.getElementById('world-season').textContent  = time.season;
    document.getElementById('world-time').textContent    = `${timeIcon} ${hh}:${mm}`;
    document.getElementById('world-weather').textContent = weather.label;
    document.getElementById('world-temp').textContent    = weather.tempLabel;

    // ── Game over detection ───────────────────────────────────────────
    if (!gameOver && agents.length > 0 && alive === 0) {
      gameOver = true;
      historyLog.add('death', 'Civilization has fallen — all people are gone', time.day);
      const discovered = conceptGraph.getDiscoveredConcepts(); // no filter: count all ever discovered
      document.getElementById('game-over-stats').innerHTML =
        `<div>Lasted <strong>Day ${time.day}</strong> — ${time.season}</div>` +
        `<div>Peak population <strong>${agents.length}</strong></div>` +
        `<div>Discoveries <strong>${discovered.length}</strong></div>`;
      document.getElementById('game-over').classList.remove('hidden');
      gameOverAutoResetId = setTimeout(resetWorld, 30000);

      stats.gameOvers++;
      stats.totalBirths += birthGameTimes.length;
      stats.longestSurvival = Math.max(stats.longestSurvival, time.day);
      stats.peakPopulation = Math.max(stats.peakPopulation, agents.length);
      stats.bestDiscoveries = Math.max(stats.bestDiscoveries, discovered.length);
      saveStats();
    }

    const discovered = conceptGraph.getDiscoveredConcepts(aliveIds);
    const list = document.getElementById('concepts-list');
    const MAX_VISIBLE = 3;
    if (discovered.length === 0) {
      list.innerHTML = '<em>None yet...</em>';
    } else {
      const recent = discovered.slice(-MAX_VISIBLE);
      let html = recent.map(c =>
        `<div class="concept-item">
          <span class="concept-dot"></span>
          <span>${c.icon ?? ''} ${c.name}</span>
          <span class="concept-spread">${c.knownCount}/${alive}</span>
        </div>`
      ).join('');
      if (discovered.length > MAX_VISIBLE) {
        html += `<div class="discoveries-view-all" id="discoveries-view-all">View all (${discovered.length})</div>`;
      }
      list.innerHTML = html;
    }
    // Cache for modal
    window._lastDiscovered = discovered;
    window._lastAlive = alive;

    if (selectedAgent && selectedAgent.health > 0) {
      updateInfoPanel(selectedAgent);
    } else if (selectedTile && world.getTile(selectedTile.x, selectedTile.z)) {
      updateTileInfoPanel(world.getTile(selectedTile.x, selectedTile.z));
    }
    } catch (e) {
      console.error('[World] HUD update failed', e);
    }
  }

  const TILE_LABELS = {
    [TileType.DEEP_WATER]: { icon: '🌊', name: 'Deep Water' },
    [TileType.WATER]:    { icon: '🌊', name: 'Water' },
    [TileType.BEACH]:    { icon: '🏖️', name: 'Beach' },
    [TileType.GRASS]:    { icon: '🌿', name: 'Grassland' },
    [TileType.WOODLAND]: { icon: '🌳', name: 'Woodland' },
    [TileType.DESERT]:   { icon: '🏜️', name: 'Desert' },
    [TileType.FOREST]:   { icon: '🌲', name: 'Forest' },
    [TileType.STONE]:    { icon: '🪨', name: 'Stone' },
    [TileType.MOUNTAIN]: { icon: '⛰️', name: 'Mountain' },
  };

  const TILE_FEATURES = {
    [TileType.DEEP_WATER]: 'Open ocean. Deep fish patrol these waters. Requires Sailing to cross.',
    [TileType.WATER]:    'Coastal water. Shallow fish swim here. Requires Sailing to cross.',
    [TileType.BEACH]:    'Sandy shore between land and sea. Crabs scuttle along the waterline.',
    [TileType.GRASS]:    'Berries, sheep, and pigs. Good for gathering food.',
    [TileType.WOODLAND]: 'Lightly wooded land. Herbs and mushrooms grow here. Good for foraging.',
    [TileType.DESERT]:   'Arid, sun-baked land. Little grows here — harsh but traversable.',
    [TileType.FOREST]:   'Trees and wild game. Rich in food and resources.',
    [TileType.STONE]:    'Rocks and clay. Good for stone tools and pottery.',
    [TileType.MOUNTAIN]: 'Peaks and snow. Requires Mountain Climbing to traverse.',
  };

  function updateTileInfoPanel(tile) {
    if (!tile) return;
    const info = TILE_LABELS[tile.type] ?? { icon: '', name: tile?.type ?? '?' };
    const features = TILE_FEATURES[tile.type] ?? '';
    let resourceHtml = '';
    if (tile.type === TileType.GRASS || tile.type === TileType.WOODLAND || tile.type === TileType.FOREST) {
      const pct = Math.round(tile.resource * 100);
      resourceHtml = `
        <div class="info-row" style="margin-top:10px">
          <span class="info-label">Food</span>
          <div class="info-bar-wrap"><div class="info-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }
    // Ground items on this tile
    let groundHtml = '';
    const groundItems = world.tileItems?.getItems(tile.x, tile.z) ?? [];
    if (groundItems.length > 0) {
      groundHtml = `<div style="margin-top:8px;font-size:11px;opacity:.7">Items on ground:</div>` +
        groundItems.map(g => {
          const def = itemDefs.get(g.itemId);
          return `<div style="font-size:12px;margin-top:2px">${def?.icon ?? '•'} ${def?.name ?? g.itemId} ×${g.quantity}</div>`;
        }).join('');
    }
    document.getElementById('info-content').innerHTML = `
      <div class="info-name">${info.icon} ${info.name}</div>
      <div class="info-state" style="opacity:.7;font-size:12px">Tile (${tile.x}, ${tile.z})</div>
      <div style="margin-top:10px;font-size:12px;opacity:.85">${features}</div>
      ${resourceHtml}
      ${groundHtml}
    `;
  }

  function updateInfoPanel(agent) {
    if (!agent) return;
    const hunger = agent.needs?.hunger ?? 0;
    const energy = agent.needs?.energy ?? 0;
    const hCol = hunger < 0.3 ? 'crit' : hunger < 0.6 ? 'warn' : '';
    const eCol = energy < 0.3 ? 'crit' : energy < 0.6 ? 'warn' : '';
    const concepts = [...agent.knowledge].map(id => {
      const c = conceptGraph.concepts.get(id);
      return c ? `<span class="info-tag">${c.icon ?? ''} ${c.name}</span>` : '';
    }).join('');

    document.getElementById('info-content').innerHTML = `
      <div class="info-name">${agent.name}</div>
      <div class="info-state">${(agent.state || 'wandering').charAt(0).toUpperCase() + (agent.state || 'wandering').slice(1)}</div>
      <div style="margin-top:10px">
        <div class="info-row">
          <span class="info-label">Hunger</span>
          <div class="info-bar-wrap"><div class="info-bar-fill ${hCol}" style="width:${hunger * 100}%"></div></div>
        </div>
        <div class="info-row">
          <span class="info-label">Energy</span>
          <div class="info-bar-wrap"><div class="info-bar-fill ${eCol}" style="width:${energy * 100}%"></div></div>
        </div>
        <div class="info-row">
          <span class="info-label">Age</span>
          <span style="font-size:11px;opacity:.5">${Math.floor(agent.age)}s / ${Math.floor(agent.lifeExpectancy)}s ${agent.isAdult ? '' : '· juvenile'}${agent.ageBonus > 0 ? ` · +${Math.round(agent.ageBonus * 100)}%` : ''}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Curiosity</span>
          <span style="font-size:11px;opacity:.5">${(agent.curiosity * 100).toFixed(0)}%</span>
        </div>
        ${agent.task ? `<div class="info-row"><span class="info-label">Task</span><span class="info-tag">${Agent.TASKS[agent.task]?.icon ?? '•'} ${Agent.TASKS[agent.task]?.name ?? agent.task}</span></div>` : ''}
      </div>
      ${agent.inventory.stacks.length > 0 ? `
        <div style="margin-top:8px;font-size:11px;opacity:.7">Inventory (${agent.inventory.currentWeight(itemDefs).toFixed(1)}/${agent.inventory.maxWeight.toFixed(0)})</div>
        <div style="margin-top:2px">${agent.inventory.stacks.map(s => {
          const d = itemDefs.get(s.itemId);
          return `<span class="info-tag">${d?.icon ?? '•'} ${d?.name ?? s.itemId} ×${s.quantity}</span>`;
        }).join('')}</div>
      ` : ''}
      ${concepts ? `<div class="info-tags">${concepts}</div>` : '<div style="opacity:.3;font-size:12px;margin-top:10px">No discoveries yet</div>'}
    `;
  }

  // ── Notifications (max 3 per type, Environmental vs Social) ───────────
  const MAX_NOTIFICATIONS_PER_TYPE = 3;

  function showNotification(msg, type = 'env') {
    const container = document.getElementById(`notifications-${type}`);
    if (!container) return;
    // Spread into a real Array so length decreases as items are removed
    const items = [...container.querySelectorAll('.notification')];
    while (items.length >= MAX_NOTIFICATIONS_PER_TYPE) {
      items.shift().remove();
    }
    const el = document.createElement('div');
    el.className = `notification notification-${type}`;
    el.textContent = msg;
    container.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // ── Game loop ──────────────────────────────────────────────────────────
  let lastTimestamp = null;

  function frame(timestamp) {
    requestAnimationFrame(frame);
    try {
    const realDelta = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
    lastTimestamp = timestamp;

    const delta = time.update(realDelta);

    if (delta > 0) {
      // Update weather simulation — notify on significant changes
      const prevWeather = weather.current;
      weather.update(delta, time.season);
      if (weather.current !== prevWeather) {
        if (weather.current === 'STORM')  showNotification('A storm rolls in...', 'env');
        if (weather.current === 'RAIN')   showNotification('Rain begins to fall.', 'env');
        if (weather.current === 'CLEAR' && (prevWeather === 'STORM' || prevWeather === 'RAIN'))
          showNotification('The skies clear.', 'env');
      }

      // Lightning strikes during storms — can set forest on fire
      if (weather.current === 'STORM') {
        lightningCooldown -= delta;
        if (lightningCooldown <= 0) {
          lightningCooldown = 35 + Math.random() * 25;
          const forestTiles = world.getTilesOfType(TileType.FOREST);
          if (forestTiles.length > 0) {
            const tile = forestTiles[Math.floor(Math.random() * forestTiles.length)];
            const key = `${tile.x},${tile.z}`;
            world.naturalFires.set(key, { endTime: time.gameTime + 28 + Math.random() * 18 });
            wr.addFireLight(tile.x, tile.z);
            wr.addFlash(tile.x * TILE_SIZE + TILE_SIZE / 2, tile.z * TILE_SIZE + TILE_SIZE / 2, 0xffcc44);
            showNotification('Lightning strikes the forest!', 'env');
          }
        }
      }
      // Prune expired natural fires
      for (const [key, data] of [...world.naturalFires.entries()]) {
        if (time.gameTime >= data.endTime) {
          world.naturalFires.delete(key);
          const [tx, tz] = key.split(',').map(Number);
          wr.removeFireLight(tx, tz);
        }
      }

      // Regenerate tile food resources (season-aware)
      world.updateResources(delta, time.season, itemDefs.size > 0 ? itemDefs : null);

      // Tick world ecology systems
      world.updateCutTrees(delta);
      world.updateChickenNests(delta);
      world.updateCows(delta);
      world.updateGlaciers(delta, weather.temperature ?? 20);
      world.updateDomestication(delta, buildingRenderer?.buildings ?? []);

      // Tick wild horse simulation
      for (const horse of horses) horse.tick(delta, world, horses);

      // Handle agent-lit campfires
      if (world.campfireEvents?.length) {
        for (const evt of world.campfireEvents) {
          const key = `${evt.tx},${evt.tz}`;
          if (!world.naturalFires.has(key)) {
            world.naturalFires.set(key, { endTime: time.gameTime + 40 + Math.random() * 20 });
            wr.addFireLight(evt.tx, evt.tz);
            showNotification(`${evt.agentName} lights a fire to keep warm.`, 'env');
          }
        }
        world.campfireEvents.length = 0;
      }

      const wMult = weather.energyDrainMult;
      for (const agent of agents) {
        if (agent?.health > 0) {
          try {
            agent.tick(delta, world, agents, conceptGraph, wMult, itemDefs.size > 0 ? itemDefs : null, time.season);
          } catch (e) {
            console.error('[World] Agent tick failed', agent?.id, e);
          }
        }
      }

      // Handle simulation events
      for (const evt of conceptGraph.drainEvents()) {
        const concept = conceptGraph.concepts.get(evt.conceptId);
        const cName = concept ? `${concept.icon ?? ''} ${concept.name}` : evt.conceptId;

        if (evt.type === 'discovery') {
          showNotification(`${evt.agentName} discovered ${cName}!`, 'social');
          historyLog.add('discovery', `${evt.agentName} discovered ${cName}`, time.day);
          if (evt.conceptId === 'organisation') {
            const agent = agents.find(a => a.id === evt.agentId);
            if (agent) {
              agent._adoptTask(agents);
              const taskInfo = agent.task && Agent.TASKS[agent.task] ? Agent.TASKS[agent.task] : null;
              if (taskInfo) showNotification(`${evt.agentName} has taken up the role of ${taskInfo.name}`, 'social');
            }
          }
          // Flash at agent location
          const agent = agents.find(a => a.id === evt.agentId);
          if (agent) {
            const wx = agent.x * 2;
            const wz = agent.z * 2;
            wr.addFlash(wx, wz, 0xff8800);
          }
        }
        // Spread events are silent (too frequent to notify)
      }

      // Handle births
      const hasAgriculture = agents.some(a => a.health > 0 && a.knowledge.has('agriculture'));
      const maxPop = Number(maxPopSlider?.value ?? 100);
      const carryingCapacity = Math.min(maxPop, Math.floor(world.getCarryingCapacity() * (hasAgriculture ? 1.25 : 1)));
      for (const evt of conceptGraph.drainBirthEvents()) {
        const alive = agents.filter(a => a.health > 0).length;
        if (alive >= carryingCapacity) continue;

        // Find a walkable spawn tile near the birth position
        let bx = evt.x, bz = evt.z;
        if (!world.isWalkable(Math.floor(bx), Math.floor(bz))) {
          const tile = world.findNearest(Math.floor(bx), Math.floor(bz), [TileType.GRASS, TileType.FOREST], 4);
          if (!tile) continue;
          bx = tile.x + 0.5;
          bz = tile.z + 0.5;
        }

        const child = new Agent(bx, bz);
        agents.push(child);
        ar.addAgent(child);
        birthGameTimes.push(time.gameTime);
        showNotification(`${evt.parentName} has a child — ${child.name}`, 'social');
        historyLog.add('birth', `${evt.parentName} has a child — ${child.name}`, time.day);
      }
    }

    // ── Fire warmth & light at night (CAD-301) ──────────────────────────
      const isNight = time.timeOfDay > 0.75 || time.timeOfDay < 0.25;
      if (isNight && world.naturalFires.size > 0) {
        // Boost fire light intensity at night
        if (wr._fireLights?.size) {
          for (const { light } of wr._fireLights.values()) {
            light.intensity = Math.max(light.intensity, 2.8);
          }
        }
        // Agents near fires get warmth bonus (energy recovery)
        for (const agent of agents) {
          if (agent.health <= 0) continue;
          for (const key of world.naturalFires.keys()) {
            const [fx, fz] = key.split(',').map(Number);
            const dist = Math.hypot(agent.x - fx, agent.z - fz);
            if (dist < 4) {
              agent.needs.energy = Math.min(1, (agent.needs.energy ?? 0) + 0.0003 * delta);
              break; // one fire bonus is enough
            }
          }
        }
        // Slight ambient boost when fires exist at night
        if (wr._hemi) {
          wr._hemi.intensity = Math.max(wr._hemi.intensity, 0.45);
        }
      }

    // Rendering always runs (for smooth camera)
    wr.setTimeOfDay(time.timeOfDay);
    wr.setWeather(weather.meta);
    terrainRenderer.updateAnimals(delta > 0 ? delta : 0);
    terrainRenderer.updateVegetation(world);
    ar.update();
    buildingRenderer.checkAgents(agents);
    horseRenderer?.update();
    sheepRenderer?.update(delta > 0 ? delta : 0);
    highlandCowRenderer?.update(delta > 0 ? delta : 0);
    const isSunny = !weather.isRaining && !weather.isStorm;
    butterflyRenderer?.update(delta > 0 ? delta : 0, isSunny);
    beeRenderer?.update(delta > 0 ? delta : 0, isSunny);
    flowerRenderer?.update(delta > 0 ? delta : 0, time.season);
    wr.updateRain(realDelta, weather.isRaining, weather.isStorm);
    minimap.update(agents);
    wr.render();
    updateHUD();
    } catch (e) {
      const msg = e?.message || e?.toString?.() || 'Game loop error';
      showError(msg, e);
      console.error('[World] Frame error stack:', e?.stack);
      setTimeout(hideError, 8000);
    }
  }

  requestAnimationFrame(frame);
  } catch (e) {
    showError('Failed to initialize', e);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) loadingText.textContent = 'Initialization failed. Check console.';
    return;
  }
}

init().catch(e => showError('Init failed', e));
