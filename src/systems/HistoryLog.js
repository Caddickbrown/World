/**
 * HistoryLog — records world events for the timeline panel.
 * Max 200 entries, oldest dropped when full.
 */
export class HistoryLog {
  constructor() {
    this.entries = [];
    this.MAX = 200;
  }

  /**
   * Add an event.
   * @param {string} type — 'discovery' | 'birth' | 'death' | 'weather' | 'milestone'
   * @param {string} message — human-readable description
   * @param {number} day — current game day
   */
  add(type, message, day) {
    this.entries.push({ type, message, day, id: Date.now() + Math.random() });
    if (this.entries.length > this.MAX) this.entries.shift();
  }

  /** Get entries newest-first */
  get recent() {
    return [...this.entries].reverse();
  }

  /** Icons per type */
  static icon(type) {
    return { discovery: '💡', birth: '👶', death: '💀', weather: '🌩️', milestone: '🏆' }[type] || '📋';
  }

  /**
   * Format a death event as a human-readable string.
   * @param {object} agent — must have .name
   * @param {string} cause — 'starvation', 'old_age', or 'unknown'
   * @returns {string}
   */
  static formatDeath(agent, cause) {
    const causeText = { starvation: 'starvation', old_age: 'old age', unknown: 'unknown causes' }[cause] || cause;
    return agent.name + ' died of ' + causeText;
  }

  /**
   * Convenience: log a death event with formatted message.
   * @param {object} agent
   * @param {string} cause
   * @param {number} day
   */
  addDeath(agent, cause, day) {
    const message = HistoryLog.formatDeath(agent, cause) + ' (Day ' + day + ')';
    this.add('death', message, day);
  }
}
