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
              tier: 'camp',
              population: memberIds.length,
              // CAD-181: settlement-level knowledge pool
              knowledgePool: new Set(),
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
      settlement.population = settlement.memberIds.length;
    }
    // Remove empty settlements
    this.settlements = this.settlements.filter(s => s.memberIds.length > 0);
  }

  /**
   * Name a settlement based on knowledge tier.
   * Tier 1 (camp): unnamed, fewer than 5 members, no writing
   * Tier 2 (hamlet): 5+ members, no writing — simple Adj+Noun name
   * Tier 3 (named): any member has writing — rich procedural name
   * @param {object} settlement
   * @param {object[]} agents
   */
  nameSettlement(settlement, agents) {
    if (settlement.name) return;
    const members = agents.filter(a => settlement.memberIds.includes(a.id));
    const hasWriting = members.some(a => a.knowledge?.has('writing'));

    if (hasWriting) {
      settlement.name = this._generateWrittenName(settlement);
      settlement.tier = 'named';
    } else if (settlement.memberIds.length >= 5) {
      const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
      const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
      settlement.name = adj + ' ' + noun;
      settlement.tier = 'hamlet';
    } else {
      settlement.tier = 'camp';
    }
  }

  /**
   * Generate a richer procedural name using prefix+suffix syllables.
   * Uses settlement position as a seed for deterministic output.
   * @param {object} settlement
   * @returns {string}
   */
  _generateWrittenName(settlement) {
    const prefixes = [
      'Ash', 'Elm', 'Oak', 'Thorn', 'Grey', 'Stone', 'Bright', 'Iron', 'Silver', 'Amber',
      'Crag', 'Marsh', 'Fern', 'Moss', 'Swift', 'Dark', 'High', 'Low', 'North', 'West',
    ];
    const suffixes = [
      'wick', 'ford', 'ham', 'ton', 'burgh', 'dale', 'vale', 'moor', 'wood', 'field',
      'thorpe', 'ley', 'bridge', 'well', 'gate', 'mere', 'haven', 'cross', 'cliff', 'shore',
    ];

    const seed = (settlement.x * 31 + settlement.z * 17) % (prefixes.length * suffixes.length);
    const prefix = prefixes[Math.abs(seed) % prefixes.length];
    const suffix = suffixes[Math.abs(Math.floor(seed / prefixes.length)) % suffixes.length];
    return prefix + suffix;
  }

  /**
   * Return the number of members in a settlement.
   * @param {object} settlement
   * @returns {number}
   */
  settlementPopulation(settlement) {
    return settlement.memberIds.length;
  }

  /**
   * Find the settlement an agent belongs to.
   * @param {object} agent
   * @returns {object|null}
   */
  getSettlementFor(agent) {
    return this.settlements.find(s => s.memberIds.includes(agent.id)) || null;
  }

  /**
   * CAD-181: Sync agent knowledge into settlement pool.
   * Call this after agents discover new concepts.
   * @param {object[]} agents
   */
  syncKnowledgePools(agents) {
    for (const settlement of this.settlements) {
      for (const agentId of settlement.memberIds) {
        const agent = agents.find(a => a.id === agentId);
        if (!agent) continue;
        for (const concept of agent.knowledge) {
          settlement.knowledgePool.add(concept);
        }
      }
    }
  }

  /**
   * CAD-181: When an agent joins a settlement, give them a 20% chance
   * to learn each concept in the settlement's knowledgePool.
   * @param {object} agent
   * @param {object} settlement
   */
  onAgentJoinsSettlement(agent, settlement) {
    if (!settlement.knowledgePool) return;
    for (const concept of settlement.knowledgePool) {
      if (!agent.knowledge.has(concept) && Math.random() < 0.20) {
        agent.knowledge.add(concept);
      }
    }
  }

  /**
   * CAD-181: Return all known concepts for a settlement by ID.
   * @param {number} settlementId
   * @returns {Set|null}
   */
  getSettlementKnowledge(settlementId) {
    const s = this.settlements.find(s => s.id === settlementId);
    return s ? s.knowledgePool : null;
  }
}
