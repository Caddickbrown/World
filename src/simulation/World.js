import { TileItems } from './TileItems.js';
import { SpatialGrid } from './SpatialGrid.js';

export const TILE_SIZE = 2;
export const WORLD_WIDTH = 32;
export const WORLD_HEIGHT = 32;

export const TileType = {
  DEEP_WATER: 'DEEP_WATER',
  WATER:    'WATER',
  BEACH:    'BEACH',
  GRASS:    'GRASS',
  WOODLAND: 'WOODLAND',
  FOREST:   'FOREST',
  DESERT:   'DESERT',
  STONE:    'STONE',
  MOUNTAIN: 'MOUNTAIN',
  GLACIER:  'GLACIER',
};

export class World {
  constructor(seed = Math.floor(Math.random() * 9999)) {
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.seed = seed;
    this.tiles = this._generate();
    this._generateGlaciers();
    this._generateRivers();
    this._generateCaves();
    this.glacierData = this._initGlaciers();
    /** "x,z" → { countdown: gameSeconds } for felled trees awaiting regrowth */
    this.cutTrees = new Map();
    /** "x,z" → { eggs: number, layTimer: gameSeconds } — populated by TerrainRenderer */
    this.chickenNests = null;
    /** Array of { x, z, milk, milkTimer } — populated by HighlandCowRenderer, positions updated each frame */
    this.cows = [];
    /** Ground items per tile (Dan's inventory system) */
    this.tileItems = new TileItems();
    /** Active predators in the world */
    this.predators = [];
    /** Spatial index for fast agent proximity queries */
    this.spatialGrid = new SpatialGrid(WORLD_WIDTH, WORLD_HEIGHT, 4);
    /** Timer for flora slow tick (tracked by main.js) */
    this.floraSlowTimer = 0;
  }

  /**
   * Mark a forest/woodland tile as felled. Returns true if the cut was registered.
   * Regrowth takes 90–150 game-seconds (slow — trees are a long-term resource).
   */
  cutTree(x, z) {
    const tile = this.getTile(x, z);
    if (!tile) return false;
    if (tile.type !== TileType.FOREST && tile.type !== TileType.WOODLAND) return false;
    const key = `${tile.x},${tile.z}`;
    if (this.cutTrees.has(key)) return false; // already felled
    tile.treeCut = true;
    this.cutTrees.set(key, { countdown: 90 + Math.random() * 60 });
    return true;
  }

  /** Called once by TerrainRenderer after chickens are placed. */
  initChickenNests(tiles) {
    this.chickenNests = new Map();
    for (const { x, z } of tiles) {
      this.chickenNests.set(`${x},${z}`, {
        eggs: 0,
        layTimer: 10 + Math.random() * 20, // stagger initial lay times
      });
    }
  }

  /** Tick egg-laying timers. Each nest produces up to 3 eggs, one per ~20–35 game-sec. */
  updateChickenNests(delta) {
    if (!this.chickenNests) return;
    for (const nest of this.chickenNests.values()) {
      if (nest.eggs >= 3) continue;
      nest.layTimer -= delta;
      if (nest.layTimer <= 0) {
        nest.eggs++;
        nest.layTimer = 20 + Math.random() * 15;
      }
    }
  }

  /** Tick cow milk refill timers. Each cow refills ~0.5 milk every 30–60 game-sec. */
  updateCows(delta) {
    for (const cow of this.cows) {
      if (cow.milk >= 1) continue;
      cow.milkTimer -= delta;
      if (cow.milkTimer <= 0) {
        cow.milk = Math.min(1, cow.milk + 0.5);
        cow.milkTimer = 30 + Math.random() * 30;
      }
    }
  }

  /**
   * Domestication feedback: animals near buildings produce resources faster.
   * Cows within 4 tiles of a building drop milk items every 45s.
   * Chicken nests within 4 tiles of a building get a 1.3x egg rate bonus.
   * @param {number} delta - game-seconds since last tick
   * @param {Array} buildings - array of building objects with { x, z }
   */
  updateDomestication(delta, buildings) {
    if (!buildings || buildings.length === 0) return;

    const nearBuilding = (px, pz) =>
      buildings.some(b => Math.hypot(b.x - px, b.z - pz) <= 4);

    // Cows: produce milk item every 45s when near a building
    for (const cow of this.cows) {
      if (!nearBuilding(cow.x, cow.z)) continue;
      if (cow.productionTimer === undefined) cow.productionTimer = 45;
      cow.productionTimer -= delta;
      if (cow.productionTimer <= 0) {
        cow.productionTimer = 45;
        const tx = Math.floor(cow.x);
        const tz = Math.floor(cow.z);
        this.tileItems.add(tx, tz, 'milk', 1);
      }
    }

    // Chicken nests: 1.3x egg rate when near a building
    if (this.chickenNests) {
      for (const [key, nest] of this.chickenNests) {
        const [nx, nz] = key.split(',').map(Number);
        if (!nearBuilding(nx, nz)) continue;
        if (nest.eggs >= 3) continue;
        // Apply bonus tick (0.3x extra on top of normal updateChickenNests)
        nest.layTimer -= delta * 0.3;
      }
    }
  }

  /** Tick regrowth countdowns. Call once per simulation step with game-time delta. */
  updateCutTrees(delta) {
    for (const [key, data] of this.cutTrees) {
      data.countdown -= delta;
      if (data.countdown <= 0) {
        this.cutTrees.delete(key);
        const [x, z] = key.split(',').map(Number);
        const tile = this.getTile(x, z);
        if (tile) tile.treeCut = false;
      }
    }
  }

  /** Spawn a predator at a random walkable position. */
  spawnPredator(type = 'wolf') {
    const spawnPoints = this.getWildHorseSpawnPoints(1);
    if (spawnPoints.length === 0) return null;
    // Dynamically import to avoid circular deps at module level
    const predator = { type, x: spawnPoints[0].x, z: spawnPoints[0].z, health: 1.0, huntCooldown: 0, targetX: spawnPoints[0].x, targetZ: spawnPoints[0].z, wanderTimer: Math.random() * 3 };
    this.predators.push(predator);
    return predator;
  }

  /** Clear and rebuild the spatial grid with current agent positions. */
  updateSpatialGrid(agents) {
    this.spatialGrid.clear();
    for (const agent of agents) {
      if (agent.health > 0 && !agent.isDead) {
        this.spatialGrid.insert(agent);
      }
    }
  }

  // ── Procedural generation ─────────────────────────────────────────────

  // Deterministic per-tile pseudo-random (stable across redraws)
  _rng(x, z, offset = 0) {
    return Math.sin(x * 127.1 + z * 311.7 + offset * 74.5) * 0.5 + 0.5;
  }

  _noise(x, z) {
    const s = this.seed * 0.137;
    return (
      Math.sin(x * 0.18 + s)        * Math.cos(z * 0.14 + s * 1.71) * 0.45 +
      Math.sin(x * 0.35 + s * 2.13) * Math.cos(z * 0.29 + s * 0.63) * 0.30 +
      Math.sin(x * 0.72 + s * 0.54) * Math.cos(z * 0.61 + s * 1.23) * 0.15 +
      Math.cos(x * 0.11 + z * 0.16 + s * 1.87)                       * 0.25
    ) / 1.15;
  }

  _generate() {
    const tiles = [];
    for (let z = 0; z < this.height; z++) {
      tiles[z] = [];
      for (let x = 0; x < this.width; x++) {
        const n = this._noise(x, z);
        let type;
        if      (n < -0.22) type = TileType.WATER;
        else if (n < -0.08) type = TileType.BEACH;   // coastal strip
        else if (n <  0.18) type = TileType.GRASS;
        else if (n <  0.30) type = TileType.WOODLAND;
        else if (n <  0.52) type = TileType.FOREST;
        else if (n <  0.72) type = TileType.STONE;
        else                type = TileType.MOUNTAIN;

        // Desert: arid heat patches within flat terrain
        // Uses a large-scale secondary noise (different frequency + seed phase)
        if (type === TileType.GRASS || type === TileType.WOODLAND || type === TileType.FOREST) {
          const s = this.seed * 0.491;
          const arid = (
            Math.sin(x * 0.09 + s)        * Math.cos(z * 0.07 + s * 1.6) * 0.50 +
            Math.sin(x * 0.17 + s * 1.9)  * Math.cos(z * 0.13 + s * 0.5) * 0.30 +
            Math.cos(x * 0.05 + z * 0.08 + s * 1.2)                       * 0.20
          ) / 1.0 + 0.5; // range ≈ 0–1
          if (arid > 0.91) type = TileType.DESERT;
        }

        const baseElev = {
          WATER: 0.04, BEACH: 0.06, GRASS: 0.12, WOODLAND: 0.17, FOREST: 0.22,
          DESERT: 0.12, STONE: 0.32, MOUNTAIN: 1.5, GLACIER: 0.60,
        }[type];
        const elev = baseElev + (Math.sin(x * 3.7 + z * 2.3 + this.seed) * 0.5 + 0.5) * 0.06;

        const gatherable = type === TileType.GRASS || type === TileType.WOODLAND || type === TileType.FOREST;
        tiles[z][x] = { type, x, z, elevation: elev, resource: 1.0, depletionLevel: gatherable ? 0.0 : undefined };
      }
    }

    // Second pass: water tiles surrounded by water on all 4 sides become DEEP_WATER
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (tiles[z][x].type !== TileType.WATER) continue;
        const allWater = [[-1,0],[1,0],[0,-1],[0,1]].every(([dx, dz]) => {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) return true;
          const t = tiles[nz][nx].type;
          return t === TileType.WATER || t === TileType.DEEP_WATER;
        });
        if (allWater) tiles[z][x].type = TileType.DEEP_WATER;
      }
    }

    // Third pass: guarantee at least one tile of each base terrain type.
    const baseElevations = { WATER: 0.04, BEACH: 0.06, GRASS: 0.12, WOODLAND: 0.17, FOREST: 0.22, DESERT: 0.12, STONE: 0.32, MOUNTAIN: 1.5, GLACIER: 0.60 };
    const present = new Set();
    for (let z = 0; z < this.height; z++)
      for (let x = 0; x < this.width; x++)
        present.add(tiles[z][x].type);

    const forcePlacements = [
      { type: TileType.WATER,    x: 2,  z: 2  },
      { type: TileType.GRASS,    x: 14, z: 14 },
      { type: TileType.WOODLAND, x: 16, z: 14 },
      { type: TileType.FOREST,   x: 17, z: 14 },
      { type: TileType.STONE,    x: 14, z: 17 },
      { type: TileType.MOUNTAIN, x: 29, z: 29 },
    ];
    for (const { type, x, z } of forcePlacements) {
      if (!present.has(type)) {
        tiles[z][x].type = type;
        tiles[z][x].elevation = baseElevations[type];
        present.add(type);
      }
    }

    // Fourth pass: natural resource fields (herbs, mushrooms, reeds, flint)
    const hasAdj = (tx, tz, t) => {
      for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = tx+dx, nz = tz+dz;
        if (nx<0||nx>=this.width||nz<0||nz>=this.height) continue;
        if (tiles[nz][nx].type === t) return true;
      }
      return false;
    };
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = tiles[z][x];
        if (tile.type === TileType.WOODLAND) {
          if (this._rng(x, z, 301) < 0.30) tile.herbs = 1.0;
        }
        if (tile.type === TileType.FOREST) {
          if (this._rng(x, z, 301) < 0.45) tile.herbs     = 1.0;
          if (this._rng(x, z, 303) < 0.30) tile.mushrooms = 1.0;
        }
        if (tile.type === TileType.GRASS &&
            (hasAdj(x, z, TileType.WATER) || hasAdj(x, z, TileType.DEEP_WATER))) {
          if (this._rng(x, z, 302) < 0.35) tile.herbs = 1.0;
        }
        if (tile.type === TileType.STONE) {
          if (this._rng(x, z, 306) < 0.25) tile.flint = 1;
        }
      }
    }

    return tiles;
  }

  // ── Glaciers (tile-type generation) ──────────────────────────────────

  /**
   * Convert clusters of STONE tiles that are adjacent to MOUNTAIN tiles into GLACIER tiles.
   * Uses a seeded RNG so placement is deterministic per seed.
   * ~40% of qualifying STONE tiles become glaciers.
   */
  _generateGlaciers() {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.type !== TileType.STONE) continue;
        // Only convert STONE tiles that touch a MOUNTAIN tile (8-directional)
        const nearMountain = [-1, 0, 1].some(dz =>
          [-1, 0, 1].some(dx => {
            if (dx === 0 && dz === 0) return false;
            const nx = x + dx, nz = z + dz;
            if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) return false;
            return this.tiles[nz][nx].type === TileType.MOUNTAIN;
          })
        );
        if (nearMountain && this._rng(x, z, 500) < 0.40) {
          tile.type = TileType.GLACIER;
          tile.elevation = 0.60;
        }
      }
    }
  }

  // ── Rivers ────────────────────────────────────────────────────────────

  /**
   * Trace rivers from high-elevation tiles downhill toward water/beach.
   * Rivers are represented as an overlay flag (tile.river = true) rather than
   * replacing the tile type, so the underlying terrain (GRASS, STONE, etc.) is
   * preserved and traversal rules can still apply.
   *
   * Algorithm:
   *   1. Pick seed tiles on MOUNTAIN / STONE borders via seeded RNG (~8% chance).
   *   2. From each seed, walk to the lowest adjacent neighbour until we hit
   *      WATER, BEACH, or DEEP_WATER, or reach a maximum path length.
   *   3. Mark every visited tile with river = true.
   */
  _generateRivers() {
    const RIVER_SEED_CHANCE = 0.08;
    const MAX_RIVER_LENGTH  = 24;
    const TERMINAL_TYPES = new Set([TileType.WATER, TileType.DEEP_WATER, TileType.BEACH]);
    const BLOCKED_TYPES  = new Set([TileType.GLACIER, TileType.MOUNTAIN]);

    // Build an elevation map: higher noise value = higher ground
    // We use the raw noise value for flow direction (continuous, not bucketed)
    const elevAt = (x, z) => this._noise(x, z);

    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];

    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        // Seed rivers on MOUNTAIN and upper-STONE tiles
        if (tile.type !== TileType.MOUNTAIN && tile.type !== TileType.STONE) continue;
        if (this._rng(x, z, 400) >= RIVER_SEED_CHANCE) continue;

        // Trace downhill
        let cx = x, cz = z;
        for (let step = 0; step < MAX_RIVER_LENGTH; step++) {
          const currentTile = this.tiles[cz][cx];
          if (TERMINAL_TYPES.has(currentTile.type)) break;

          // Mark as river overlay
          currentTile.river = true;

          // Find steepest downhill neighbour
          const curElev = elevAt(cx, cz);
          let bestElev = curElev;
          let bestX = -1, bestZ = -1;

          for (const [dx, dz] of dirs) {
            const nx = cx + dx, nz = cz + dz;
            if (nx < 0 || nx >= this.width || nz < 0 || nz >= this.height) continue;
            const neighbour = this.tiles[nz][nx];
            if (BLOCKED_TYPES.has(neighbour.type)) continue;
            const nElev = elevAt(nx, nz);
            if (nElev < bestElev) {
              bestElev = nElev;
              bestX = nx;
              bestZ = nz;
            }
          }

          // No lower neighbour found — river ends (flat or local minimum)
          if (bestX === -1) break;

          cx = bestX;
          cz = bestZ;
        }
      }
    }
  }

  // ── Caves ─────────────────────────────────────────────────────────────

  /**
   * Mark ~10% of MOUNTAIN tiles as having a cave entrance.
   * Caves provide shelter: agents can sleep in them without a building.
   * The cave flag is tile.cave = true.
   */
  _generateCaves() {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.type !== TileType.MOUNTAIN) continue;
        if (this._rng(x, z, 450) < 0.10) {
          tile.cave = true;
          /** Caves are sheltered: agents can rest here without a building */
          tile.isShelter = true;
        }
      }
    }
  }

  // ── Glaciers (melt data) ──────────────────────────────────────────────

  _initGlaciers() {
    const data = new Map();
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[z][x].type !== TileType.GLACIER) continue;
        data.set(`${x},${z}`, { x, z, melt: 0 });
      }
    }
    return data;
  }

  /** Update glacier melt state. Positive temperature melts, negative refreezes. */
  updateGlaciers(delta, temperature) {
    const rate = (temperature / 25) * 0.00028;
    for (const g of this.glacierData.values()) {
      g.melt = Math.max(0, Math.min(1, g.melt + rate * delta));
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────

  getTile(x, z) {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    if (tx < 0 || tx >= this.width || tz < 0 || tz >= this.height) return null;
    return this.tiles[tz][tx];
  }

  /** Base walkability: used for spawning/birth. Blocks water, mountains, and glaciers regardless of knowledge. */
  isWalkable(x, z) {
    const tile = this.getTile(x, z);
    if (!tile) return false;
    return tile.type !== TileType.WATER
        && tile.type !== TileType.DEEP_WATER
        && tile.type !== TileType.MOUNTAIN
        && tile.type !== TileType.GLACIER;
  }

  /**
   * Knowledge-aware traversal check used by agent movement.
   * Sailing unlocks water, mountain_climbing unlocks mountains.
   * Rivers are passable but cost extra energy (handled by the caller via tile.river flag).
   * Glaciers are always impassable.
   */
  canTraverse(x, z, knowledge) {
    const tile = this.getTile(x, z);
    if (!tile) return false;
    if (tile.type === TileType.WATER || tile.type === TileType.DEEP_WATER) return knowledge.has('sailing');
    if (tile.type === TileType.MOUNTAIN) return knowledge.has('mountain_climbing');
    if (tile.type === TileType.GLACIER) return false;
    return true;
  }

  /**
   * Movement energy cost multiplier for a tile.
   * River tiles cost 1.8x energy without rope_bridge knowledge, 1.0x with it.
   */
  traversalCost(x, z, knowledge) {
    const tile = this.getTile(x, z);
    if (!tile) return 1.0;
    if (tile.river) return knowledge.has('rope_bridge') ? 1.0 : 1.8;
    return 1.0;
  }

  /** True if any of the 4 orthogonal neighbours is the given tile type */
  hasAdjacentType(x, z, type) {
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const t = this.getTile(x + dx, z + dz);
      if (t && t.type === type) return true;
    }
    return false;
  }

  /**
   * Regenerate food resources over time. Call each game-tick.
   * Faster in spring/summer, very slow in winter.
   * Optional third parameter (_itemDefs) is accepted but unused — kept for API compatibility.
   */
  updateResources(delta, season = 'Spring', _itemDefs = null) {
    const mult = { Spring: 1.5, Summer: 2.0, Autumn: 1.0, Winter: 0.35 }[season] ?? 1.0;
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.type === TileType.GRASS)    tile.resource = Math.min(1, tile.resource + 0.0020 * delta * mult);
        if (tile.type === TileType.WOODLAND) tile.resource = Math.min(1, tile.resource + 0.0016 * delta * mult);
        if (tile.type === TileType.FOREST)   tile.resource = Math.min(1, tile.resource + 0.0012 * delta * mult);
        if (tile.herbs     !== undefined)  tile.herbs     = Math.min(1, tile.herbs     + 0.0006 * delta * mult);
        if (tile.mushrooms !== undefined)  tile.mushrooms = Math.min(1, tile.mushrooms + 0.0008 * delta * mult);
        // flint does not regenerate
      }
    }
  }

  /** Tick depletion recovery on all tiles. Depletion recovers at 0.002 per game-second. */
  updateDepletion(delta) {
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (tile.depletionLevel !== undefined && tile.depletionLevel > 0) {
          tile.depletionLevel = Math.max(0, tile.depletionLevel - 0.002 * delta);
        }
      }
    }
  }

  /** True when a tile's depletion exceeds the exhaustion threshold. */
  static isDepleted(tile) {
    return tile.depletionLevel !== undefined && tile.depletionLevel > 0.7;
  }

  /** Returns a list of walkable spawn positions (tile centres) */
  getSpawnPoints(count) {
    const candidates = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[z][x].type === TileType.GRASS) {
          candidates.push({ x: x + 0.5, z: z + 0.5 });
        }
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, count);
  }

  /** Spawn positions on GRASS, WOODLAND, or FOREST (wild horses and butterflies stay off stone/water). */
  getWildHorseSpawnPoints(count) {
    const candidates = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const t = this.tiles[z][x].type;
        if (t === TileType.GRASS || t === TileType.WOODLAND || t === TileType.FOREST) {
          candidates.push({ x: x + 0.5, z: z + 0.5 });
        }
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates.slice(0, count);
  }

  /** Estimated carrying capacity from food-producing tiles (GRASS + WOODLAND + FOREST). */
  getCarryingCapacity() {
    const foodTiles = this.getTilesOfType([TileType.GRASS, TileType.WOODLAND, TileType.FOREST]).length;
    return Math.max(40, Math.floor(25 + foodTiles * 0.18));
  }

  /** Returns all tiles of the given type(s). Types can be string or array. */
  getTilesOfType(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const out = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.tiles[z][x];
        if (typeSet.has(tile.type)) out.push(tile);
      }
    }
    return out;
  }

  /** Find nearest tile of a given type within radius, from tile coords cx,cz.
   *  When multiple tiles tie for nearest, picks one at random to avoid biased drift. */
  findNearest(cx, cz, types, radius = 10) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    let best = null;
    let bestDist = Infinity;
    let tieCount = 0;
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > radius) continue;
        const tile = this.getTile(cx + dx, cz + dz);
        if (!tile || !typeSet.has(tile.type)) continue;
        if (dist < bestDist) {
          bestDist = dist;
          best = tile;
          tieCount = 1;
        } else if (dist === bestDist) {
          tieCount++;
          if (Math.random() < 1 / tieCount) best = tile;
        }
      }
    }
    return best;
  }


  // ── Flora slow tick ───────────────────────────────────────────────────

  /**
   * Flora slow tick — called every ~10 game-seconds.
   * Handles gradual regrowth and seasonal depletion.
   * @param {number} delta — game-seconds since last slow tick (≈10)
   * @param {string} season — 'spring' | 'summer' | 'autumn' | 'winter'
   */
  floraSlowTick(delta, season) {
    const growthMult = { spring: 1.8, summer: 1.2, autumn: 0.6, winter: 0.1 }[season] ?? 1.0;

    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.getTile(x, z);
        if (!tile) continue;

        // Regrow depleted tiles
        if (tile.depletionLevel > 0) {
          tile.depletionLevel = Math.max(0, tile.depletionLevel - 0.02 * growthMult * (delta / 10));
        }

        // Seasonal: forest spread chance in spring/summer
        if (season === 'spring' || season === 'summer') {
          if (tile.type === TileType.GRASS && Math.random() < 0.001 * growthMult) {
            // check if any neighbour is WOODLAND — if so, slight chance to become WOODLAND
            const neighbors = this._getNeighborTiles(x, z);
            const woodlandNeighbors = neighbors.filter(n => n.type === TileType.WOODLAND).length;
            if (woodlandNeighbors >= 2 && Math.random() < 0.002) {
              tile.type = TileType.WOODLAND;
            }
          }
        }

        // Winter: grassland depletionLevel increases slightly
        if (season === 'winter' && tile.type === TileType.GRASS) {
          tile.depletionLevel = Math.min(0.3, tile.depletionLevel + 0.005 * (delta / 10));
        }
      }
    }
  }

  /** Returns the 4 orthogonal neighbour tiles (excluding out-of-bounds). */
  _getNeighborTiles(x, z) {
    const neighbors = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx, dz] of dirs) {
      const t = this.getTile(x + dx, z + dz);
      if (t) neighbors.push(t);
    }
    return neighbors;
  }

  /**
   * Returns a growth rate multiplier for the given season.
   * Used by gathering systems to scale yield.
   */
  static seasonalGrowthRate(season) {
    return { spring: 1.5, summer: 1.1, autumn: 0.8, winter: 0.3 }[season] ?? 1.0;
  }

  // ── Save / Load ───────────────────────────────────────────────────────

  /**
   * Serialize world state into a plain JS object for saving.
   * Does not include tile grid (regenerated from seed).
   */
  serialize(agents, conceptGraph, gameTime, weatherState) {
    return {
      seed: this.seed,
      cutTrees: [...this.cutTrees.entries()],
      agents: agents.map(a => ({
        id: a.id, name: a.name, x: a.x, z: a.z,
        age: a.age, maxAge: a.maxAge, health: a.health,
        needs: { ...a.needs },
        knowledge: [...a.knowledge],
        inventory: a.inventory.serialize ? a.inventory.serialize() : [],
        task: a.task,
      })),
      conceptGraph: conceptGraph.serialize ? conceptGraph.serialize() : null,
      gameTime: gameTime,
      weather: weatherState || null,
    };
  }

  /**
   * Reconstruct a World from saved data.
   * Returns { world, agentData, gameTime, weather } — caller reconstructs Agent instances.
   */
  static deserialize(data) {
    const world = new World(data.seed);
    if (data.cutTrees) {
      world.cutTrees = new Map(data.cutTrees);
      for (const [key] of world.cutTrees) {
        const [x, z] = key.split(',').map(Number);
        const tile = world.getTile(x, z);
        if (tile) tile.treeCut = true;
      }
    }
    return { world, agentData: data.agents || [], gameTime: data.gameTime || 0, weather: data.weather };
  }
}
