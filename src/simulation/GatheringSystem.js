import { TileType } from './World.js';

/**
 * Stateless gathering system.
 * Given an agent, a tile, and the item definitions, determines what items
 * the agent gathers and depletes the tile resource accordingly.
 */
export class GatheringSystem {
  /**
   * Attempt to gather items from a tile.
   * @param {object} agent - The gathering agent
   * @param {object} tile - The tile being gathered from
   * @param {object} world - The world (for adjacency checks)
   * @param {Map<string,object>} itemDefs - Item definitions keyed by id
   * @returns {Array<{itemId: string, quantity: number}>} items gathered
   */
  static gather(agent, tile, world, itemDefs) {
    if (!tile || tile.resource <= 0.01) return [];

    const results = [];
    const tileTypeName = tile.type;

    // Determine which activities are available on this tile
    const activities = GatheringSystem._getActivities(agent, tile, world, itemDefs);

    // Pick the best activity (prioritize food if hungry, else highest-yield)
    let activity = null;
    if (agent.needs.hunger < 0.5) {
      // Prefer food-producing activities when hungry
      activity = activities.find(a => a.foodItems.length > 0) ?? activities[0];
    } else {
      activity = activities[0];
    }
    if (!activity) return [];

    // Gather items from this activity
    let totalDepletion = 0;
    for (const itemDef of activity.items) {
      const [minYield, maxYield] = itemDef.gatherSource.baseYield;
      let toolMult = 1.0;

      // Tool multiplier from inventory
      const tool = agent.inventory?.getBestToolFor(activity.name, itemDefs);
      if (tool) {
        const toolDef = itemDefs.get(tool.itemId);
        toolMult = toolDef?.effects?.gatherMult ?? 1.0;
      }

      // Knowledge base bonus (small bonus even without tool)
      let knowledgeMult = 1.0;
      if (agent.knowledge.has('stone_tools')) knowledgeMult *= 1.08;
      if (agent.knowledge.has('metal_tools')) knowledgeMult *= 1.10;
      if (activity.name === 'fishing' && agent.knowledge.has('fishing')) knowledgeMult *= 1.05;
      if (activity.name === 'hunting' && agent.knowledge.has('hunting')) knowledgeMult *= 1.10;
      if (activity.name === 'foraging' && agent.knowledge.has('agriculture') && tileTypeName === TileType.GRASS) knowledgeMult *= 1.20;

      // Task bonus
      const taskGatherBonus = agent.task === 'gatherer' ? 1.05 : 1.0;

      // Resource availability scales yield
      const resourceMult = Math.max(0.2, tile.resource);

      // Water adjacency bonus for fishing
      const waterMult = activity.name === 'fishing' ? GatheringSystem.waterAdjacencyBonus(tile, world) : 1.0;

      // Calculate yield
      const rawYield = minYield + Math.random() * (maxYield - minYield);
      const finalYield = Math.max(0, Math.round(rawYield * toolMult * knowledgeMult * taskGatherBonus * resourceMult * waterMult));

      if (finalYield > 0) {
        results.push({ itemId: itemDef.id, quantity: finalYield });
        totalDepletion += 0.10 * finalYield / (toolMult * knowledgeMult);
      }
    }

    // Deplete tile resource
    if (totalDepletion > 0) {
      tile.resource = Math.max(0, tile.resource - totalDepletion);
      if (tile.depletionLevel !== undefined) tile.depletionLevel = Math.min(1, tile.depletionLevel + 0.05);
    }

    // Post-process: apply mushroom poison risk
    for (let i = results.length - 1; i >= 0; i--) {
      const gathered = results[i];
      const def = itemDefs.get(gathered.itemId);
      if (!def || !def.poisonChance) continue;

      // Herbalism knowledge protects against poisoning
      if (agent.knowledge.has('herbalism')) continue;

      if (Math.random() < def.poisonChance) {
        // Remove the mushrooms — they were poisonous
        results.splice(i, 1);
        // Apply poison damage to agent
        if (def.poisonEffect) {
          if (def.poisonEffect.health !== undefined && agent.health !== undefined) {
            agent.health = Math.max(0, agent.health + def.poisonEffect.health);
          }
        }
      }
    }

    return results;
  }

  /**
   * Determine available activities on a tile given agent knowledge.
   * @returns {Array<{name: string, items: object[], foodItems: object[]}>}
   */
  static _getActivities(agent, tile, world, itemDefs) {
    const tileTypeName = tile.type;
    const activities = [];

    // Check adjacency cache
    const hasAdjacentWater = world.hasAdjacentType(tile.x, tile.z, TileType.WATER) ||
                              world.hasAdjacentType(tile.x, tile.z, TileType.DEEP_WATER);

    // Build activity → items mapping from item definitions
    const activityMap = new Map(); // activity name → item defs[]

    for (const [id, def] of itemDefs) {
      const src = def.gatherSource;
      if (!src) continue;
      if (!src.tileTypes.includes(tileTypeName)) continue;

      // Check adjacency requirement
      if (src.adjacentTo) {
        if (src.adjacentTo === 'WATER' && !hasAdjacentWater) continue;
        if (src.adjacentTo !== 'WATER' && !world.hasAdjacentType(tile.x, tile.z, src.adjacentTo)) continue;
      }

      // Check knowledge requirements
      const hasKnowledge = (src.knowledge ?? []).every(k => agent.knowledge.has(k));
      if (!hasKnowledge) continue;

      if (!activityMap.has(src.activity)) activityMap.set(src.activity, []);
      activityMap.get(src.activity).push(def);
    }

    for (const [name, items] of activityMap) {
      const foodItems = items.filter(d => d.category === 'food');
      activities.push({ name, items, foodItems });
    }

    // Sort: activities with food items first
    activities.sort((a, b) => b.foodItems.length - a.foodItems.length);

    return activities;
  }

  /**
   * Returns a yield multiplier for water-adjacent tiles.
   * Coastal/water-adjacent GRASS or BEACH tiles get a 1.4x fishing bonus.
   * @param {object} tile - The tile being gathered from
   * @param {object} world - The world (for adjacency checks)
   * @returns {number} multiplier (1.0 or 1.4)
   */
  static waterAdjacencyBonus(tile, world) {
    if (tile.type !== 'GRASS' && tile.type !== 'BEACH') return 1.0;
    const hasWater = world.hasAdjacentType(tile.x, tile.z, 'WATER') ||
                     world.hasAdjacentType(tile.x, tile.z, 'DEEP_WATER');
    return hasWater ? 1.4 : 1.0;
  }

  /**
   * Attempt a hunt on the current tile.
   * Agents with 'hunting' knowledge on WOODLAND/FOREST/GRASS tiles have
   * an 8% chance per gather tick of a successful hunt yielding raw_meat.
   * TODO: track animal populations per tile for realistic depletion
   * @param {object} agent - The hunting agent
   * @param {object} tile - The tile being hunted on
   * @returns {Array<{itemId: string, quantity: number}>} hunt results
   */
  static hunt(agent, tile) {
    if (!agent.knowledge.has('hunting')) return [];
    const huntTiles = ['WOODLAND', 'FOREST', 'GRASS'];
    if (!huntTiles.includes(tile.type)) return [];

    // 8% chance of a successful hunt per tick
    if (Math.random() > 0.08) return [];

    const qty = 1 + Math.floor(Math.random() * 2); // 1-2
    return [{ itemId: 'raw_meat', quantity: qty }];
  }

  /**
   * Attempt to cook a raw food item using wood as fuel.
   * Requires agent to have 'fire' and 'cooking' knowledge.
   * @param {object} agent - The agent attempting to cook
   * @param {Map<string,object>} itemDefs - Item definitions keyed by id
   * @returns {boolean} true if cooking happened
   */
  static cook(agent, itemDefs) {
    if (!agent.knowledge.has('fire') || !agent.knowledge.has('cooking')) return false;
    if (!agent.inventory.has('wood')) return false;

    // Try to cook fish first, then meat
    for (const rawId of ['fish', 'meat']) {
      if (!agent.inventory.has(rawId)) continue;

      const rawDef = itemDefs.get(rawId);
      if (!rawDef?.cookedId) continue;

      agent.inventory.remove('wood', 1);
      agent.inventory.remove(rawId, 1);
      agent.inventory.add(rawDef.cookedId, 1);
      return true;
    }

    return false;
  }

  /**
   * Craft medicine from herbs. Requires herbalism knowledge.
   * 3 herbs → 1 medicine per call. Returns true if crafting happened.
   * @param {object} agent - The crafting agent
   * @param {Map<string,object>} itemDefs - Item definitions keyed by id
   * @returns {boolean} true if medicine was crafted
   */
  static craftMedicine(agent, itemDefs) {
    if (!agent.knowledge.has('herbalism')) return false;
    if (!agent.inventory.has('herbs')) return false;

    const herbStack = agent.inventory.stacks.find(s => s.itemId === 'herbs');
    if (!herbStack || herbStack.quantity < 3) return false;

    agent.inventory.remove('herbs', 3);
    agent.inventory.add('medicine', 1, itemDefs);
    return true;
  }
}


