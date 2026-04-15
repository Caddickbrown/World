/**
 * CAD-87: AnimalSkillSystem
 *
 * Tracks each animal's skill level for key behaviours. Skills increase
 * slightly (0.001 per game-second, i.e. ~0.001/day) with repeated successful
 * actions. Predators that hunt successfully get +hunting skill (future use).
 *
 * Usage:
 *   const skillSystem = new AnimalSkillSystem();
 *   // Each tick, pass the skills object to animal classes:
 *   const foxSkills = skillSystem.getSkills('fox', fox.id);
 *   fox.tick(delta, world, agents, foxSkills);
 *
 *   // Record a successful action:
 *   skillSystem.recordSuccess('fox', fox.id, 'foraging');
 */

const SKILL_GAIN_PER_SUCCESS = 0.005; // per successful action
const SKILL_PASSIVE_GAIN     = 0.001; // per game-second of activity (continuous)
const MAX_SKILL              = 1.0;

const DEFAULT_SKILLS = () => ({ foraging: 0, escape: 0, camouflage: 0 });

export class AnimalSkillSystem {
  constructor() {
    // Map of `${type}:${id}` -> skills object
    this._skills = new Map();
  }

  /**
   * Get (or create) the skills object for an animal.
   * @param {string} type - e.g. 'fox', 'deer', 'rabbit'
   * @param {number|string} id - unique id within that type
   * @returns {{ foraging: number, escape: number, camouflage: number }}
   */
  getSkills(type, id) {
    const key = `${type}:${id}`;
    if (!this._skills.has(key)) {
      this._skills.set(key, DEFAULT_SKILLS());
    }
    return this._skills.get(key);
  }

  /**
   * Record a successful action, incrementing the relevant skill.
   * @param {string} type
   * @param {number|string} id
   * @param {'foraging'|'escape'|'camouflage'|'hunting'} skill
   */
  recordSuccess(type, id, skill) {
    const s = this.getSkills(type, id);
    if (skill in s) {
      s[skill] = Math.min(MAX_SKILL, s[skill] + SKILL_GAIN_PER_SUCCESS);
    }
  }

  /**
   * Tick passive skill growth for all tracked animals.
   * Call once per game tick with game-time delta.
   * @param {number} delta - game-seconds elapsed
   */
  tick(delta) {
    for (const skills of this._skills.values()) {
      // Passive gain — tiny drift upward for all skills over time
      for (const key of Object.keys(skills)) {
        skills[key] = Math.min(MAX_SKILL, skills[key] + SKILL_PASSIVE_GAIN * delta);
      }
    }
  }

  /**
   * Remove a tracked animal (on death, reset, etc.).
   * @param {string} type
   * @param {number|string} id
   */
  remove(type, id) {
    this._skills.delete(`${type}:${id}`);
  }

  /**
   * Clear all tracked animals (e.g. on world reset).
   */
  clear() {
    this._skills.clear();
  }
}
