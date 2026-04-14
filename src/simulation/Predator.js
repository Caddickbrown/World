import { TileType } from './World.js';

const PREDATOR_SPEED      = 1.2;  // tiles/sec wandering
const CHASE_SPEED         = 1.9;  // tiles/sec chasing prey
const WANDER_INTERVAL     = 3;    // seconds between new wander targets
const HUNT_RADIUS         = 8;    // tiles — detect prey within this range
const ATTACK_RADIUS       = 0.9;  // tiles — close enough to kill
const HUNT_COOLDOWN       = 12;   // seconds between kills
const ENERGY_GAIN         = 0.4;  // energy gained per kill
const ENERGY_DECAY        = 0.008; // energy lost per second (hunger)
const FLEE_RADIUS         = 6;    // tiles — sheep start fleeing at this range

const DAMAGE = { wolf: 0.15, bear: 0.25 };
const BUILDING_SAFE_RADIUS = 3;

export class Predator {
  constructor(x, z, type = 'wolf') {
    this.type = type;
    this.x = x;
    this.z = z;
    this.health = 1.0;
    this.energy = 0.5 + Math.random() * 0.5; // start partially fed
    this.huntCooldown = 0;

    this.targetX = x;
    this.targetZ = z;
    this.wanderTimer = Math.random() * WANDER_INTERVAL;

    /** The prey object currently being chased (sheep or agent), or null */
    this._prey = null;
  }

  /**
   * @param {number} delta
   * @param {Agent[]} agents  - human villagers
   * @param {World}   world
   * @param {Array}   sheep   - optional array of sheep objects from SheepRenderer
   *                           each must expose { x, z, health, isDead }
   *                           (SheepRenderer exposes this._sheep after CAD-96 patch)
   */
  tick(delta, agents, world, sheep = []) {
    // Hunger decay
    this.energy = Math.max(0, this.energy - ENERGY_DECAY * delta);

    // Tick cooldown
    if (this.huntCooldown > 0) this.huntCooldown -= delta;

    // ── Prey selection: find nearest prey when hungry and not on cooldown ──
    if (this.huntCooldown <= 0) {
      this._prey = this._findNearestPrey(agents, sheep);
    }

    // ── Chase prey or wander ────────────────────────────────────────────
    if (this._prey && this.huntCooldown <= 0) {
      const p = this._prey;
      if (p.isDead || p.health <= 0) {
        this._prey = null;
      } else {
        // Chase: set target to prey's current position
        this.targetX = p.x;
        this.targetZ = p.z;
      }
    } else {
      // Wander
      this.wanderTimer -= delta;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = WANDER_INTERVAL + Math.random() * 2;
        this._pickWanderTarget(world);
      }
    }

    // ── Move toward target (with water blocking) ────────────────────────
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.04) {
      const speed = (this._prey && this.huntCooldown <= 0) ? CHASE_SPEED : PREDATOR_SPEED;
      const move = Math.min(speed * delta, dist);
      const nx = this.x + (dx / dist) * move;
      const nz = this.z + (dz / dist) * move;
      // Block movement into water tiles (predators can't swim)
      if (world.isWalkable(Math.floor(nx), Math.floor(nz))) {
        this.x = nx;
        this.z = nz;
      } else {
        // Terrain blocked — abandon current target and pick a new wander target
        this._prey = null;
        this._pickWanderTarget(world);
      }
    }

    // ── Attack ──────────────────────────────────────────────────────────
    if (this.huntCooldown <= 0) {
      this._tryAttackPrey(agents, sheep, world);
    }
  }

  /** Find the nearest alive prey (sheep first if hungry, then agents) */
  _findNearestPrey(agents, sheep) {
    let best = null;
    let bestDist = HUNT_RADIUS;

    // Prefer sheep (easier prey, food chain appropriate)
    for (const s of sheep) {
      if (s.isDead || s.health <= 0) continue;
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (d < bestDist) { bestDist = d; best = s; }
    }

    // Fall back to agents if no sheep nearby
    for (const a of agents) {
      if (a.isDead || a.health <= 0) continue;
      const d = Math.hypot(a.x - this.x, a.z - this.z);
      if (d < bestDist) { bestDist = d; best = a; }
    }

    return best;
  }

  /** Attack prey that's within ATTACK_RADIUS */
  _tryAttackPrey(agents, sheep, world) {
    // Try sheep first
    for (const s of sheep) {
      if (s.isDead || s.health <= 0) continue;
      const dist = Math.hypot(this.x - s.x, this.z - s.z);
      if (dist > ATTACK_RADIUS) continue;
      s.health = 0;
      s.isDead = true;
      this.energy = Math.min(1.0, this.energy + ENERGY_GAIN);
      this.huntCooldown = HUNT_COOLDOWN;
      this._prey = null;
      return;
    }

    // Try agents (existing behaviour)
    for (const agent of agents) {
      if (agent.health <= 0 || agent.isDead) continue;
      const dist = Math.hypot(this.x - agent.x, this.z - agent.z);
      if (dist > 1.5) continue;
      if (this._isNearBuilding(agent, world)) continue;

      let damage = DAMAGE[this.type] || 0.15;
      if (agent.health < 0.3 || !agent.knowledge.has('hunting')) damage *= 2;
      agent.health = Math.max(0, agent.health - damage);
      this.huntCooldown = 8;
      return;
    }
  }

  _pickWanderTarget(world) {
    const radius = 5;
    for (let attempt = 0; attempt < 15; attempt++) {
      const tx = Math.floor(this.x) + Math.floor(Math.random() * radius * 2 + 1) - radius;
      const tz = Math.floor(this.z) + Math.floor(Math.random() * radius * 2 + 1) - radius;
      if (world.isWalkable(tx, tz)) {
        this.targetX = tx + 0.5;
        this.targetZ = tz + 0.5;
        return;
      }
    }
  }

  _isNearBuilding(agent, world) {
    const ax = Math.floor(agent.x);
    const az = Math.floor(agent.z);
    for (let dz = -BUILDING_SAFE_RADIUS; dz <= BUILDING_SAFE_RADIUS; dz++) {
      for (let dx = -BUILDING_SAFE_RADIUS; dx <= BUILDING_SAFE_RADIUS; dx++) {
        if (Math.hypot(dx, dz) > BUILDING_SAFE_RADIUS) continue;
        const tile = world.getTile(ax + dx, az + dz);
        if (tile && (tile.building || tile.hasBuilding)) return true;
      }
    }
    return false;
  }

  /** Returns the flee radius so SheepRenderer can query it */
  static get FLEE_RADIUS() { return FLEE_RADIUS; }
}
