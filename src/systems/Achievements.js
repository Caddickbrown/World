/**
 * Achievements — tracks and unlocks gameplay milestones.
 * Persists unlocked achievement IDs to localStorage.
 */
export class Achievements {
  static ACHIEVEMENTS = [
    {
      id: 'first_fire',
      title: 'Prometheus',
      description: 'First campfire concept discovered by any agent',
      icon: '🔥',
      check({ agents, conceptGraph }) {
        return agents.some(a =>
          a.knowledge && (a.knowledge.has('campfire') || a.knowledge.has('fire'))
        );
      },
    },
    {
      id: 'survivor',
      title: 'Survivor',
      description: 'Reach day 100',
      icon: '🏆',
      check({ day }) {
        return day >= 100;
      },
    },
    {
      id: 'community',
      title: 'Community',
      description: 'Population reaches 25',
      icon: '🏘️',
      check({ population }) {
        return population >= 25;
      },
    },
    {
      id: 'elder',
      title: 'Elder',
      description: 'An agent reaches 95% of max age',
      icon: '🧓',
      check({ agents }) {
        return agents.some(a => a.age != null && a.maxAge != null && a.age >= a.maxAge * 0.95);
      },
    },
    {
      id: 'polymath',
      title: 'Polymath',
      description: 'An agent learns 10 or more concepts',
      icon: '📚',
      check({ agents }) {
        return agents.some(a => a.knowledge && a.knowledge.size >= 10);
      },
    },
    {
      id: 'well_fed',
      title: 'Well Fed',
      description: 'All agents have hunger above 0.8',
      icon: '🥗',
      check({ agents }) {
        return agents.length > 0 && agents.every(a => a.hunger > 0.8);
      },
    },
  ];

  constructor() {
    this.unlocked = new Set(this._load());
  }

  _load() {
    try {
      const raw = localStorage.getItem('world-achievements');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _save() {
    localStorage.setItem('world-achievements', JSON.stringify([...this.unlocked]));
  }

  /**
   * Check all locked achievements against current world state.
   * Returns an array of newly unlocked achievement objects.
   */
  tick(worldState) {
    const newlyUnlocked = [];
    for (const achievement of Achievements.ACHIEVEMENTS) {
      if (this.unlocked.has(achievement.id)) continue;
      try {
        if (achievement.check(worldState)) {
          this.unlocked.add(achievement.id);
          newlyUnlocked.push(achievement);
        }
      } catch {
        // Skip achievements that fail due to missing data
      }
    }
    if (newlyUnlocked.length > 0) this._save();
    return newlyUnlocked;
  }

  /** Check if a specific achievement is unlocked */
  isUnlocked(id) {
    return this.unlocked.has(id);
  }

  /** Reset all achievements */
  reset() {
    this.unlocked.clear();
    this._save();
  }
}
