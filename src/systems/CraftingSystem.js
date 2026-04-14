/**
 * CraftingSystem — checks knowledge, consumes ingredients, produces items.
 */

const RECIPES = new Map([
  ['stone_tool', { id: 'stone_tool', requires: { knowledge: 'stone_tools', items: { stone: 1, wood: 1 } }, output: 'stone_tool', qty: 1 }],
  ['rope',       { id: 'rope',       requires: { knowledge: 'weaving',     items: { plant_fibre: 2 } },    output: 'rope',       qty: 1 }],
  ['campfire',   { id: 'campfire',   requires: { knowledge: 'fire',        items: { wood: 3, stone: 2 } }, output: 'campfire',   qty: 1 }],
  // CAD-204: plant/food recipes
  ['flour',      { id: 'flour',      requires: { knowledge: 'agriculture', items: { wild_grain: 3 } },     output: 'flour',      qty: 1 }],
  ['bread',      { id: 'bread',      requires: { knowledge: 'fire_making', items: { flour: 1 } },          output: 'bread',      qty: 1 }],
]);

export class CraftingSystem {
  static RECIPES = RECIPES;

  /**
   * Attempt to craft an item.
   * @param {object} agent   — must have .knowledge (Set) and .inventory with .has(id, qty), .remove(id, qty), .add(id, qty)
   * @param {string} recipeId
   * @param {Map}    itemDefs — item definition map (unused for now, reserved for future validation)
   * @returns {{ success: boolean, reason?: string }}
   */
  static craft(agent, recipeId, itemDefs) {
    const recipe = RECIPES.get(recipeId);
    if (!recipe) return { success: false, reason: 'unknown_recipe' };

    // Knowledge gate
    if (!agent.knowledge.has(recipe.requires.knowledge)) {
      return { success: false, reason: 'missing_knowledge' };
    }

    // Check ingredients
    for (const [itemId, qty] of Object.entries(recipe.requires.items)) {
      if (!agent.inventory.has(itemId, qty)) {
        return { success: false, reason: 'missing_items' };
      }
    }

    // Consume ingredients
    for (const [itemId, qty] of Object.entries(recipe.requires.items)) {
      agent.inventory.remove(itemId, qty);
    }

    // Produce output
    agent.inventory.add(recipe.output, recipe.qty);
    return { success: true };
  }
}
