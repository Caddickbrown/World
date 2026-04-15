import { TileType, TILE_SIZE } from './World.js';

/**
 * CAD-197 — FishShoal
 *
 * Simulates a shoal of 8–15 fish moving as a unit using boids-lite rules:
 *   - Cohesion: drift toward shoal centre
 *   - Boundary: stay within WATER tiles, avoid edges
 *
 * Shoals replenish fish count over 30 game-days when not at max.
 * Agents with the 'fishing' concept can catch fish by being adjacent to the shoal
 * (reduces shoalSize by 1, yields food to agent).
 */
export class FishShoal {
  /**
   * @param {number} x - initial tile x (float)
   * @param {number} z - initial tile z (float)
   * @param {number} [size] - number of fish (8–15)
   */
  constructor(x, z, size) {
    this.x = x;
    this.z = z;
    this.maxSize  = size ?? (8 + Math.floor(Math.random() * 8)); // 8–15
    this.size     = this.maxSize;
    this._vx      = (Math.random() - 0.5) * 0.4; // tile/sec velocity
    this._vz      = (Math.random() - 0.5) * 0.4;
    this._replenishTimer = 0;
    /** Day-equivalent for replenish rate: max replenish in 30 game-days (30 * dayLength sec) */
    this._REPLENISH_INTERVAL = 30; // game-seconds between +1 fish
  }

  /**
   * Update shoal position and replenishment each frame.
   * @param {number} delta - game-seconds since last frame
   * @param {object} world - World instance
   */
  tick(delta, world) {
    if (delta <= 0) return;

    // ── Boids-lite movement ───────────────────────────────────────────────
    const speed = 0.3 + Math.random() * 0.15; // gentle drift

    // Random wandering component
    this._vx += (Math.random() - 0.5) * 0.06;
    this._vz += (Math.random() - 0.5) * 0.06;

    // Clamp speed
    const mag = Math.hypot(this._vx, this._vz);
    if (mag > speed) {
      this._vx = (this._vx / mag) * speed;
      this._vz = (this._vz / mag) * speed;
    }

    // Boundary check: stay within WATER tiles
    const nx = this.x + this._vx * delta;
    const nz = this.z + this._vz * delta;
    const targetTile = world.getTile(Math.floor(nx), Math.floor(nz));

    if (targetTile && targetTile.type === TileType.WATER) {
      this.x = nx;
      this.z = nz;
    } else {
      // Bounce: reverse and nudge toward world centre
      this._vx = -this._vx * 0.8 + (world.width / 2 - this.x) * 0.02;
      this._vz = -this._vz * 0.8 + (world.height / 2 - this.z) * 0.02;
    }

    // Clamp within world bounds
    this.x = Math.max(0.5, Math.min(world.width - 0.5, this.x));
    this.z = Math.max(0.5, Math.min(world.height - 0.5, this.z));

    // ── Replenishment ─────────────────────────────────────────────────────
    if (this.size < this.maxSize) {
      this._replenishTimer += delta;
      if (this._replenishTimer >= this._REPLENISH_INTERVAL) {
        this._replenishTimer = 0;
        this.size = Math.min(this.maxSize, this.size + 1);
      }
    }
  }

  /**
   * Attempt a fishing catch by an agent.
   * Requires agent to have 'fishing' concept.
   * Agent must be within 2 tiles of the shoal and the shoal must have fish.
   * @param {object} agent - Agent instance
   * @param {Map} itemDefs - item definitions
   * @returns {boolean} true if a catch was made
   */
  tryFish(agent, itemDefs) {
    if (this.size <= 0) return false;
    if (!agent.knowledge.has('fishing')) return false;

    const dist = Math.hypot(agent.x - this.x, agent.z - this.z);
    if (dist > 2.5) return false;

    // 40% catch chance per attempt
    if (Math.random() > 0.40) return false;

    this.size = Math.max(0, this.size - 1);

    // Add fish to agent inventory
    if (itemDefs && itemDefs.size > 0) {
      agent.inventory?.add('fish', 1, itemDefs);
    } else {
      // Fallback: boost hunger directly
      agent.needs.hunger = Math.min(1, agent.needs.hunger + 0.25);
    }
    return true;
  }

  /**
   * World-space position (for rendering).
   * @returns {{ x: number, y: number, z: number }}
   */
  get worldPos() {
    return {
      x: this.x * TILE_SIZE + TILE_SIZE / 2,
      y: 0.06, // float just above water surface
      z: this.z * TILE_SIZE + TILE_SIZE / 2,
    };
  }
}

/**
 * Initialise 3–5 FishShoals in WATER zones across the world.
 * @param {object} world - World instance
 * @returns {FishShoal[]}
 */
export function initFishShoals(world) {
  const waterTiles = [];
  for (let z = 0; z < world.height; z++) {
    for (let x = 0; x < world.width; x++) {
      if (world.tiles[z][x].type === TileType.WATER) waterTiles.push({ x, z });
    }
  }
  if (waterTiles.length === 0) return [];

  const count = 3 + Math.floor(Math.random() * 3); // 3–5
  const shoals = [];
  for (let i = 0; i < count; i++) {
    const tile = waterTiles[Math.floor(Math.random() * waterTiles.length)];
    shoals.push(new FishShoal(tile.x + 0.5, tile.z + 0.5));
  }
  return shoals;
}
