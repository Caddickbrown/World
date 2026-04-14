/**
 * TradingSystem — agent-to-agent item exchange.
 * Both agents must know the 'trade' concept. Swaps are mutually beneficial:
 * each agent gives something they have in surplus for something they lack.
 */

export class TradingSystem {
  /**
   * Find the nearest trade-capable agent within range.
   * @param {object} agent — must have .x, .z, .knowledge (Set)
   * @param {Array} agents — all agents
   * @param {number} maxDist — maximum tile distance (default 3)
   * @returns {object|null} nearest eligible partner or null
   */
  static findTradePartner(agent, agents, maxDist = 3) {
    if (!agent.knowledge.has('trade')) return null;

    let best = null;
    let bestDist = Infinity;

    for (const other of agents) {
      if (other === agent || other.health <= 0) continue;
      if (!other.knowledge.has('trade')) continue;

      const dist = Math.hypot(agent.x - other.x, agent.z - other.z);
      if (dist <= maxDist && dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }

    return best;
  }

  /**
   * Attempt a mutually beneficial trade between two agents.
   * Each agent gives 1 of a surplus item (qty > 2) that the other needs (has < 1 of).
   * @param {object} agentA
   * @param {object} agentB
   * @param {Map} itemDefs — item definitions
   * @returns {{ traded: boolean, aGave?: string, bGave?: string }}
   */
  static tryTrade(agentA, agentB, itemDefs) {
    if (!agentA.knowledge.has('trade') || !agentB.knowledge.has('trade')) {
      return { traded: false };
    }

    // Find an item A has in surplus that B needs
    const aGave = TradingSystem._findSurplusFor(agentA, agentB);
    if (!aGave) return { traded: false };

    // Find an item B has in surplus that A needs
    const bGave = TradingSystem._findSurplusFor(agentB, agentA);
    if (!bGave) return { traded: false };

    // Don't swap the same item
    if (aGave === bGave) return { traded: false };

    // Execute the swap
    agentA.inventory.remove(aGave, 1);
    agentB.inventory.add(aGave, 1, itemDefs);

    agentB.inventory.remove(bGave, 1);
    agentA.inventory.add(bGave, 1, itemDefs);

    return { traded: true, aGave, bGave };
  }

  /**
   * Find an item the giver has in surplus (qty > 2) that the receiver needs (has < 1 of).
   * @param {object} giver
   * @param {object} receiver
   * @returns {string|null} itemId or null
   */
  static _findSurplusFor(giver, receiver) {
    for (const stack of giver.inventory.stacks) {
      if (stack.quantity <= 2) continue;
      const receiverQty = receiver.inventory.count(stack.itemId);
      if (receiverQty < 1) return stack.itemId;
    }
    return null;
  }
}
