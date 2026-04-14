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
}
