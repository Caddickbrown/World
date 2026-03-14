/**
 * Per-agent inventory container.
 * Stores item stacks with weight limits and spoilage.
 */
export class Inventory {
  /**
   * @param {number} maxWeight – carrying capacity in weight units
   */
  constructor(maxWeight = 10.0) {
    /** @type {Array<{itemId: string, quantity: number, spoilTimer: number}>} */
    this.stacks = [];
    this.maxWeight = maxWeight;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  /** Current total weight of all carried items */
  currentWeight(itemDefs) {
    let w = 0;
    for (const s of this.stacks) {
      const def = itemDefs.get(s.itemId);
      w += (def?.weight ?? 0) * s.quantity;
    }
    return w;
  }

  /** Whether adding one unit of itemId would exceed capacity */
  isFull(itemId, itemDefs) {
    const def = itemDefs.get(itemId);
    return this.currentWeight(itemDefs) + (def?.weight ?? 0) > this.maxWeight;
  }

  /** How many of a given item we carry */
  count(itemId) {
    const stack = this.stacks.find(s => s.itemId === itemId);
    return stack ? stack.quantity : 0;
  }

  /** Whether we have at least qty of itemId */
  has(itemId, qty = 1) {
    return this.count(itemId) >= qty;
  }

  /** All stacks matching a category */
  getByCategory(category, itemDefs) {
    return this.stacks.filter(s => itemDefs.get(s.itemId)?.category === category);
  }

  /** Best food item (highest hunger effect), or null */
  getBestFood(itemDefs) {
    let best = null;
    let bestVal = -1;
    for (const s of this.stacks) {
      const def = itemDefs.get(s.itemId);
      if (def?.category === 'food' && (def.effects?.hunger ?? 0) > bestVal) {
        bestVal = def.effects.hunger;
        best = s;
      }
    }
    return best;
  }

  /** Best tool for a given activity, or null */
  getBestToolFor(activity, itemDefs) {
    let best = null;
    let bestMult = 0;
    for (const s of this.stacks) {
      const def = itemDefs.get(s.itemId);
      if (def?.category === 'tool' && def.effects?.activities?.includes(activity)) {
        const mult = def.effects?.gatherMult ?? 1;
        if (mult > bestMult) { bestMult = mult; best = s; }
      }
    }
    return best;
  }

  /** Total count of food items */
  foodCount(itemDefs) {
    let n = 0;
    for (const s of this.stacks) {
      if (itemDefs.get(s.itemId)?.category === 'food') n += s.quantity;
    }
    return n;
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Add items. Returns the number actually added (may be less if weight-limited).
   */
  add(itemId, qty, itemDefs) {
    const def = itemDefs.get(itemId);
    if (!def) return 0;

    // Weight check — add as many as we can carry
    const weightPer = def.weight ?? 0;
    const currentW = this.currentWeight(itemDefs);
    const canCarry = weightPer > 0
      ? Math.floor((this.maxWeight - currentW) / weightPer)
      : qty;
    const toAdd = Math.min(qty, Math.max(0, canCarry));
    if (toAdd <= 0) return 0;

    // Merge into existing stack or create new one
    let stack = this.stacks.find(s => s.itemId === itemId);
    if (stack) {
      const maxStack = def.stackSize ?? 99;
      const space = maxStack - stack.quantity;
      const added = Math.min(toAdd, space);
      stack.quantity += added;
      // If stack is full but we have more, create overflow stack
      if (added < toAdd) {
        this.stacks.push({ itemId, quantity: toAdd - added, spoilTimer: 0 });
      }
    } else {
      this.stacks.push({ itemId, quantity: toAdd, spoilTimer: 0 });
    }
    return toAdd;
  }

  /**
   * Remove up to qty of itemId. Returns the number actually removed.
   */
  remove(itemId, qty = 1) {
    let removed = 0;
    for (let i = this.stacks.length - 1; i >= 0; i--) {
      const s = this.stacks[i];
      if (s.itemId !== itemId) continue;
      const take = Math.min(qty - removed, s.quantity);
      s.quantity -= take;
      removed += take;
      if (s.quantity <= 0) this.stacks.splice(i, 1);
      if (removed >= qty) break;
    }
    return removed;
  }

  /** Tick spoilage: decrement spoilTimer, remove fully spoiled stacks */
  tickSpoilage(delta, itemDefs) {
    for (let i = this.stacks.length - 1; i >= 0; i--) {
      const s = this.stacks[i];
      const def = itemDefs.get(s.itemId);
      const rate = def?.spoilRate ?? 0;
      if (rate <= 0) continue;
      s.spoilTimer += rate * delta;
      if (s.spoilTimer >= 1) {
        // Each full unit of spoilTimer removes one item
        const lost = Math.floor(s.spoilTimer);
        s.quantity -= lost;
        s.spoilTimer -= lost;
        if (s.quantity <= 0) this.stacks.splice(i, 1);
      }
    }
  }

  /** Apply spoilage reduction multiplier (e.g. from preservation/pottery knowledge) */
  tickSpoilageWithMult(delta, itemDefs, spoilMult = 1.0) {
    for (let i = this.stacks.length - 1; i >= 0; i--) {
      const s = this.stacks[i];
      const def = itemDefs.get(s.itemId);
      const rate = def?.spoilRate ?? 0;
      if (rate <= 0) continue;
      s.spoilTimer += rate * delta * spoilMult;
      if (s.spoilTimer >= 1) {
        const lost = Math.floor(s.spoilTimer);
        s.quantity -= lost;
        s.spoilTimer -= lost;
        if (s.quantity <= 0) this.stacks.splice(i, 1);
      }
    }
  }

  /** Drop all items (e.g. on death). Returns array of {itemId, quantity}. */
  dropAll() {
    const items = this.stacks.map(s => ({ itemId: s.itemId, quantity: s.quantity }));
    this.stacks = [];
    return items;
  }
}
