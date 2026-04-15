/**
 * CAD-92: InsectSwarm simulation
 *
 * 4 swarms of 20 insects each. Each swarm hovers near FOREST tiles,
 * drifting slowly in random directions. Insects stay above terrain
 * (y = 0.3–0.8 in world units).
 */
import { TileType, WORLD_WIDTH, WORLD_HEIGHT } from './World.js';

const SWARM_COUNT   = 4;
const INSECTS_EACH  = 20;
const DRIFT_SPEED   = 0.3;   // tiles/sec for swarm centre drift
const SPREAD_RADIUS = 1.2;   // tiles — individual spread around centre
const Y_MIN         = 0.3;   // min altitude above terrain
const Y_MAX         = 0.8;   // max altitude above terrain
const RETARGET_TIME = 4;     // seconds before swarm picks a new drift target

/**
 * Find all FOREST tiles and return a random one's centre.
 * Returns null if none exist.
 */
function randomForestTile(world, rng) {
  const tiles = [];
  for (let z = 0; z < WORLD_HEIGHT; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const t = world.getTile(x, z);
      if (t?.type === TileType.FOREST) tiles.push(t);
    }
  }
  if (tiles.length === 0) return null;
  return tiles[Math.floor(rng() * tiles.length)];
}

export class InsectSwarm {
  /**
   * @param {object} world - World instance
   * @param {number} id    - swarm index (for seeding)
   */
  constructor(world, id) {
    this.id = id;
    this._rng = _seededRng(id * 137 + 42);

    // Find a FOREST tile for the initial anchor
    const anchor = randomForestTile(world, this._rng);
    this.x = anchor ? anchor.x + 0.5 : WORLD_WIDTH  / 2;
    this.z = anchor ? anchor.z + 0.5 : WORLD_HEIGHT / 2;

    this._targetX = this.x;
    this._targetZ = this.z;
    this._retargetTimer = 0;

    // Per-insect offsets (stable relative jitter within the swarm)
    this.insects = [];
    for (let i = 0; i < INSECTS_EACH; i++) {
      this.insects.push({
        ox: (this._rng() - 0.5) * SPREAD_RADIUS * 2,
        oz: (this._rng() - 0.5) * SPREAD_RADIUS * 2,
        oy: Y_MIN + this._rng() * (Y_MAX - Y_MIN),
        // Individual drift phase for the jitter animation
        phase: this._rng() * Math.PI * 2,
      });
    }
  }

  /**
   * Update swarm position. Call once per game tick.
   * @param {number} delta - game-seconds elapsed
   * @param {object} world - World instance
   */
  tick(delta, world) {
    this._retargetTimer -= delta;
    if (this._retargetTimer <= 0) {
      this._retargetTimer = RETARGET_TIME * (0.7 + this._rng() * 0.6);
      // Drift to a random nearby FOREST tile
      const anchor = randomForestTile(world, this._rng);
      if (anchor) {
        this._targetX = anchor.x + 0.5 + (this._rng() - 0.5) * 2;
        this._targetZ = anchor.z + 0.5 + (this._rng() - 0.5) * 2;
      }
    }

    // Move swarm centre toward target
    const dx = this._targetX - this.x;
    const dz = this._targetZ - this.z;
    const dist = Math.hypot(dx, dz) || 1;
    const step = Math.min(dist, DRIFT_SPEED * delta);
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;

    // Animate per-insect phases
    for (const ins of this.insects) {
      ins.phase += delta * (1.5 + this._rng() * 1.0);
    }
  }

  /**
   * Return world-space positions for all insects in this swarm.
   * Caller (InsectSwarmRenderer) uses these each frame.
   * @param {number} time - elapsed time for jitter animation
   * @returns {Array<{wx, wy, wz}>}
   */
  getPositions(time) {
    return this.insects.map(ins => ({
      wx: (this.x + ins.ox + Math.sin(ins.phase * 1.1) * 0.18) * 2,
      wy: ins.oy  + Math.sin(ins.phase * 1.7) * 0.08,
      wz: (this.z + ins.oz + Math.cos(ins.phase * 0.9) * 0.18) * 2,
    }));
  }
}

function _seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}
