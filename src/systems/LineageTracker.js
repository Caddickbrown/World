/**
 * LineageTracker — records which agent first discovered each concept.
 * Works alongside ConceptGraph.firstDiscoverer but provides a
 * standalone queryable store.
 */
export class LineageTracker {
  constructor() {
    /** @type {Map<string, {conceptId: string, name: string, id: number, day: number}>} */
    this.discoveries = new Map();
  }

  /**
   * Record a first discovery. Ignores duplicates — only the first call
   * per conceptId is stored.
   */
  record(conceptId, agent, day) {
    if (this.discoveries.has(conceptId)) return;
    this.discoveries.set(conceptId, {
      conceptId,
      name: agent.name,
      id: agent.id,
      day,
    });
  }

  /** Returns the discoverer entry for a concept, or null. */
  getDiscoverer(conceptId) {
    return this.discoveries.get(conceptId) ?? null;
  }

  /** Returns all discovery entries sorted by day ascending. */
  allDiscoveries() {
    return [...this.discoveries.values()].sort((a, b) => a.day - b.day);
  }
}
