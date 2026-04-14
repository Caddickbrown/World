import { TileType } from '../simulation/World.js';

/**
 * FireSystem — tracks active fire tiles and handles spread/burnout.
 *
 * Works alongside world.naturalFires (Map of "x,z" → { endTime }).
 * The renderer uses world.naturalFires for visual fire lights; FireSystem
 * drives the simulation logic (spread, burnout, tile conversion).
 *
 * Usage:
 *   const fireSystem = new FireSystem();
 *   fireSystem.ignite(x, z, world, gameTime);
 *   fireSystem.tick(delta, world, gameTime, wr); // wr optional WorldRenderer
 */
export class FireSystem {
  constructor() {
    /**
     * Map of "x,z" → { burnUntil: gameSeconds, spreadTimer: seconds }
     * Parallel to world.naturalFires but holds simulation state.
     */
    this._fires = new Map();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Ignite a tile. Only FOREST or WOODLAND tiles can burn.
   * @param {number} x
   * @param {number} z
   * @param {object} world    — World instance
   * @param {number} gameTime — current game time in seconds
   * @returns {boolean} true if fire was started
   */
  ignite(x, z, world, gameTime) {
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    const tile = world.getTile(tx, tz);
    if (!tile) return false;
    if (tile.type !== TileType.FOREST && tile.type !== TileType.WOODLAND) return false;

    const key = `${tx},${tz}`;
    if (this._fires.has(key)) return false; // already burning

    const burnDuration = 30 + Math.random() * 30; // 30–60 s
    this._fires.set(key, {
      burnUntil:   gameTime + burnDuration,
      spreadTimer: 0,
    });

    // Sync with world.naturalFires so renderer sees the fire
    if (world.naturalFires) {
      world.naturalFires.set(key, { endTime: gameTime + burnDuration });
    }

    return true;
  }

  /**
   * Tick all burning tiles: spread and burnout.
   * @param {number} delta    — game-seconds since last tick
   * @param {object} world    — World instance
   * @param {number} gameTime — current game time in seconds
   * @param {object} [wr]     — optional WorldRenderer (for addFireLight / removeFireLight)
   */
  tick(delta, world, gameTime, wr) {
    const SPREAD_CHANCE_PER_SEC = 0.02;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [key, data] of [...this._fires.entries()]) {
      // Burnout
      if (gameTime >= data.burnUntil) {
        this._fires.delete(key);
        if (world.naturalFires) world.naturalFires.delete(key);
        if (wr?.removeFireLight) wr.removeFireLight(...key.split(',').map(Number));

        // Convert burned tile to GRASS (ash aftermath)
        const [tx, tz] = key.split(',').map(Number);
        const tile = world.getTile(tx, tz);
        if (tile && (tile.type === TileType.FOREST || tile.type === TileType.WOODLAND)) {
          tile.type     = TileType.GRASS;
          tile.resource = 0.1; // depleted but recoverable
          if (tile.depletionLevel !== undefined) tile.depletionLevel = 0.8;
          // Clear tree resources
          delete tile.herbs;
          delete tile.mushrooms;
          tile.treeCut = false;
        }
        continue;
      }

      // Spread attempt each tick
      data.spreadTimer += delta;
      if (data.spreadTimer >= 1) {
        data.spreadTimer -= 1;
        if (Math.random() < SPREAD_CHANCE_PER_SEC) {
          // Pick a random adjacent tile to try to ignite
          const [tx, tz] = key.split(',').map(Number);
          const shuffled = dirs.slice().sort(() => Math.random() - 0.5);
          for (const [dx, dz] of shuffled) {
            const nx = tx + dx, nz = tz + dz;
            const neighbor = world.getTile(nx, nz);
            if (!neighbor) continue;
            if (neighbor.type !== TileType.FOREST && neighbor.type !== TileType.WOODLAND) continue;
            const nkey = `${nx},${nz}`;
            if (this._fires.has(nkey)) continue;
            if (this.ignite(nx, nz, world, gameTime)) {
              if (wr?.addFireLight) wr.addFireLight(nx, nz);
            }
            break; // one spread per tick per tile
          }
        }
      }
    }
  }

  /**
   * Returns the current set of burning tile keys ("x,z" strings).
   * @returns {Set<string>}
   */
  getFireTiles() {
    return new Set(this._fires.keys());
  }

  /**
   * How many tiles are currently burning.
   */
  get size() {
    return this._fires.size;
  }

  /**
   * Clear all fires (e.g. on world reset).
   */
  clear() {
    this._fires.clear();
  }
}
