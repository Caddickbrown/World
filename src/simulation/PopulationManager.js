import { TileType, WORLD_WIDTH, WORLD_HEIGHT } from './World.js';

/**
 * PopulationManager — basic reproduction and density control for animals.
 *
 * Carrying capacity for sheep is derived from the number of grass tiles in the
 * world multiplied by SHEEP_PER_GRASS_TILE. Horses use a separate fixed
 * capacity. If population exceeds 2× capacity, excess animals are culled.
 * Below capacity, each tick has a small chance to spawn a new animal.
 *
 * Wire into main.js:
 *   import { PopulationManager } from './simulation/PopulationManager.js';
 *   const populationManager = new PopulationManager(world);
 *   // in the game loop:
 *   populationManager.tick(delta, sheepRenderer, horseRenderer, predators, world);
 */
export class PopulationManager {
  constructor(world) {
    this.world = world;

    // How often (game-seconds) the manager evaluates population
    this._tickTimer = 0;
    this._tickInterval = 8; // evaluate every 8 game-seconds

    // Tunable constants
    this.SHEEP_PER_GRASS_TILE  = 0.05;
    this.HORSE_CAPACITY        = 8;
    this.REPRODUCTION_CHANCE   = 0.15; // per interval, per species, when below capacity

    // CAD-213: Max sheep cap for the current 32×32 world.
    // When the map expands to 128×128, this should scale proportionally
    // (e.g. MAX_SHEEP_CAPACITY * (newSize / 32)^2 = 200 * 16 = 3200).
    this.MAX_SHEEP_CAPACITY = 200;
  }

  /**
   * CAD-213: Compute carrying capacity scaled to world size.
   * Currently capped at MAX_SHEEP_CAPACITY (200) for the 32×32 map.
   * When the map expands to 128×128, the cap should scale accordingly —
   * this method is the single place to update that logic.
   *
   * @param {number} grassTiles - count of GRASS tiles in the world
   * @param {number} worldSize  - current map side length (default: WORLD_WIDTH)
   * @returns {number} carrying capacity
   */
  getCarryingCapacity(grassTiles, worldSize = WORLD_WIDTH) {
    // Base rate: 5% of grass tiles support one sheep
    const base = Math.floor(grassTiles * this.SHEEP_PER_GRASS_TILE);
    // For 32×32: cap at 200. For larger worlds this cap will naturally lift
    // because grass tile counts will grow with the map. Explicit size scaling
    // is intentionally left as a future hook here for when map expansion lands.
    const sizeScaledCap = Math.floor(this.MAX_SHEEP_CAPACITY * (worldSize / WORLD_WIDTH));
    return Math.max(4, Math.min(base, sizeScaledCap));
  }

  /** Count grass tiles in the world (cached until world changes) */
  _countGrassTiles() {
    let count = 0;
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = this.world.getTile(x, z);
        if (tile?.type === TileType.GRASS) count++;
      }
    }
    return count;
  }

  /** Return a random grass tile, or null if none exists */
  _randomGrassTile() {
    const tiles = [];
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = this.world.getTile(x, z);
        if (tile?.type === TileType.GRASS) tiles.push(tile);
      }
    }
    if (tiles.length === 0) return null;
    return tiles[Math.floor(Math.random() * tiles.length)];
  }

  /**
   * Main update — call once per game-loop frame.
   *
   * @param {number} delta - game-seconds elapsed this frame
   * @param {SheepRenderer} sheepRenderer
   * @param {WildHorseRenderer} horseRenderer
   * @param {Predator[]} predators  - passed for potential future predator tracking
   * @param {World} world
   */
  tick(delta, sheepRenderer, horseRenderer, predators, world) {
    this._tickTimer += delta;
    if (this._tickTimer < this._tickInterval) return;
    this._tickTimer = 0;

    const grassCount = this._countGrassTiles();
    // CAD-213: Use getCarryingCapacity() so the 200-cap and size-scaling logic
    // lives in one place. Previously this was: Math.max(4, Math.floor(grassCount * 0.05))
    const sheepCapacity = this.getCarryingCapacity(grassCount);
    const horseCapacity = this.HORSE_CAPACITY;

    // ── Sheep population ────────────────────────────────────────────────
    if (sheepRenderer) {
      const sheep = sheepRenderer.sheep;
      const liveSheep = sheep.filter(s => !s.isDead);
      const count = liveSheep.length;

      if (count < sheepCapacity && Math.random() < this.REPRODUCTION_CHANCE) {
        // Spawn a new sheep on a random grass tile
        const tile = this._randomGrassTile();
        if (tile) sheepRenderer.addAnimal(tile.x, tile.z);
      } else if (count > sheepCapacity * 2) {
        // Starvation cull: remove a random live sheep
        const liveIndices = sheep.reduce((acc, s, i) => {
          if (!s.isDead) acc.push(i);
          return acc;
        }, []);
        if (liveIndices.length > 0) {
          const victimIdx = liveIndices[Math.floor(Math.random() * liveIndices.length)];
          sheepRenderer.removeAnimal(victimIdx);
        }
      }
    }

    // ── Horse population ─────────────────────────────────────────────────
    if (horseRenderer) {
      const count = horseRenderer.entries.length;

      if (count < horseCapacity && Math.random() < this.REPRODUCTION_CHANCE) {
        const tile = this._randomGrassTile();
        if (tile) horseRenderer.addAnimal(tile.x, tile.z);
      } else if (count > horseCapacity * 2) {
        // Cull the last entry (oldest spawned)
        horseRenderer.removeAnimal(horseRenderer.entries.length - 1);
      }
    }
  }
}
