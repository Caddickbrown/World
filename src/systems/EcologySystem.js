import { TileType } from '../simulation/World.js';

// CAD-193: overgrazing constants
const OVERGRAZING_THRESHOLD    = 3;  // animals per GRASS tile
const OVERGRAZING_DAYS_TRIGGER = 5;  // consecutive days at threshold before degrades
const DIRT_RECOVERY_DAYS       = 30; // days for DIRT to recover to GRASS (no animals)

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
 * CAD-210: Seed dispersal
 *  - FOREST tiles periodically drop seeds onto adjacent GRASS tiles
 *  - Seeds have a 5% chance per day of germinating into WOODLAND (moisture-gated)
 *
 * CAD-206: Soil quality + moisture tracking
 *  - tile.soilQuality (0-1): initialised from elevation, improves after fire
 *  - tile.moisture (0-1): initialised from adjacency to water, modified by weather
 *
 * Note: World.floraSlowTick already does a cruder version of woodland spread;
 * EcologySystem provides the full day-gated, directional logic from the spec.
 */
export class EcologySystem {
  constructor() {
    this._lastDay = -1;
    this._soilInitialised = false;
  }

  /**
   * Initialise soil quality and moisture on all tiles (once, on first tick).
   * @param {object} world
   */
  _initialiseSoil(world) {
    const W = world.width;
    const H = world.height;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const tile = world.tiles[z][x];

        // soilQuality: low elevation = fertile (0.7), high = rocky (0.3)
        if (tile.soilQuality == null) {
          const elev = tile.elevation ?? 0.5; // 0–1 normalised
          tile.soilQuality = Math.max(0, Math.min(1, 0.7 - elev * 0.4));
        }

        // moisture: tiles adjacent to WATER/BEACH start wet, else dry
        if (tile.moisture == null) {
          let nearWater = false;
          for (const [dx, dz] of dirs) {
            const n = world.getTile(x + dx, z + dz);
            if (!n) continue;
            if (n.type === TileType.WATER || n.type === TileType.DEEP_WATER ||
                n.type === TileType.BEACH) {
              nearWater = true;
              break;
            }
          }
          tile.moisture = nearWater ? 0.8 : 0.4;
        }
      }
    }
    this._soilInitialised = true;
  }

  /**
   * Tick ecology simulation. Call once per game loop with the current day number.
   * Safe to call every frame — internally gates to once per day.
   * @param {number} day      — integer game day (from TimeSystem.day)
   * @param {object} world    — World instance
   * @param {object} [weather] — optional WeatherSystem instance (for isRaining)
   * @param {object[]} [sheep] — sheep array from SheepRenderer (each has .x, .z, .isDead)
   * @param {object[]} [horses] — horse entries from WildHorseRenderer (each has .horseSim.x/.z)
   */
  tick(day, world, weather, sheep = [], horses = []) {
    // Initialise soil on first tick
    if (!this._soilInitialised) this._initialiseSoil(world);

    if (day === this._lastDay) return;
    this._lastDay = day;

    const W = world.width;
    const H = world.height;
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const isRaining = weather ? (weather.isRaining || weather.isStorm) : false;

    // Collect changes to apply after scanning (avoid order-dependency)
    const promote = []; // GRASS → WOODLAND
    const revert  = []; // WOODLAND → GRASS

    // CAD-210: seed germination candidates
    const germinate = []; // GRASS tiles seeded from adjacent FOREST

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const tile = world.tiles[z][x];

        // ── CAD-206: moisture update ──────────────────────────────────────
        if (tile.moisture != null) {
          if (isRaining) {
            tile.moisture = Math.min(1, tile.moisture + 0.01);
          } else {
            tile.moisture = Math.max(0, tile.moisture - 0.005);
          }
        }

        // ── Forest spread & seed dispersal ───────────────────────────────
        if (tile.type === TileType.GRASS) {
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

          // CAD-210: seed germination from adjacent FOREST
          if (hasForest) {
            germinate.push({ x, z, moisture: tile.moisture ?? 0.4 });
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

        } else if (tile.type === TileType.FOREST) {
          // CAD-210: mature FOREST tiles drop seeds onto adjacent GRASS
          const isMature = (tile.treeAge != null) ? tile.treeAge > 30 : true;
          if (isMature) {
            for (const [dx, dz] of dirs) {
              const n = world.getTile(x + dx, z + dz);
              if (n && n.type === TileType.GRASS) {
                // Mark the grass tile as having received a seed this day
                n._hasSeed = true;
              }
            }
          }
        }
      }
    }

    // CAD-210: process seed germination (5% chance, moisture-gated)
    for (const { x, z, moisture } of germinate) {
      const tile = world.tiles[z][x];
      if (tile.type !== TileType.GRASS) continue;
      if (!tile._hasSeed) continue; // seed must have been dropped this tick
      // Germination check: 5% flat, boosted if moisture > 0.5
      const germChance = moisture >= 0.5 ? 0.05 : 0.05; // could scale with moisture
      if (Math.random() < germChance) {
        promote.push({ x, z });
      }
    }

    // Clean up seed markers (avoid stale data across days)
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        delete world.tiles[z][x]._hasSeed;
      }
    }

    // ── CAD-193: Overgrazing — degrade GRASS to DIRT ──────────────────────
    // Count animals per tile using Math.floor of their tile-space positions.
    const animalCount = new Map(); // "x,z" → count
    const countAt = (ax, az) => {
      const key = `${Math.floor(ax)},${Math.floor(az)}`;
      animalCount.set(key, (animalCount.get(key) ?? 0) + 1);
    };
    for (const s of sheep)  { if (!s.isDead) countAt(s.x, s.z); }
    for (const h of horses) { if (h.horseSim) countAt(h.horseSim.x, h.horseSim.z); }

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const tile = world.tiles[z][x];
        const key  = `${x},${z}`;
        const cnt  = animalCount.get(key) ?? 0;

        if (tile.type === TileType.GRASS) {
          if (cnt > OVERGRAZING_THRESHOLD) {
            tile._overgrazeDays = (tile._overgrazeDays ?? 0) + 1;
            if (tile._overgrazeDays >= OVERGRAZING_DAYS_TRIGGER) {
              // Degrade to DIRT
              tile.type = TileType.DIRT;
              tile.resource = 0;
              tile._overgrazeDays = 0;
              tile._dirtDays = 0;
            }
          } else {
            tile._overgrazeDays = Math.max(0, (tile._overgrazeDays ?? 0) - 1);
          }
        } else if (tile.type === TileType.DIRT) {
          const noAnimals = cnt === 0;
          if (noAnimals) {
            tile._dirtDays = (tile._dirtDays ?? 0) + 1;
            if (tile._dirtDays >= DIRT_RECOVERY_DAYS) {
              // Recover to GRASS
              tile.type = TileType.GRASS;
              tile.resource = 0.5;
              tile.depletionLevel = 0;
              tile._dirtDays = 0;
            }
          } else {
            tile._dirtDays = Math.max(0, (tile._dirtDays ?? 0) - 1);
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

    // ── CAD-193: Overgrazing — degrade GRASS to DIRT ──────────────────────
    // Count animals per tile using Math.floor of their tile-space positions.
    const animalCount = new Map(); // "x,z" → count
    const countAt = (ax, az) => {
      const key = `${Math.floor(ax)},${Math.floor(az)}`;
      animalCount.set(key, (animalCount.get(key) ?? 0) + 1);
    };
    for (const s of sheep)  { if (!s.isDead) countAt(s.x, s.z); }
    for (const h of horses) { if (h.horseSim) countAt(h.horseSim.x, h.horseSim.z); }

    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const tile = world.tiles[z][x];
        const key  = `${x},${z}`;
        const cnt  = animalCount.get(key) ?? 0;

        if (tile.type === TileType.GRASS) {
          if (cnt > OVERGRAZING_THRESHOLD) {
            tile._overgrazeDays = (tile._overgrazeDays ?? 0) + 1;
            if (tile._overgrazeDays >= OVERGRAZING_DAYS_TRIGGER) {
              // Degrade to DIRT
              tile.type = TileType.DIRT;
              tile.resource = 0;
              tile._overgrazeDays = 0;
              tile._dirtDays = 0;
            }
          } else {
            tile._overgrazeDays = Math.max(0, (tile._overgrazeDays ?? 0) - 1);
          }
        } else if (tile.type === TileType.DIRT) {
          const noAnimals = cnt === 0;
          if (noAnimals) {
            tile._dirtDays = (tile._dirtDays ?? 0) + 1;
            if (tile._dirtDays >= DIRT_RECOVERY_DAYS) {
              // Recover to GRASS
              tile.type = TileType.GRASS;
              tile.resource = 0.5;
              tile.depletionLevel = 0;
              tile._dirtDays = 0;
            }
          } else {
            tile._dirtDays = Math.max(0, (tile._dirtDays ?? 0) - 1);
          }
        }
      }
    }
  }

  /**
   * Call after a fire passes through a tile to improve soil quality (CAD-206).
   * @param {object} tile — world tile object
   */
  static onFireBurned(tile) {
    if (tile.soilQuality != null) {
      tile.soilQuality = Math.min(1, tile.soilQuality + 0.1);
    } else {
      tile.soilQuality = 0.5;
    }
  }
}
