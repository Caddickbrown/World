const PREDATOR_SPEED = 1.2; // tiles/sec
const WANDER_INTERVAL = 3;  // seconds between new wander targets

const DAMAGE = { wolf: 0.15, bear: 0.25 };
const BUILDING_SAFE_RADIUS = 3;

export class Predator {
  constructor(x, z, type = 'wolf') {
    this.type = type;
    this.x = x;
    this.z = z;
    this.health = 1.0;
    this.huntCooldown = 0;

    this.targetX = x;
    this.targetZ = z;
    this.wanderTimer = Math.random() * WANDER_INTERVAL;
  }

  tick(delta, agents, world) {
    // Tick cooldown
    if (this.huntCooldown > 0) this.huntCooldown -= delta;

    // Wander
    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = WANDER_INTERVAL + Math.random() * 2;
      this._pickWanderTarget(world);
    }

    // Move toward target
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.04) {
      const move = Math.min(PREDATOR_SPEED * delta, dist);
      this.x += (dx / dist) * move;
      this.z += (dz / dist) * move;
    }

    // Hunt: attack nearest agent in range
    if (this.huntCooldown <= 0) {
      this._tryHunt(agents, world);
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

  _tryHunt(agents, world) {
    for (const agent of agents) {
      if (agent.health <= 0 || agent.isDead) continue;

      const dist = Math.hypot(this.x - agent.x, this.z - agent.z);
      if (dist > 1.5) continue;

      // Don't attack agents near buildings
      if (this._isNearBuilding(agent, world)) continue;

      let damage = DAMAGE[this.type] || 0.15;

      // Vulnerable agents take double damage
      if (agent.health < 0.3 || !agent.knowledge.has('hunting')) {
        damage *= 2;
      }

      agent.health = Math.max(0, agent.health - damage);
      this.huntCooldown = 8;
      return; // one attack per tick
    }
  }

  _isNearBuilding(agent, world) {
    // Check if any tile within BUILDING_SAFE_RADIUS has a building-related structure
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
}
