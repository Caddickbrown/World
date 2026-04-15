/**
 * CAD-95: Frog simulation
 *
 * 6 frogs live near WATER (shallow water) tiles.
 * They hop randomly every 2–4 seconds, staying within 3 tiles of water.
 */
import { TileType, WORLD_WIDTH, WORLD_HEIGHT } from './World.js';

const FROG_COUNT    = 6;
const HOP_INTERVAL_MIN = 2; // seconds
const HOP_INTERVAL_MAX = 4;
const WATER_STAY_RADIUS = 3; // max tiles from any water tile

function _seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Is this tile near water (within WATER_STAY_RADIUS)? */
function nearWater(world, cx, cz) {
  const r = WATER_STAY_RADIUS;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = world.getTile(cx + dx, cz + dz);
      if (t?.type === TileType.WATER || t?.type === TileType.BEACH) return true;
    }
  }
  return false;
}

/** Acceptable tile for a frog: walkable, near water. */
function frogTileOk(world, tx, tz) {
  const t = world.getTile(tx, tz);
  if (!t) return false;
  if (!world.isWalkable(tx, tz)) return false;
  return nearWater(world, tx, tz);
}

/** Find all candidate spawn tiles (walkable & near water). */
function findSpawnTiles(world) {
  const candidates = [];
  for (let z = 0; z < WORLD_HEIGHT; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      if (frogTileOk(world, x, z)) candidates.push({ x, z });
    }
  }
  return candidates;
}

export class Frog {
  /**
   * @param {number} x    - tile X
   * @param {number} z    - tile Z
   * @param {number} id   - unique id for seeding
   */
  constructor(x, z, id) {
    this.id  = id;
    this.x   = x + 0.5;
    this.z   = z + 0.5;
    this._rng = _seededRng(id * 71 + 13);

    this.facingAngle = this._rng() * Math.PI * 2;
    this._hopTimer   = HOP_INTERVAL_MIN + this._rng() * (HOP_INTERVAL_MAX - HOP_INTERVAL_MIN);
    this.isHopping   = false;   // true during the hop arc
    this._hopPhase   = 0;       // 0→1 arc phase (used by renderer)
    this._hopDuration = 0.25;   // seconds per hop
    this._hopToX     = this.x;
    this._hopToZ     = this.z;
    this._hopFromX   = this.x;
    this._hopFromZ   = this.z;
  }

  /** Pick a random nearby tile that is walkable and near water. */
  _pickHopTarget(world) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = this._rng() * Math.PI * 2;
      const dist = 0.5 + this._rng() * 2.0;
      const tx = Math.floor(this.x + Math.cos(ang) * dist);
      const tz = Math.floor(this.z + Math.sin(ang) * dist);
      if (frogTileOk(world, tx, tz)) {
        return { x: tx + 0.5, z: tz + 0.5 };
      }
    }
    return null; // stay put
  }

  /**
   * Tick the frog.
   * @param {number} delta - game-seconds
   * @param {object} world - World instance
   */
  tick(delta, world) {
    if (this.isHopping) {
      this._hopPhase += delta / this._hopDuration;
      if (this._hopPhase >= 1) {
        this._hopPhase = 1;
        this.isHopping = false;
        this.x = this._hopToX;
        this.z = this._hopToZ;
        // Schedule next hop
        this._hopTimer = HOP_INTERVAL_MIN + this._rng() * (HOP_INTERVAL_MAX - HOP_INTERVAL_MIN);
      }
      return;
    }

    this._hopTimer -= delta;
    if (this._hopTimer <= 0) {
      const target = this._pickHopTarget(world);
      if (target) {
        this._hopFromX   = this.x;
        this._hopFromZ   = this.z;
        this._hopToX     = target.x;
        this._hopToZ     = target.z;
        this.facingAngle = Math.atan2(target.x - this.x, target.z - this.z);
        this._hopPhase   = 0;
        this.isHopping   = true;
      } else {
        this._hopTimer = 1 + this._rng();
      }
    }
  }

  /**
   * Get the current world-space X position (interpolated during hop).
   */
  get currentX() {
    if (!this.isHopping) return this.x;
    return this._hopFromX + (this._hopToX - this._hopFromX) * this._hopPhase;
  }

  /**
   * Get the current world-space Z position (interpolated during hop).
   */
  get currentZ() {
    if (!this.isHopping) return this.z;
    return this._hopFromZ + (this._hopToZ - this._hopFromZ) * this._hopPhase;
  }

  /**
   * Get current Y offset (arc during hop, 0 when grounded).
   */
  get currentYOffset() {
    if (!this.isHopping) return 0;
    return Math.sin(this._hopPhase * Math.PI) * 0.28; // hop arc height
  }
}

/**
 * Factory: create FROG_COUNT frogs near water tiles.
 * @param {object} world
 * @returns {Frog[]}
 */
export function createFrogs(world) {
  const candidates = findSpawnTiles(world);
  const frogs = [];
  const rng = _seededRng(999);

  // Shuffle candidates
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  for (let i = 0; i < Math.min(FROG_COUNT, candidates.length); i++) {
    frogs.push(new Frog(candidates[i].x, candidates[i].z, i));
  }
  return frogs;
}
