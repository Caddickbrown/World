/**
 * SettlementSystem — tracks when agents cluster together long enough
 * to form a named settlement.
 */

const ADJECTIVES = [
  'Green', 'Old', 'High', 'Far', 'Bright',
  'Still', 'Deep', 'Red', 'Long', 'White',
];

const NOUNS = [
  'Haven', 'Hollow', 'Ridge', 'Brook', 'Stone',
  'Field', 'Glen', 'Hearth', 'Watch', 'Crossing',
];

let _nextId = 1;

export class SettlementSystem {
  constructor() {
    this.settlements = [];
    this.agentTimers = new Map(); // agentId -> proximity seconds
  }

  /**
   * Main tick — detect clusters and form settlements.
   * @param {number} delta — seconds elapsed
   * @param {object[]} agents
   * @param {object} world
   * @param {number} currentDay — game day for foundedDay
   */
  tick(delta, agents, world, currentDay) {
    const alive = agents.filter(a => a.health > 0);

    for (const agent of alive) {
      // Count nearby alive agents within 4 tiles
      let nearby = 0;
      const neighborIds = [];
      for (const other of alive) {
        if (other === agent) continue;
        const dist = Math.hypot(agent.x - other.x, agent.z - other.z);
        if (dist <= 4) {
          nearby++;
          neighborIds.push(other.id);
        }
      }

      if (nearby >= 2) {
        // Increment proximity timer
        const prev = this.agentTimers.get(agent.id) || 0;
        this.agentTimers.set(agent.id, prev + delta);

        // Check if threshold met and no settlement nearby
        if (prev + delta >= 30) {
          const tooClose = this.settlements.some(s =>
            Math.hypot(s.x - agent.x, s.z - agent.z) <= 6
          );
          if (!tooClose) {
            const memberIds = [agent.id, ...neighborIds];
            const settlement = {
              id: _nextId++,
              x: Math.round(agent.x),
              z: Math.round(agent.z),
              memberIds,
              name: null,
              foundedDay: currentDay ?? 0,
            };
            this.settlements.push(settlement);
            // Reset timers for founding members
            this.agentTimers.delete(agent.id);
            for (const nid of neighborIds) this.agentTimers.delete(nid);
          }
        }
      } else {
        // Reset timer when not enough neighbours
        this.agentTimers.delete(agent.id);
      }
    }
  }

  /**
   * Refresh settlement membership — agents within 6 tiles are members.
   * @param {object[]} agents
   */
  updateMembership(agents) {
    const alive = agents.filter(a => a.health > 0);
    for (const settlement of this.settlements) {
      settlement.memberIds = alive
        .filter(a => Math.hypot(a.x - settlement.x, a.z - settlement.z) <= 6)
        .map(a => a.id);
    }
    // Remove empty settlements
    this.settlements = this.settlements.filter(s => s.memberIds.length > 0);
  }

  /**
   * Name a settlement if any member has 'writing' knowledge.
   * @param {object} settlement
   * @param {object[]} agents
   */
  nameSettlement(settlement, agents) {
    if (settlement.name) return;
    const members = agents.filter(a => settlement.memberIds.includes(a.id));
    const hasWriting = members.some(a => a.knowledge?.has('writing'));
    if (!hasWriting) return;

    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    settlement.name = adj + ' ' + noun;
  }
}
