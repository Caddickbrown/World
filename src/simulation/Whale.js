import { TileType, WORLD_WIDTH, WORLD_HEIGHT } from './World.js';

const WHALE_SPEED   = 0.3;   // tiles/sec — slow migration
const BREACH_RISE   = 2.0;   // world-units height at peak of breach
const BREACH_PERIOD = 3.0;   // seconds for a full breach cycle (rise + fall)
const BREACH_CHANCE = 0.004; // chance per second of starting a breach

function rotateFacingToward(fx, fz, tx, tz, maxRad) {
  const cur = Math.atan2(fx, fz);
  const want = Math.atan2(tx, tz);
  let diff = want - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.sign(diff) * Math.min(Math.abs(diff), maxRad);
  const a = cur + step;
  return { x: Math.sin(a), z: Math.cos(a) };
}

export class Whale {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.targetZ = z;
    this.facingX = 0;
    this.facingZ = 1;

    this.turnRate = 0.8 + Math.random() * 0.4;

    // Breach animation state
    this.isBreaching  = false;
    this._breachTimer = 0;   // 0 → BREACH_PERIOD
    this.breachY      = 0;   // renderer reads this for vertical offset

    // Tail animation phase
    this.tailPhase    = Math.random() * Math.PI * 2;

    this._retargetIn  = 1 + Math.random() * 3;
  }

  /** Pick a random deep-water destination tile anywhere on the map */
  _pickDestination(world) {
    const deepTiles = [];
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = world.getTile(x, z);
        if (tile?.type === TileType.DEEP_WATER) deepTiles.push(tile);
      }
    }
    if (deepTiles.length === 0) return;
    const dest = deepTiles[Math.floor(Math.random() * deepTiles.length)];
    this.targetX = dest.x + 0.5;
    this.targetZ = dest.z + 0.5;
    this._retargetIn = 20 + Math.random() * 40;
  }

  tick(delta, world) {
    this.tailPhase += delta * 1.8;

    // ── Breach logic ──────────────────────────────────────────────────
    if (!this.isBreaching && Math.random() < BREACH_CHANCE * delta) {
      this.isBreaching  = true;
      this._breachTimer = 0;
    }

    if (this.isBreaching) {
      this._breachTimer += delta;
      const t = Math.min(1, this._breachTimer / BREACH_PERIOD);
      // Sine arch: 0 → peak at 0.5 → 0
      this.breachY = Math.sin(t * Math.PI) * BREACH_RISE;
      if (this._breachTimer >= BREACH_PERIOD) {
        this.isBreaching = false;
        this.breachY     = 0;
        this._breachTimer = 0;
      }
      // While breaching, continue moving (don't pause)
    }

    // ── Migration targeting ───────────────────────────────────────────
    this._retargetIn -= delta;

    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.5 || this._retargetIn <= 0) {
      this._pickDestination(world);
      return;
    }

    // ── Steer and move ────────────────────────────────────────────────
    const tx = dx / dist;
    const tz = dz / dist;

    const f = rotateFacingToward(
      this.facingX, this.facingZ, tx, tz,
      this.turnRate * delta,
    );
    this.facingX = f.x;
    this.facingZ = f.z;

    const nx = this.x + this.facingX * WHALE_SPEED * delta;
    const nz = this.z + this.facingZ * WHALE_SPEED * delta;

    // Stay in deep water
    const ntile = world.getTile(Math.floor(nx), Math.floor(nz));
    if (ntile?.type === TileType.DEEP_WATER) {
      this.x = nx;
      this.z = nz;
    } else {
      // Find a new destination if blocked
      this._pickDestination(world);
    }
  }
}

/**
 * Factory: create 2 whales placed on random DEEP_WATER tiles.
 * @param {import('./World.js').World} world
 * @returns {Whale[]}
 */
export function createWhales(world) {
  const deepTiles = [];
  for (let z = 0; z < WORLD_HEIGHT; z++) {
    for (let x = 0; x < WORLD_WIDTH; x++) {
      const tile = world.getTile(x, z);
      if (tile?.type === TileType.DEEP_WATER) deepTiles.push(tile);
    }
  }
  if (deepTiles.length < 2) return [];

  const whales = [];
  const used = new Set();
  while (whales.length < 2 && used.size < deepTiles.length) {
    const idx = Math.floor(Math.random() * deepTiles.length);
    if (!used.has(idx)) {
      used.add(idx);
      const t = deepTiles[idx];
      const w = new Whale(t.x + 0.5, t.z + 0.5);
      w._pickDestination(world);
      whales.push(w);
    }
  }
  return whales;
}
