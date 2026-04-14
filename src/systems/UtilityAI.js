/**
 * UtilityAI — scored action selection for agents.
 * Replaces the if/else priority ladder in Agent._decideAction().
 *
 * Usage (from Agent.js):
 *   import { UtilityAI } from '../systems/UtilityAI.js';
 *   // In _decideAction():
 *   const action = UtilityAI.bestAction(this, world, allAgents, conceptGraph);
 *   // action.name: 'eat', 'sleep', 'gather', 'socialize', 'fish', 'craft', 'hunt', 'wander', 'perform'
 *   // action.score: 0-1
 */

import { CraftingSystem } from '../systems/CraftingSystem.js';
import { TileType } from '../simulation/World.js';

export class UtilityAI {

  /** Clamp a value to the 0-1 range. */
  static _clamp01(x) { return Math.max(0, Math.min(1, x)); }

  /**
   * Score all candidate actions and return the highest-scoring one.
   * @param {Agent} agent
   * @param {World} world
   * @param {Agent[]} allAgents
   * @param {ConceptGraph} conceptGraph
   * @returns {{ name: string, score: number, target?: any }}
   */
  static bestAction(agent, world, allAgents, conceptGraph) {
    const candidates = [
      { name: 'eat',       score: this._eatScore(agent) },
      { name: 'sleep',     score: this._sleepScore(agent) },
      { name: 'gather',    score: this._gatherScore(agent, world) },
      { name: 'socialize', score: this._socialScore(agent, allAgents) },
      { name: 'fish',      score: this._fishScore(agent, world) },
      { name: 'hunt',      score: this._huntScore(agent, world) },
      { name: 'craft',     score: this._craftScore(agent) },
      { name: 'perform',   score: this._performScore(agent) },
      { name: 'wander',    score: this._wanderScore() },
    ];

    // Sort descending by score, return the winner
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  // ── Utility curves (0-1 output) ──────────────────────────────────────

  /**
   * Eat score — high when hunger is low AND agent has food in inventory.
   * Multiplied by 1.5 if inventory contains food, zeroed if not.
   */
  static _eatScore(agent) {
    const base = this._clamp01(1.2 - agent.needs.hunger * 1.4);
    const hasFood = agent.inventory && agent.inventory.hasAnyFood
      ? agent.inventory.hasAnyFood()
      : agent.inventory && agent.inventory.stacks && agent.inventory.stacks.some(s => s.itemId && s.itemId.includes('food') || s.itemId === 'cooked_meat' || s.itemId === 'berries' || s.itemId === 'raw_meat');
    return base * (hasFood ? 1.5 : 0);
  }

  /**
   * Sleep score — peaks when energy drops below 0.35.
   */
  static _sleepScore(agent) {
    return this._clamp01(1.1 - agent.needs.energy * 1.3);
  }

  /**
   * Gather score — only positive when hungry, scaled by tile food availability.
   */
  static _gatherScore(agent, world) {
    const base = this._clamp01((0.7 - agent.needs.hunger) * 2);
    // Boost if current tile is a food-bearing type
    const tx = Math.floor(agent.x);
    const tz = Math.floor(agent.z);
    const tile = world.getTile(tx, tz);
    const foodTile = tile && (tile.type === TileType.GRASS || tile.type === TileType.FOREST || tile.type === TileType.WOODLAND);
    return base * (foodTile ? 1.3 : 1.0);
  }

  /**
   * Social score — available when social cooldown expired and other agents nearby.
   */
  static _socialScore(agent, allAgents) {
    if (agent.socialTimer > 0) return 0;
    const nearby = allAgents.filter(a =>
      a !== agent && a.health > 0 && Math.hypot(a.x - agent.x, a.z - agent.z) < 5
    );
    if (nearby.length === 0) return 0;
    return this._clamp01(0.4 + agent.curiosity * 0.3);
  }

  /**
   * Fish score — requires fishing knowledge and proximity to water.
   */
  static _fishScore(agent, world) {
    if (!agent.knowledge.has('fishing')) return 0;
    if (!this._isNearWater(agent, world)) return 0;
    return 0.35;
  }

  /**
   * Hunt score — requires hunting knowledge and adult status.
   */
  static _huntScore(agent, world) {
    if (!agent.knowledge.has('hunting')) return 0;
    if (!agent.isAdult) return 0;
    return 0.3;
  }

  /**
   * Craft score — positive when the agent can craft at least one recipe.
   */
  static _craftScore(agent) {
    // Check each recipe to see if the agent meets knowledge + item requirements
    let available = 0;
    for (const [id, recipe] of CraftingSystem.RECIPES) {
      if (!agent.knowledge.has(recipe.requires.knowledge)) continue;
      let hasItems = true;
      for (const [itemId, qty] of Object.entries(recipe.requires.items)) {
        if (!agent.inventory.has(itemId, qty)) { hasItems = false; break; }
      }
      if (hasItems) available++;
    }
    return available > 0 ? 0.25 : 0;
  }

  /**
   * Perform score — requires music or art knowledge and sufficient energy.
   */
  static _performScore(agent) {
    const hasPerformSkill = agent.knowledge.has('music') || agent.knowledge.has('art');
    if (!hasPerformSkill) return 0;
    if (agent.needs.energy <= 0.6) return 0;
    return 0.3;
  }

  /**
   * Wander score — always-available baseline fallback.
   */
  static _wanderScore() {
    return 0.2;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Check if the agent is near water (current tile or any adjacent tile).
   */
  static _isNearWater(agent, world) {
    const tx = Math.floor(agent.x);
    const tz = Math.floor(agent.z);
    const waterTypes = [TileType.WATER, TileType.DEEP_WATER, TileType.BEACH];
    // Check current tile and all 8 neighbours
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const tile = world.getTile(tx + dx, tz + dz);
        if (tile && waterTypes.includes(tile.type)) return true;
      }
    }
    return false;
  }
}
