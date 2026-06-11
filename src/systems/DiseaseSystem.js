/**
 * DiseaseSystem — infection onset and proximity spread. Runs worker-side.
 *
 * Per-agent infection progression (health/energy drain, recovery, immunity)
 * lives in Agent.tick; this system decides who gets infected: a rare daily
 * onset roll plus spread between nearby agents via the spatial grid.
 * Medicine knowledge — the agent's own or their settlement's pool — halves
 * the spread chance and shortens the infection.
 */
export class DiseaseSystem {
  static ONSET_CHANCE_PER_DAY = 0.04;
  static SPREAD_RADIUS = 2;          // tiles
  static SPREAD_CHANCE_PER_SEC = 0.05;
  static BASE_DURATION = 60;         // game-sec until natural recovery
  static MEDICINE_DURATION = 35;

  constructor() {
    this._lastDay = -1;
    this._spreadTimer = 0;
    this._infectedIds = new Set();
  }

  /**
   * @param {number} delta — game-seconds since last tick
   * @param {object[]} agents
   * @param {object} spatialGrid — must support getNearby(x, z, radius)
   * @param {number} day — current game day (onset rolled once per day)
   * @param {object} settlementSystem — for settlement medicine pools (optional)
   * @returns {{ type: 'outbreak'|'recovery', agent: object }[]} transitions this tick
   */
  tick(delta, agents, spatialGrid, day, settlementSystem = null) {
    const events = [];

    // Daily onset roll — at most one spontaneous infection per day
    if (day !== this._lastDay) {
      this._lastDay = day;
      if (Math.random() < DiseaseSystem.ONSET_CHANCE_PER_DAY) {
        const healthy = agents.filter(a => a.health > 0 && !a.infected && !a.isImmune);
        if (healthy.length > 0) {
          const victim = healthy[Math.floor(Math.random() * healthy.length)];
          this._infect(victim, settlementSystem);
          events.push({ type: 'outbreak', agent: victim });
        }
      }
    }

    // Throttled spread pass (~1s); interval keeps the chance rate-correct
    this._spreadTimer += delta;
    if (this._spreadTimer >= 1) {
      const interval = this._spreadTimer;
      this._spreadTimer = 0;
      for (const a of agents) {
        if (!a.infected || a.health <= 0) continue;
        // +1 slop: grid positions can be up to one tick stale
        for (const other of spatialGrid.getNearby(a.x, a.z, DiseaseSystem.SPREAD_RADIUS + 1)) {
          if (other === a || other.health <= 0 || other.infected || other.isImmune) continue;
          if (Math.hypot(other.x - a.x, other.z - a.z) > DiseaseSystem.SPREAD_RADIUS) continue;
          let chance = DiseaseSystem.SPREAD_CHANCE_PER_SEC * interval;
          if (this._hasMedicineAccess(other, settlementSystem)) chance *= 0.5;
          if (Math.random() < chance) this._infect(other, settlementSystem);
        }
      }
    }

    // Recovery transitions — Agent.tick clears `infected` when its timer expires
    for (const id of [...this._infectedIds]) {
      const agent = agents.find(a => a.id === id);
      if (!agent || agent.health <= 0) { this._infectedIds.delete(id); continue; }
      if (!agent.infected) {
        this._infectedIds.delete(id);
        events.push({ type: 'recovery', agent });
      }
    }

    return events;
  }

  _infect(agent, settlementSystem) {
    agent.infected = true;
    agent.infectionTimer = 0;
    agent.infectionDuration = this._hasMedicineAccess(agent, settlementSystem)
      ? DiseaseSystem.MEDICINE_DURATION
      : DiseaseSystem.BASE_DURATION;
    this._infectedIds.add(agent.id);
  }

  _hasMedicineAccess(agent, settlementSystem) {
    if (agent.knowledge.has('medicine')) return true;
    const settlement = settlementSystem?.settlements?.find(s => s.memberIds?.includes(agent.id));
    return !!settlement?.knowledgePool?.has('medicine');
  }
}
