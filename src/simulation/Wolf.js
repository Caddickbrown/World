import { TileType } from './World.js';

const REACH_DIST = 0.15;
const WANDER_RADIUS_MIN = 3;
const WANDER_RADIUS_MAX = 10;
const RETARGET_BASE = 4;
const NORMAL_SPEED = 1.5;
const HUNT_SPEED = 2.8;
const PACK_COHESION_DIST = 5;   // tiles — max distance from pack centre before rejoining
const HUNT_DETECT_DIST = 10;    // tiles — detect prey within this range
const FLEE_DETECT_DIST = 6;     // tiles — flee from large agent groups within this range
const FLEE_GROUP_SIZE = 5;      // flee if this many agents are within FLEE_DETECT_DIST
const FED_DURATION = 48;        // game-seconds a wolf is "fed" after a successful hunt

function wolfTileOk(world, tx, tz) {
  const tile = world.getTile(tx, tz);
  if (!tile) return false;
  if (!world.isWalkable(tx, tz)) return false;
  return tile.type === TileType.GRASS ||
         tile.type === TileType.WOODLAND ||
         tile.type === TileType.FOREST;
}

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

export class Wolf {
  /**
   * @param {number} x
   * @param {number} z
   * @param {Wolf[]} pack - reference to the shared array of pack members
   * @param {number} packIndex - this wolf's index within the pack (for formation offsets)
   */
  constructor(x, z, pack = null, packIndex = 0) {
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.targetZ = z;
    this.facingX = 0;
    this.facingZ = 1;

    this.pack = pack;           // shared array of all pack wolves
    this.packIndex = packIndex;

    this.turnRate = 2.5 + Math.random() * 1.5;
    this.gait = 'idle';
    this._idleLeft = 1 + Math.random() * 3;
    this._retargetIn = 0.5 + Math.random() * 2;
    this.walkPhase = Math.random() * Math.PI * 2;

    // Hunting state
    this.isHunting = false;
    this.huntTarget = null;    // the prey object (Deer / Rabbit)
    this.fedTimer = 0;         // counts down after a successful kill

    // Flee state
    this.isFleeing = false;
    this._fleeTimer = 0;

    // Domestication (used by CAD-200)
    this.fearLevel = 0.5;      // 0 = fearless/tame, 1 = very fearful
    this.owner = null;         // set when domesticated (agent reference)

    // Formation offsets so pack members spread slightly
    const offsets = [
      { ox: 0,    oz: 0    },
      { ox: 0.7,  oz: 0.4  },
      { ox: -0.7, oz: 0.4  },
      { ox: 0,    oz: -0.7 },
    ];
    const off = offsets[packIndex % offsets.length];
    this._formationOffsetX = off.ox;
    this._formationOffsetZ = off.oz;
  }

  /** Compute pack centre (average position of all living pack members) */
  _packCentre() {
    if (!this.pack || this.pack.length === 0) return { x: this.x, z: this.z };
    let sx = 0, sz = 0, n = 0;
    for (const w of this.pack) {
      if (!w || w.isDead) continue;
      sx += w.x; sz += w.z; n++;
    }
    if (n === 0) return { x: this.x, z: this.z };
    return { x: sx / n, z: sz / n };
  }

  _pickTarget(world) {
    const cx = Math.floor(this.x);
    const cz = Math.floor(this.z);
    const r = WANDER_RADIUS_MIN +
      Math.floor(Math.random() * (WANDER_RADIUS_MAX - WANDER_RADIUS_MIN + 1));
    for (let k = 0; k < 24; k++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = r * (0.3 + Math.random() * 0.7);
      const tx = Math.floor(cx + Math.cos(ang) * dist);
      const tz = Math.floor(cz + Math.sin(ang) * dist);
      if (wolfTileOk(world, tx, tz)) {
        this.targetX = tx + 0.5;
        this.targetZ = tz + 0.5;
        return;
      }
    }
    this.targetX = cx + 0.3 + Math.random() * 0.4;
    this.targetZ = cz + 0.3 + Math.random() * 0.4;
  }

  /**
   * @param {number} delta
   * @param {import('./World.js').World} world
   * @param {object[]} agents - agent array (for flee detection)
   * @param {object[]} prey   - combined deer + rabbit array
   */
  tick(delta, world, agents = [], prey = []) {
    if (this.isDead) return;

    this.walkPhase += delta * (this.isHunting ? HUNT_SPEED : NORMAL_SPEED) * 2.8;

    // Update fed timer
    if (this.fedTimer > 0) {
      this.fedTimer = Math.max(0, this.fedTimer - delta);
    }

    // Gradually reduce fear level over time (for domestication)
    if (this.fearLevel > 0) {
      this.fearLevel = Math.max(0, this.fearLevel - delta * 0.0005);
    }

    // ── 1. Flee from large agent groups ────────────────────────────────
    let nearAgents = 0;
    let fleeX = 0, fleeZ = 0;
    for (const agent of agents) {
      if (!agent || agent.health <= 0) continue;
      const d = Math.hypot(agent.x - this.x, agent.z - this.z);
      if (d < FLEE_DETECT_DIST) {
        nearAgents++;
        fleeX += (this.x - agent.x) / (d || 1);
        fleeZ += (this.z - agent.z) / (d || 1);
        // Increase fear when near agents
        this.fearLevel = Math.min(1, this.fearLevel + delta * 0.01);
      }
    }

    if (nearAgents >= FLEE_GROUP_SIZE) {
      this.isFleeing = true;
      this.isHunting = false;
      this.huntTarget = null;
      this._fleeTimer = 4;
      const mag = Math.hypot(fleeX, fleeZ) || 1;
      const fleeDist = WANDER_RADIUS_MAX;
      const fleeAng = Math.atan2(fleeZ / mag, fleeX / mag);
      const tx = Math.floor(this.x + Math.cos(fleeAng) * fleeDist);
      const tz = Math.floor(this.z + Math.sin(fleeAng) * fleeDist);
      if (wolfTileOk(world, tx, tz)) {
        this.targetX = tx + 0.5;
        this.targetZ = tz + 0.5;
      } else {
        this._pickTarget(world);
      }
      this.gait = 'run';
      this._retargetIn = 4;
    } else if (this._fleeTimer > 0) {
      this._fleeTimer = Math.max(0, this._fleeTimer - delta);
      if (this._fleeTimer <= 0) {
        this.isFleeing = false;
      }
    }

    // ── 2. Hunt — find nearest prey if not fed ──────────────────────────
    if (!this.isFleeing && this.fedTimer <= 0) {
      // Validate existing hunt target
      if (this.huntTarget && (this.huntTarget.isDead || this.huntTarget.isDead === undefined)) {
        this.huntTarget = null;
        this.isHunting = false;
      }

      if (!this.huntTarget) {
        // Scan for nearest prey
        let nearest = null;
        let nearestDist = HUNT_DETECT_DIST;
        for (const p of prey) {
          if (!p || p.isDead) continue;
          const d = Math.hypot(p.x - this.x, p.z - this.z);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = p;
          }
        }
        if (nearest) {
          this.huntTarget = nearest;
          this.isHunting = true;
        }
      }

      if (this.huntTarget && !this.huntTarget.isDead) {
        this.isHunting = true;
        this.gait = 'run';
        // Converge on prey
        this.targetX = this.huntTarget.x + this._formationOffsetX;
        this.targetZ = this.huntTarget.z + this._formationOffsetZ;
        this._retargetIn = 0.5;

        // Catch prey if close enough
        const catchDist = Math.hypot(this.huntTarget.x - this.x, this.huntTarget.z - this.z);
        if (catchDist < 0.5) {
          // Kill prey
          this.huntTarget.isDead = true;
          // Feed entire pack
          if (this.pack) {
            for (const w of this.pack) {
              if (w && !w.isDead) w.fedTimer = FED_DURATION;
            }
          } else {
            this.fedTimer = FED_DURATION;
          }
          this.huntTarget = null;
          this.isHunting = false;
          this.gait = 'idle';
          this._idleLeft = 3 + Math.random() * 4;
        }
      }
    } else if (this.fedTimer > 0) {
      this.isHunting = false;
      this.huntTarget = null;
    }

    // ── 2b. Domesticated dog — follow owner, assist with food yield ────
    if (this.owner && !this.owner.isDead) {
      this.isHunting = false;
      this.isFleeing = false;
      const od = Math.hypot(this.owner.x - this.x, this.owner.z - this.z);
      if (od > 1.5) {
        this.gait = 'walk';
        this.targetX = this.owner.x + (Math.random() - 0.5);
        this.targetZ = this.owner.z + (Math.random() - 0.5);
        this._retargetIn = 1;
      } else {
        this.gait = 'idle';
        this._idleLeft = 0.5;
      }
      // Reduce fear further when bonded
      this.fearLevel = Math.max(0, this.fearLevel - delta * 0.002);
    }

    // ── 3. Pack cohesion — rejoin pack centre if too far ───────────────
    if (!this.isFleeing && !this.isHunting && !this.owner) {
      const centre = this._packCentre();
      const distFromCentre = Math.hypot(centre.x - this.x, centre.z - this.z);
      if (distFromCentre > PACK_COHESION_DIST) {
        this.gait = 'walk';
        this.targetX = centre.x + this._formationOffsetX;
        this.targetZ = centre.z + this._formationOffsetZ;
        this._retargetIn = 2;
      }
    }

    // ── 4. Idle / wander logic ─────────────────────────────────────────
    this._retargetIn -= delta;

    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.hypot(dx, dz);
    const tx = dx / (dist || 1);
    const tz = dz / (dist || 1);

    if (this.gait === 'idle' && !this.isHunting && !this.isFleeing) {
      this._idleLeft -= delta;
      if (this._idleLeft <= 0 || this._retargetIn <= 0) {
        this._pickTarget(world);
        this.gait = Math.random() < 0.55 ? 'walk' : 'idle';
        this._idleLeft = 1.5 + Math.random() * 4;
        this._retargetIn = RETARGET_BASE + Math.random() * 4;
      }
      return;
    }

    if (!this.isHunting && !this.isFleeing && (dist < REACH_DIST || this._retargetIn <= 0)) {
      if (Math.random() < 0.4) {
        this.gait = 'idle';
        this._idleLeft = 1.5 + Math.random() * 4;
      } else {
        this._pickTarget(world);
        this.gait = 'walk';
      }
      this._retargetIn = RETARGET_BASE + Math.random() * 4;
      return;
    }

    // ── 5. Steer and move ──────────────────────────────────────────────
    const f = rotateFacingToward(
      this.facingX, this.facingZ, tx, tz,
      this.turnRate * delta,
    );
    this.facingX = f.x;
    this.facingZ = f.z;

    const speed = (this.isHunting || this.isFleeing) ? HUNT_SPEED : NORMAL_SPEED;
    const nx = this.x + this.facingX * speed * delta;
    const nz = this.z + this.facingZ * speed * delta;

    if (wolfTileOk(world, Math.floor(nx), Math.floor(nz))) {
      this.x = nx;
      this.z = nz;
    } else {
      this._pickTarget(world);
      this.gait = 'walk';
    }
  }
}

/**
 * Factory — create a pack of 4 wolves near (cx, cz).
 * @param {number} cx
 * @param {number} cz
 * @returns {Wolf[]}
 */
export function createWolfPack(cx, cz) {
  const pack = [];
  for (let i = 0; i < 4; i++) {
    const ox = (Math.random() - 0.5) * 3;
    const oz = (Math.random() - 0.5) * 3;
    const w = new Wolf(cx + ox, cz + oz, pack, i);
    pack.push(w);
  }
  return pack;
}
