/**
 * SimulationWorker.js
 *
 * Owns the authoritative simulation state. Runs World.tick + all system ticks
 * on a background thread so the main thread only handles rendering + input.
 *
 * Messages received:
 *   { type: 'INIT',  seed, agentCount, conceptsData }
 *   { type: 'TICK',  delta, inputs }
 *   { type: 'RESET', seed, agentCount }
 *
 * Messages sent:
 *   { type: 'INIT_COMPLETE', fullTiles, worldWidth, worldHeight }
 *   { type: 'STATE', agents, tileChanges, events, worldStats, fullTileSync }
 *   { type: 'ERROR', message }
 */

import { World, TileType, WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';
import { Agent } from '../simulation/Agent.js';
import { ConceptGraph } from '../simulation/ConceptGraph.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { WeatherSystem } from '../systems/WeatherSystem.js';
import { DisasterSystem } from '../systems/DisasterSystem.js';
import { EcologySystem } from '../systems/EcologySystem.js';
import { ConflictSystem } from '../systems/ConflictSystem.js';
import { SettlementSystem } from '../systems/SettlementSystem.js';
import { LineageTracker } from '../systems/LineageTracker.js';
import { Achievements } from '../systems/Achievements.js';
import { WildHorse } from '../simulation/WildHorse.js';
import { Predator } from '../simulation/Predator.js';

const WILD_HORSE_COUNT = 4;
const PREDATOR_COUNT = 3;

// ── Simulation state (module-level singletons) ──────────────────────────────

let world = null;
let agents = [];
let conceptGraph = null;
let time = null;
let weather = null;
let disasterSystem = null;
let ecologySystem = null;
let settlementSystem = null;
let lineageTracker = null;
let achievements = null;
let horses = [];
let predators = [];
let itemDefs = new Map();
let lightningCooldown = 0;

// Pending events to flush each tick
let pendingEvents = [];

// ── Tile-change tracking ─────────────────────────────────────────────────────

let _prevTileSnapshot = null;

function snapshotTileTypes() {
  const snap = [];
  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      snap.push(world.tiles[z][x].type);
    }
  }
  return snap;
}

function diffTiles(prev, next) {
  // Both prev and next are flat 1D arrays of tile type strings from snapshotTileTypes()
  const changes = [];
  let i = 0;
  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      if (prev[i] !== next[i]) {
        changes.push({ x, z, type: next[i] });
      }
      i++;
    }
  }
  return changes;
}

// ── Build agent state payload ────────────────────────────────────────────────

function buildAgentState() {
  return agents.map(a => ({
    id: a.id,
    x: a.x,
    z: a.z,
    state: a.state,
    energy: a.needs?.energy ?? 0,
    hunger: a.needs?.hunger ?? 0,
    health: a.health,
    age: a.age,
    role: a.role || null,
    task: a.task || null,
    isDead: a.isDead || a.health <= 0,
    facingX: a.facingX,
    facingZ: a.facingZ,
    discoveryFlash: a.discoveryFlash,
    speechBubble: a.speechBubble,
    lifeStage: a.lifeStage,
    knowledge: [...a.knowledge],
    faction: a.faction || null,
    name: a.name,
    selected: a.selected,
  }));
}

function buildWorldStats() {
  const tideLevel = weather?._totalTime
    ? Math.sin((weather._totalTime / 900) * Math.PI * 2)
    : 0;
  return {
    day: time.day,
    season: time.season,
    timeOfDay: time.timeOfDay,
    gameTime: time.gameTime,
    population: agents.filter(a => !a.isDead && a.health > 0).length,
    weather: weather?.current || 'CLEAR',
    weatherLabel: weather?.label || '☀️ Clear',
    weatherMeta: weather?.meta || null,
    tideLevel,
    disasterActive: disasterSystem?.active || null,
    settlements: settlementSystem?.settlements?.length ?? 0,
  };
}

// ── Initialise simulation ────────────────────────────────────────────────────

function initSim(seed, agentCount, conceptsData) {
  world = new World(seed);
  world.naturalFires = new Map();
  lightningCooldown = 0;

  conceptGraph = new ConceptGraph(conceptsData);

  agents = world.getSpawnPoints(agentCount).map(p => new Agent(p.x, p.z));
  agents.forEach(a => ConflictSystem.assignFaction(a));

  time = new TimeSystem();
  weather = new WeatherSystem(world.width, world.height);
  weather._totalTime = 0;

  disasterSystem = new DisasterSystem();
  ecologySystem = new EcologySystem();
  settlementSystem = new SettlementSystem();
  lineageTracker = new LineageTracker();
  achievements = new Achievements();

  horses = world.getWildHorseSpawnPoints(WILD_HORSE_COUNT).map(p => new WildHorse(p.x, p.z));
  predators = world.getWildHorseSpawnPoints(PREDATOR_COUNT).map(
    p => new Predator(p.x, p.z, Math.random() < 0.7 ? 'wolf' : 'bear')
  );

  pendingEvents = [];
  _prevTileSnapshot = snapshotTileTypes();
}

// ── Tick ─────────────────────────────────────────────────────────────────────

function runTick(realDelta, inputs) {
  const delta = time.update(realDelta);

  if (delta > 0) weather._totalTime = (weather._totalTime ?? 0) + delta;

  if (delta > 0) {
    // Weather
    const prevWeather = weather.current;
    weather.update(delta, time.season);
    if (weather.current !== prevWeather) {
      if (weather.current === 'STORM')
        pendingEvents.push({ type: 'weather', message: 'A storm rolls in...', x: 0, z: 0 });
      if (weather.current === 'RAIN')
        pendingEvents.push({ type: 'weather', message: 'Rain begins to fall.', x: 0, z: 0 });
      if (weather.current === 'CLEAR' && (prevWeather === 'STORM' || prevWeather === 'RAIN'))
        pendingEvents.push({ type: 'weather', message: 'The skies clear.', x: 0, z: 0 });
    }

    // Lightning
    if (weather.current === 'STORM') {
      lightningCooldown -= delta;
      if (lightningCooldown <= 0) {
        lightningCooldown = 35 + Math.random() * 25;
        const forestTiles = world.getTilesOfType(TileType.FOREST);
        if (forestTiles.length > 0) {
          const tile = forestTiles[Math.floor(Math.random() * forestTiles.length)];
          const key = `${tile.x},${tile.z}`;
          world.naturalFires.set(key, { endTime: time.gameTime + 28 + Math.random() * 18 });
          pendingEvents.push({ type: 'lightning', message: 'Lightning strikes the forest!', x: tile.x, z: tile.z });
        }
      }
    }

    // Prune expired natural fires
    for (const [key, data] of [...world.naturalFires.entries()]) {
      if (time.gameTime >= data.endTime) {
        world.naturalFires.delete(key);
        const [tx, tz] = key.split(',').map(Number);
        pendingEvents.push({ type: 'fire_end', message: '', x: tx, z: tz });
      }
    }

    // World ecology
    world.updateResources(delta, time.season, itemDefs.size > 0 ? itemDefs : null);
    if (world.tileItems && itemDefs.size > 0) {
      world.tileItems.tickSpoilage(delta, itemDefs, disasterSystem.getSpoilageMult());
    }
    ecologySystem.tick(time.day, world, weather);
    world.updateCutTrees(delta);
    world.updateChickenNests(delta);
    world.updateCows(delta);
    world.updateGlaciers(delta, weather.temperature ?? 20);
    // Note: domestication uses building positions from renderer — skip in worker
    // (buildings are renderer-side; agent knowledge-gated effects still apply)

    // Wild horses + predators
    for (const horse of horses) horse.tick(delta, world, horses);
    for (const pred of predators) pred.tick(delta, agents, world, []);

    // Campfire events
    if (world.campfireEvents?.length) {
      for (const evt of world.campfireEvents) {
        const key = `${evt.tx},${evt.tz}`;
        if (!world.naturalFires.has(key)) {
          world.naturalFires.set(key, { endTime: time.gameTime + 40 + Math.random() * 20 });
          pendingEvents.push({
            type: 'campfire',
            message: `${evt.agentName} lights a fire to keep warm.`,
            x: evt.tx,
            z: evt.tz,
          });
        }
      }
      world.campfireEvents.length = 0;
    }

    // Fire warmth at night
    const isNight = time.timeOfDay > 0.75 || time.timeOfDay < 0.25;
    if (isNight && world.naturalFires.size > 0) {
      for (const agent of agents) {
        if (agent.health <= 0) continue;
        for (const key of world.naturalFires.keys()) {
          const [fx, fz] = key.split(',').map(Number);
          const dist = Math.hypot(agent.x - fx, agent.z - fz);
          if (dist < 4) {
            agent.needs.energy = Math.min(1, (agent.needs.energy ?? 0) + 0.0003 * delta);
            break;
          }
        }
      }
    }

    // Agent ticks
    for (const agent of agents) {
      if (agent?.health > 0) {
        try {
          const wMult = weather.energyDrainMultAt(agent.x, agent.z);
          agent.tick(delta, world, agents, conceptGraph, wMult, itemDefs.size > 0 ? itemDefs : null, time.season, null, time);
        } catch (e) {
          // swallow per-agent errors
        }
      }
    }

    // Concept graph events
    for (const evt of conceptGraph.drainEvents()) {
      const concept = conceptGraph.concepts.get(evt.conceptId);
      const cName = concept ? `${concept.icon ?? ''} ${concept.name}` : evt.conceptId;
      if (evt.type === 'discovery') {
        pendingEvents.push({
          type: 'discovery',
          message: `${evt.agentName} discovered ${cName}!`,
          x: evt.x ?? 0,
          z: evt.z ?? 0,
          agentId: evt.agentId,
          conceptId: evt.conceptId,
          conceptName: cName,
        });

        if (evt.conceptId === 'organisation') {
          const agent = agents.find(a => a.id === evt.agentId);
          if (agent) {
            agent._adoptTask(agents);
            const taskInfo = agent.task && Agent.TASKS[agent.task] ? Agent.TASKS[agent.task] : null;
            if (taskInfo) {
              pendingEvents.push({
                type: 'task_assigned',
                message: `${evt.agentName} has taken up the role of ${taskInfo.name}`,
                x: 0, z: 0,
                agentId: evt.agentId,
              });
            }
          }
        }
      }
    }

    // Birth events
    for (const evt of conceptGraph.drainBirthEvents()) {
      const alive = agents.filter(a => a.health > 0).length;
      // No carrying capacity check here — main thread enforces pop limit
      let bx = evt.x, bz = evt.z;
      if (!world.isWalkable(Math.floor(bx), Math.floor(bz))) {
        const tile = world.findNearest(Math.floor(bx), Math.floor(bz), [TileType.GRASS, TileType.FOREST], 4);
        if (!tile) continue;
        bx = tile.x + 0.5;
        bz = tile.z + 0.5;
      }

      const child = new Agent(bx, bz);
      ConflictSystem.assignFaction(child);

      if (evt.parentAId != null) {
        child.parents.push(evt.parentAId);
        const parentA = agents.find(a => a.id === evt.parentAId);
        if (parentA) parentA.children.push(child.id);
      }
      if (evt.parentBId != null) {
        child.parents.push(evt.parentBId);
        const parentB = agents.find(a => a.id === evt.parentBId);
        if (parentB) parentB.children.push(child.id);
      }
      if (evt.parentAPersonality && evt.parentBPersonality) {
        child.personality = Agent.inheritPersonality(
          { personality: evt.parentAPersonality },
          { personality: evt.parentBPersonality }
        );
      }

      agents.push(child);

      pendingEvents.push({
        type: 'birth',
        message: `${evt.parentName} has a child — ${child.name}`,
        x: bx, z: bz,
        agentId: child.id,
        agentName: child.name,
        parentId: evt.parentAId,
        parentAPersonality: evt.parentAPersonality,
        parentBPersonality: evt.parentBPersonality,
      });
    }

    // Disaster system
    disasterSystem.tick(delta, world, time.day, world.seed);
    if (disasterSystem.active && disasterSystem.active._justActivated) {
      pendingEvents.push({
        type: 'disaster',
        message: `Disaster: ${disasterSystem.active.type}`,
        x: 0, z: 0,
      });
    }

    // ConflictSystem
    ConflictSystem.updateCooldowns(agents, delta);

    // SettlementSystem
    settlementSystem.tick(delta, agents, world, time.day);
    settlementSystem.updateMembership(agents);
    for (const s of settlementSystem.settlements) {
      settlementSystem.nameSettlement(s, agents);
    }
    settlementSystem.syncKnowledgePools(agents);
    for (const s of settlementSystem.settlements) {
      if (!s._prevMemberIds) s._prevMemberIds = new Set(s.memberIds);
      for (const agentId of s.memberIds) {
        if (!s._prevMemberIds.has(agentId)) {
          const joiner = agents.find(a => a.id === agentId);
          if (joiner) settlementSystem.onAgentJoinsSettlement(joiner, s);
        }
      }
      s._prevMemberIds = new Set(s.memberIds);
    }

    // Achievements
    const aliveCount = agents.filter(a => a.health > 0).length;
    const newAchievements = achievements.tick({ agents, conceptGraph, day: time.day, population: aliveCount });
    for (const a of newAchievements) {
      pendingEvents.push({
        type: 'achievement',
        message: `${a.icon} Achievement unlocked: ${a.title}`,
        x: 0, z: 0,
      });
    }

    // LineageTracker
    for (const evt of (conceptGraph._pendingLineageEvents ?? [])) {
      lineageTracker.record(evt.conceptId, evt.agent, time.day);
    }
    if (conceptGraph._pendingLineageEvents) conceptGraph._pendingLineageEvents.length = 0;
  }

  // Diff tiles
  const newSnap = snapshotTileTypes();
  const tileChanges = diffTiles(_prevTileSnapshot, newSnap);
  _prevTileSnapshot = newSnap;

  // Flush events
  const events = pendingEvents.splice(0);

  self.postMessage({
    type: 'STATE',
    agents: buildAgentState(),
    tileChanges,
    events,
    worldStats: buildWorldStats(),
    fullTileSync: false,
    naturalFires: [...world.naturalFires.entries()].map(([key, data]) => ({ key, endTime: data.endTime })),
  });
}

// ── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e) => {
  const data = e.data;

  try {
    if (data.type === 'INIT') {
      const { seed, agentCount, conceptsData, itemsData } = data;

      if (itemsData) {
        itemDefs = new Map(itemsData.map(item => [item.id, item]));
      }

      initSim(seed, agentCount, conceptsData);

      // Send INIT_COMPLETE with full tile data
      self.postMessage({
        type: 'INIT_COMPLETE',
        fullTiles: world.tiles.flat(),
        worldWidth: world.width,
        worldHeight: world.height,
        seed: world.seed,
        agentState: buildAgentState(),
        worldStats: buildWorldStats(),
      });
    }

    else if (data.type === 'TICK') {
      if (!world) return;
      runTick(data.delta, data.inputs ?? []);
    }

    else if (data.type === 'RESET') {
      const { seed, agentCount, conceptsData } = data;
      initSim(seed ?? Math.floor(Math.random() * 9999), agentCount, conceptsData);
      self.postMessage({
        type: 'INIT_COMPLETE',
        fullTiles: world.tiles.flat(),
        worldWidth: world.width,
        worldHeight: world.height,
        seed: world.seed,
        agentState: buildAgentState(),
        worldStats: buildWorldStats(),
      });
    }

    else if (data.type === 'SET_SPEED') {
      if (time) time.setSpeed(data.speed);
    }

    else if (data.type === 'SET_ITEM_DEFS') {
      itemDefs = new Map(data.itemsData.map(item => [item.id, item]));
    }

    else if (data.type === 'AGENT_DRAG') {
      // Main thread sends drag updates for agent repositioning
      const { agentId, x, z } = data;
      const agent = agents.find(a => a.id === agentId);
      if (agent) {
        agent.x = x;
        agent.z = z;
        agent.targetX = x;
        agent.targetZ = z;
      }
    }

  } catch (err) {
    self.postMessage({ type: 'ERROR', message: err?.message ?? String(err) });
  }
};
