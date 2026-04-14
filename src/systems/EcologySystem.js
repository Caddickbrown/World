import { TileType } from '../simulation/World.js';

/**
 * EcologySystem — slow forest and woodland spread over generations.
 *
 * Called once per game day via tick(day, world).
 *
 * Spread rules (per day, per tile):
 *  - FOREST adjacent to GRASS → 2% chance that GRASS becomes WOODLAND
 *  - WOODLAND adjacent to GRASS → 1% chance that GRASS becomes WOODLAND
 *  - WOODLAND with no FOREST/WOODLAND neighbours → 0.2% chance to revert to GRASS
 *    (simulates natural clearing / isolated copse dying back)
 *
 * Note: World.floraSlowTick already does a cruder version of woodland spread;
 * EcologySystem provides the full day-gated, directional logic from the spec.
 */
export class EcologySystem {
  constructor() {
    this._lastDay = -1;
  }

  /**
   * Tick ecology simulation. Call once per game loop with the current day number.
   * Safe to call every frame — internally gates to once per day.
   * @param {number} day   — integer game day (from TimeSystem.day)
   * @param {object} world — World instance
   */
  tick(day, world) {
    if (day === this._lastDay) return;
    this._lastDay = day;

    const W = world.width;
    const H = world.height;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    // Collect changes to apply after scanning (avoid order-dependency)
    const promote = []; // GRASS → WOODLAND
    const revert  = []; // WOODLAND → GRASS

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const tile = world.tiles[z][x];

        if (tile.type === TileType.GRASS) {
          // Check neighbours for FOREST or WOODLAND
          let hasForest   = false;
          let hasWoodland = false;
          for (const [dx, dz] of dirs) {
            const n = world.getTile(x + dx, z + dz);
            if (!n) continue;
            if (n.type === TileType.FOREST)   hasForest   = true;
            if (n.type === TileType.WOODLAND) hasWoodland = true;
          }

          if (hasForest && Math.random() < 0.02) {
            promote.push({ x, z });
          } else if (!hasForest && hasWoodland && Math.random() < 0.01) {
            promote.push({ x, z });
          }

        } else if (tile.type === TileType.WOODLAND) {
          // Revert if isolated (no adjacent FOREST or WOODLAND)
          let hasTreeNeighbor = false;
          for (const [dx, dz] of dirs) {
            const n = world.getTile(x + dx, z + dz);
            if (!n) continue;
            if (n.type === TileType.FOREST || n.type === TileType.WOODLAND) {
              hasTreeNeighbor = true;
              break;
            }
          }
          if (!hasTreeNeighbor && Math.random() < 0.002) {
            revert.push({ x, z });
          }
        }
      }
    }

    // Apply promotions (GRASS → WOODLAND)
    for (const { x, z } of promote) {
      const tile = world.tiles[z][x];
      if (tile.type !== TileType.GRASS) continue; // sanity check
      tile.type = TileType.WOODLAND;
      tile.resource = 0.5;
      tile.depletionLevel = 0;
      // Chance of herbs spawning on new woodland
      if (Math.random() < 0.30) tile.herbs = 0.5;
    }

    // Apply reversions (WOODLAND → GRASS)
    for (const { x, z } of revert) {
      const tile = world.tiles[z][x];
      if (tile.type !== TileType.WOODLAND) continue;
      tile.type = TileType.GRASS;
      tile.resource = 0.7;
      tile.depletionLevel = 0;
      delete tile.herbs;
      delete tile.mushrooms;
    }
  }
}
