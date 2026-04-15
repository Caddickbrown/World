/**
 * ConflictSystem — lightweight faction rivalry + CAD-176 settlement wars.
 * Agents are split into two factions based on id. When population is high
 * and rival agents are close, minor conflicts can occur: energy drain and
 * a temporary knowledge-spread cooldown.
 *
 * CAD-176: Settlement-level war — if two settlements are within 8 tiles AND
 * both have food < 30% of carrying capacity (200), a war is triggered.
 * Agents from both settlements converge on each other; the larger settlement
 * wins, the smaller disbands (members become wanderers). Discovery log records
 * the event.
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

  // ── CAD-176: Settlement-level war ──────────────────────────────────────

  static FOOD_SCARCITY_THRESHOLD = 0.30; // < 30% of 200 carrying capacity = 60
  static SETTLEMENT_WAR_RANGE    = 8;    // tiles between settlement centres
  static WAR_COOLDOWN            = 300;  // game-seconds between wars per settlement pair

  /**
   * Check all settlement pairs for war conditions. Returns array of war events.
   * @param {object[]} settlements — from SettlementSystem.settlements
   * @param {object[]} agents
   * @param {number} currentDay
   * @param {Map} _warCooldowns — persisted between ticks: Map<"idA_idB", expiresAt>
   * @returns {{ warA: object, warB: object, winnerId: number, loserId: number }[]}
   */
  static checkSettlementWars(settlements, agents, currentDay, _warCooldowns) {
    const wars = [];
    const CARRYING = 200;
    const scarcityLine = CARRYING * ConflictSystem.FOOD_SCARCITY_THRESHOLD;

    for (let i = 0; i < settlements.length; i++) {
      for (let j = i + 1; j < settlements.length; j++) {
        const sA = settlements[i];
        const sB = settlements[j];

        // Distance check
        const dist = Math.hypot(sA.x - sB.x, sA.z - sB.z);
        if (dist > ConflictSystem.SETTLEMENT_WAR_RANGE) continue;

        // Both must have food scarcity
        const foodA = (sA.resources?.food ?? 0);
        const foodB = (sB.resources?.food ?? 0);
        if (foodA >= scarcityLine || foodB >= scarcityLine) continue;

        // Check cooldown
        const pairKey = `${Math.min(sA.id, sB.id)}_${Math.max(sA.id, sB.id)}`;
        if (_warCooldowns.has(pairKey)) {
          if (currentDay < _warCooldowns.get(pairKey)) continue;
        }

        // War triggered — set cooldown
        _warCooldowns.set(pairKey, currentDay + ConflictSystem.WAR_COOLDOWN / 86400);

        // Determine winner by population
        const popA = sA.memberIds.length;
        const popB = sB.memberIds.length;
        const winner = popA >= popB ? sA : sB;
        const loser  = popA >= popB ? sB : sA;

        wars.push({ warA: sA, warB: sB, winner, loser });
      }
    }
    return wars;
  }

  /**
   * Resolve a war event: move agents toward each other, reduce populations,
   * disband the loser settlement's members.
   * @param {object} warEvent — { warA, warB, winner, loser }
   * @param {object[]} agents
   * @param {object} historyLog
   * @param {number} currentDay
   * @param {object} settlementSystem
   */
  static resolveWar(warEvent, agents, historyLog, currentDay, settlementSystem) {
    const { winner, loser } = warEvent;

    const winnerAgents = agents.filter(a => winner.memberIds.includes(a.id) && a.health > 0);
    const loserAgents  = agents.filter(a => loser.memberIds.includes(a.id)  && a.health > 0);

    // Move agents toward each other (set targets to enemy settlement centre)
    for (const a of winnerAgents) {
      a.targetX = loser.x + 0.5;
      a.targetZ = loser.z + 0.5;
    }
    for (const a of loserAgents) {
      a.targetX = winner.x + 0.5;
      a.targetZ = winner.z + 0.5;
    }

    // Population losses: 10–20% of each side die
    const killFraction = 0.10 + Math.random() * 0.10;
    const killCount = (side) => Math.max(1, Math.floor(side.length * killFraction));

    const winnerKills = killCount(winnerAgents);
    const loserKills  = killCount(loserAgents);

    for (let k = 0; k < winnerKills && k < winnerAgents.length; k++) {
      const a = winnerAgents[k];
      a.health = 0;
      a.isDead = true;
      a.deathCause = 'conflict';
    }
    for (let k = 0; k < loserKills && k < loserAgents.length; k++) {
      const a = loserAgents[k];
      a.health = 0;
      a.isDead = true;
      a.deathCause = 'conflict';
    }

    // Surviving loser agents become wanderers (remove from settlement)
    const survivingLosers = loserAgents.filter(a => a.health > 0);
    for (const a of survivingLosers) {
      // They keep their position but are no longer in any settlement
      a._exiledFromSettlement = loser.id;
    }
    // Remove loser settlement from system
    if (settlementSystem) {
      settlementSystem.settlements = settlementSystem.settlements.filter(s => s.id !== loser.id);
    }

    // Log to discovery/history
    const winName  = winner.name || `Camp ${winner.id}`;
    const loseName = loser.name  || `Camp ${loser.id}`;
    if (historyLog) {
      historyLog.add('milestone', `War between ${winName} and ${loseName} — ${winName} prevails`, currentDay);
    }
  }
}
