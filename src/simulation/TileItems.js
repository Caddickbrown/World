/**
 * Sparse storage for items sitting on the ground (per-tile).
 * Key format: "x,z" → Array of { itemId, quantity, spoilTimer }.
 */
const MAX_STACKS_PER_TILE = 20;

export class TileItems {
  constructor() {
    /** @type {Map<string, Array<{itemId: string, quantity: number, spoilTimer: number}>>} */
    this._items = new Map();
  }

  _key(tx, tz) { return `${tx},${tz}`; }

  /** Add items to a tile. */
  add(tx, tz, itemId, quantity) {
    const key = this._key(tx, tz);
    let stacks = this._items.get(key);
    if (!stacks) {
      stacks = [];
      this._items.set(key, stacks);
    }
    // Merge into existing stack
    const existing = stacks.find(s => s.itemId === itemId);
    if (existing) {
      existing.quantity += quantity;
    } else if (stacks.length < MAX_STACKS_PER_TILE) {
      stacks.push({ itemId, quantity, spoilTimer: 0 });
    }
    // else: tile is full, items are lost (rotted away)
  }

  /** Remove up to qty of an item from a tile. Returns amount removed. */
  remove(tx, tz, itemId, quantity) {
    const key = this._key(tx, tz);
    const stacks = this._items.get(key);
    if (!stacks) return 0;
    const stack = stacks.find(s => s.itemId === itemId);
    if (!stack) return 0;
    const take = Math.min(quantity, stack.quantity);
    stack.quantity -= take;
    if (stack.quantity <= 0) {
      stacks.splice(stacks.indexOf(stack), 1);
      if (stacks.length === 0) this._items.delete(key);
    }
    return take;
  }

  /** Get all item stacks on a tile (or empty array). */
  getItems(tx, tz) {
    return this._items.get(this._key(tx, tz)) ?? [];
  }

  /**
   * Tick spoilage on all ground items (2× faster than inventory by default).
   * @param {number} delta — game-seconds elapsed
   * @param {Map} itemDefs — item definitions
   * @param {number} [disasterMult=1.0] — extra multiplier from DisasterSystem (e.g. 5× during blight)
   */
  tickSpoilage(delta, itemDefs, disasterMult = 1.0) {
    const GROUND_SPOIL_MULT = 2.0;
    const totalMult = GROUND_SPOIL_MULT * disasterMult;
    for (const [key, stacks] of this._items) {
      for (let i = stacks.length - 1; i >= 0; i--) {
        const s = stacks[i];
        const def = itemDefs.get(s.itemId);
        const rate = def?.spoilRate ?? 0;
        if (rate <= 0) continue;
        s.spoilTimer += rate * delta * totalMult;
        if (s.spoilTimer >= 1) {
          const lost = Math.floor(s.spoilTimer);
          s.quantity -= lost;
          s.spoilTimer -= lost;
          if (s.quantity <= 0) stacks.splice(i, 1);
        }
      }
      if (stacks.length === 0) this._items.delete(key);
    }
  }

  /** All occupied tile keys (for rendering). */
  getAllOccupied() {
    return this._items;
  }

  /** Reset all ground items. */
  clear() {
    this._items.clear();
  }
}
