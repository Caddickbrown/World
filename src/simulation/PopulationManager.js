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
    const sheepCapacity = Math.max(4, Math.floor(grassCount * this.SHEEP_PER_GRASS_TILE));
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
