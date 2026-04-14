/**
 * ConflictSystem — lightweight faction rivalry.
 * Agents are split into two factions based on id. When population is high
 * and rival agents are close, minor conflicts can occur: energy drain and
 * a temporary knowledge-spread cooldown.
 */
export class ConflictSystem {
  static CONFLICT_RANGE = 1.5;
  static CONFLICT_CHANCE = 0.20;
  static ENERGY_PENALTY = 0.05;
  static COOLDOWN_DURATION = 30; // seconds
  static POP_THRESHOLD = 15;

  /**
   * Assign a faction to an agent based on its id.
   * Call at spawn time.
   */
  static assignFaction(agent) {
    // Use char code sum for string ids, direct mod for numbers
    const idVal = typeof agent.id === 'number'
      ? agent.id
      : [...String(agent.id)].reduce((s, c) => s + c.charCodeAt(0), 0);
    agent.faction = idVal % 2;
    agent.conflictCooldown = 0;
  }

  /**
   * Check for a conflict between two agents.
   * @param {object} agentA
   * @param {object} agentB
   * @param {number} aliveCount — current living population
   * @param {number} delta — frame delta in seconds
   * @returns {{ occurred: boolean, a: object, b: object } | null}
   */
  static checkConflict(agentA, agentB, aliveCount, delta) {
    // Both must be alive
    if (agentA.health <= 0 || agentB.health <= 0) return null;

    // Population must exceed threshold
    if (aliveCount <= ConflictSystem.POP_THRESHOLD) return null;

    // Must be different factions
    if (agentA.faction === agentB.faction) return null;
    if (agentA.faction == null || agentB.faction == null) return null;

    // Both must not be on cooldown
    if (agentA.conflictCooldown > 0 || agentB.conflictCooldown > 0) return null;

    // Must be within range
    const dist = Math.hypot(agentA.x - agentB.x, agentA.z - agentB.z);
    if (dist > ConflictSystem.CONFLICT_RANGE) return null;

    // Probability check (scaled by delta to be frame-rate independent)
    // Convert per-encounter chance to per-second: ~20% chance per second of proximity
    if (Math.random() > ConflictSystem.CONFLICT_CHANCE * delta) return null;

    // Conflict occurs
    agentA.needs.energy = Math.max(0, (agentA.needs.energy ?? 1) - ConflictSystem.ENERGY_PENALTY);
    agentB.needs.energy = Math.max(0, (agentB.needs.energy ?? 1) - ConflictSystem.ENERGY_PENALTY);
    agentA.conflictCooldown = ConflictSystem.COOLDOWN_DURATION;
    agentB.conflictCooldown = ConflictSystem.COOLDOWN_DURATION;

    return { occurred: true, a: agentA, b: agentB };
  }

  /**
   * Tick down conflict cooldowns for all agents. Call once per frame.
   * @param {object[]} agents
   * @param {number} delta
   */
  static updateCooldowns(agents, delta) {
    for (const agent of agents) {
      if (agent.conflictCooldown > 0) {
        agent.conflictCooldown = Math.max(0, agent.conflictCooldown - delta);
      }
    }
  }

  /**
   * Whether an agent can currently receive knowledge spread.
   * Returns false if on conflict cooldown.
   */
  static canReceiveKnowledge(agent) {
    return !(agent.conflictCooldown > 0);
  }
}
