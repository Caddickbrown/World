import { TileType } from '../simulation/World.js';

/**
 * DisasterSystem — periodic natural disasters that affect the world.
 * Driven by a seeded daily roll (~5% chance). Only one disaster active at a time.
 */

const DISASTERS = [
  {
    type: 'drought',
    duration: 60,
    description: 'Scorching drought reduces gather yield on grass and woodland by 50%',
  },
  {
    type: 'flood',
    duration: 30,
    description: 'Flooding makes beach tiles temporarily impassable',
  },
  {
    type: 'blight',
    duration: 45,
    description: 'Blight infects ground food items, spoiling them 5x faster',
  },
];

export class DisasterSystem {
  static DISASTERS = DISASTERS;

  constructor() {
    /** Current active disaster: { type, timer } or null */
    this._active = null;
    /** Track last evaluated day to avoid re-rolling */
    this._lastDay = -1;
  }

  /** Current active disaster or null */
  get active() {
    return this._active;
  }

  /**
   * Tick the disaster system.
   * @param {number} delta — game-seconds elapsed
   * @param {object} world — World instance
   * @param {number} day — current game day (integer)
   * @param {number} seed — world seed
   */
  tick(delta, world, day, seed) {
    // Tick down active disaster
    if (this._active) {
      this._active.timer -= delta;
      if (this._active.timer <= 0) {
        this._deactivate(world);
      }
      return;
    }

    // Roll for new disaster once per day
    if (day === this._lastDay) return;
    this._lastDay = day;

    const roll = (day * seed) % 1000;
    if (roll >= 50) return; // ~5% chance (roll 0-49 out of 0-999)

    // Pick disaster type based on roll
    const index = roll % DISASTERS.length;
    const template = DISASTERS[index];
    this._active = { type: template.type, timer: template.duration };
    this._activate(world);
  }

  /** Apply disaster onset effects */
  _activate(world) {
    if (this._active.type === 'flood') {
      // Mark beach tiles impassable
      for (let z = 0; z < world.height; z++) {
        for (let x = 0; x < world.width; x++) {
          const tile = world.tiles[z][x];
          if (tile.type === TileType.BEACH) {
            tile._flooded = true;
          }
        }
      }
    }
  }

  /** Clean up when disaster ends */
  _deactivate(world) {
    if (this._active.type === 'flood') {
      for (let z = 0; z < world.height; z++) {
        for (let x = 0; x < world.width; x++) {
          const tile = world.tiles[z][x];
          if (tile._flooded) {
            delete tile._flooded;
          }
        }
      }
    }
    this._active = null;
  }

  /**
   * Gather yield multiplier for a tile (called by gathering logic).
   * Returns 0.5 during drought on grass/woodland, 1.0 otherwise.
   */
  getGatherMult(tile) {
    if (!this._active || this._active.type !== 'drought') return 1.0;
    if (tile.type === TileType.GRASS || tile.type === TileType.WOODLAND) return 0.5;
    return 1.0;
  }

  /**
   * Whether a tile is blocked by flood.
   * Callers should check this alongside normal traversal logic.
   */
  isFlooded(tile) {
    return tile._flooded === true;
  }

  /**
   * Spoilage multiplier for ground items during blight.
   * Returns 5.0 during blight, 1.0 otherwise.
   */
  getSpoilageMult() {
    if (!this._active || this._active.type !== 'blight') return 1.0;
    return 5.0;
  }
}
