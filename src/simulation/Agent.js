import { TileType } from './World.js';
import { Inventory } from './Inventory.js';
import { GatheringSystem } from './GatheringSystem.js';

let nextId = 1;

const AGENT_SPEED     = 1.8;   // tiles/sec
const HUNGER_DRAIN    = 1 / 90; // full → empty in 90 game-sec
const ENERGY_DRAIN    = 1 / 200;
const ENERGY_RECOVER  = 1 / 20;
const SOCIAL_COOLDOWN = 4;      // game-sec between social checks

export const AgentState = {
  WANDERING:   'wandering',
  GATHERING:   'gathering',
  SLEEPING:    'sleeping',
  SOCIALIZING: 'socializing',
  DISCOVERING: 'discovering',
  FISHING:     'fishing',
  PERFORMING:  'performing',
};

export class Agent {
  constructor(x, z) {
    this.id = nextId++;
    this.name = randomName();

    // Position in tile-space (fractional)
    this.x = x;
    this.z = z;
    this.targetX = x;
    this.targetZ = z;

    // Needs: 1.0 = full/satisfied, 0.0 = critical
    this.needs = { hunger: 0.8 + Math.random() * 0.2, energy: 0.8 + Math.random() * 0.2 };

    this.state = AgentState.WANDERING;
    this.knowledge = new Set();   // set of concept IDs

    /** Personality traits — 0.0 to 1.0 */
    this.personality = {
      curiosity:       0.3 + Math.random() * 0.5,   // drives exploration and discovery
      sociability:     0.2 + Math.random() * 0.6,   // drives social interactions
      industriousness: 0.3 + Math.random() * 0.5,   // drives gathering and crafting
      courage:         0.2 + Math.random() * 0.6,   // drives hunting and risk-taking
      creativity:      0.2 + Math.random() * 0.6,   // drives art and innovation
      caution:         0.2 + Math.random() * 0.6,   // drives defensive and careful behaviour
    };
    this.age        = 0;
    this.health     = 1.0;

    /** Life stage: 'infant' | 'child' | 'adult' | 'elder' */
    this.lifeStage = 'infant';
    this.maxAge     = 180 + Math.random() * 180; // game-seconds (die of old age)

    this.restTimer    = 0;
    this.discoveryFlash = 0;  // countdown for glow effect (game-sec)
    this.socialTimer  = Math.random() * SOCIAL_COOLDOWN;

    // Reproduction: becomes eligible after maturity, then on cooldown after each birth
    this.reproductionCooldown = 24 + Math.random() * 36; // game-sec until first eligibility
    this.isAdult = false; // flips true once age >= maturity threshold

    this.selected = false;
    this.isDragged = false;
    this.facingX = 0;
    this.facingZ = 1;

    /** WildHorse this agent is currently riding, or null */
    this.mountedHorse = null;
    this._rideTimer = 0;

    /** Speech bubble text and timer */
    this.speechBubble = null;
    this.speechBubbleTimer = 0;

    /** Fishing session countdown (game-sec) */
    this.fishingTimer = 0;
    this._fishingTrip = false;

    /** Performing session countdown (game-sec) */
    this.performTimer = 0;

    /** Task role (gatherer, teacher, scout, carer) — set when Organisation is discovered */
    this.task = null;

    /** Inventory system */
    this.inventory = new Inventory();

    /** How often the agent re-evaluates its needs even mid-wander (game-sec) */
    this._needsCheckTimer = 2 + Math.random() * 3;
    /** Store last weatherMult so _decideAction can consider it */
    this._lastWeatherMult = 1.0;
    /** Cooldown before this agent can light another campfire (game-sec) */
    this._fireCooldown = 20 + Math.random() * 20;

    /** Starvation: tracks how long hunger has been at zero (game-sec) */
    this.starvationTimer = 0;

    /** Cause of death: 'starvation', 'old_age', or null if alive */
    this.deathCause = null;
  }

  static get TASKS() {
    return {
      gatherer: { icon: '🌾', name: 'Gatherer', gatherThreshold: 0.5, gatherBonus: 1.05 },
      teacher:  { icon: '📢', name: 'Teacher', seekSocial: true, spreadBonus: 1.1 },
      scout:    { icon: '🔭', name: 'Scout', wanderRadiusBonus: 3, discoveryBonus: 1.15 },
      carer:    { icon: '💚', name: 'Carer', restThreshold: 0.35, restBonus: 1.1 },
    };
  }

  /** Calculate current life expectancy bonus from knowledge */
  get ageBonus() {
    return (this.knowledge.has('fire') ? 0.10 : 0) + (this.knowledge.has('shelter') ? 0.10 : 0)
      + (this.knowledge.has('cooking') ? 0.15 : 0) + (this.knowledge.has('medicine') ? 0.20 : 0)
      + (this.knowledge.has('clothing') ? 0.08 : 0) + (this.knowledge.has('housing') ? 0.12 : 0)
      + (this.knowledge.has('community') ? 0.10 : 0) + (this.knowledge.has('agriculture') ? 0.15 : 0)
      + (this.knowledge.has('preservation') ? 0.10 : 0) + (this.knowledge.has('herding') ? 0.08 : 0);
  }

  /** Effective max age including knowledge bonuses */
  get lifeExpectancy() {
    return this.maxAge * (1 + this.ageBonus);
  }

  /** True when the agent has reached 75% of its effective lifespan */
  get isElderly() { return this.age >= this.lifeExpectancy * 0.75; }

  /** Movement speed multiplier — elderly agents slow down */
  get speedMult() { return this.isElderly ? 0.7 : 1.0; }

  /** Gathering efficiency multiplier — elderly agents gather less */
  get gatherMult() { return this.isElderly ? 0.8 : 1.0; }

  /** Backward-compatible curiosity accessor */
  get curiosity() { return this.personality.curiosity; }

  /** Social interaction multiplier based on personality */
  get socialMult() { return 0.7 + this.personality.sociability * 0.6; }

  /** Discovery multiplier based on personality */
  get discoveryMult() { return 0.8 + this.personality.curiosity * 0.4; }

  /** Life stage modifiers affecting speed, gathering, social, and reproduction */
  get lifeStageModifiers() {
    switch (this.lifeStage) {
      case 'infant': return { speedMult: 0.5, gatherMult: 0.3, socialMult: 0.5, canReproduce: false, teachable: true };
      case 'child':  return { speedMult: 0.8, gatherMult: 0.6, socialMult: 1.2, canReproduce: false, teachable: true };
      case 'adult':  return { speedMult: 1.0, gatherMult: 1.0, socialMult: 1.0, canReproduce: true, teachable: true };
      case 'elder':  return { speedMult: 0.65, gatherMult: 0.75, socialMult: 1.3, canReproduce: false, teachable: true };
      default:       return { speedMult: 1.0, gatherMult: 1.0, socialMult: 1.0, canReproduce: true, teachable: true };
    }
  }

  _updateLifeStage() {
    const ratio = this.age / this.lifeExpectancy;
    if (ratio < 0.12)      this.lifeStage = 'infant';
    else if (ratio < 0.25) this.lifeStage = 'child';
    else if (ratio < 0.75) this.lifeStage = 'adult';
    else                   this.lifeStage = 'elder';
  }

  /** Generate offspring personality from two parents */
  static inheritPersonality(parentA, parentB) {
    const traits = ['curiosity', 'sociability', 'industriousness', 'courage', 'creativity', 'caution'];
    const child = {};
    for (const t of traits) {
      const parentVal = (parentA.personality[t] + parentB.personality[t]) / 2;
      const mutation = (Math.random() - 0.5) * 0.2;
      child[t] = Math.max(0, Math.min(1, parentVal + mutation));
    }
    return child;
  }

  /** True while the agent has post-infection immunity */
  get isImmune() { return this.immuneTimer > 0; }

  _adoptTask(allAgents) {
    if (this.task || !this.knowledge.has('organisation')) return;
    const tasks = Object.keys(Agent.TASKS);
    const taken = new Set(allAgents.filter(a => a.task).map(a => a.task));
    const available = tasks.filter(t => !taken.has(t));
    const pool = available.length > 0 ? available : tasks;

    // Personality-weighted task selection
    const weights = pool.map(t => {
      if (t === 'gatherer') return 0.5 + this.personality.industriousness;
      if (t === 'teacher')  return 0.5 + this.personality.sociability;
      if (t === 'scout')    return 0.5 + this.personality.curiosity;
      if (t === 'carer')    return 0.5 + this.personality.caution;
      return 1.0;
    });
    const totalW = weights.reduce((s, w) => s + w, 0);
    let roll = Math.random() * totalW;
    for (let i = 0; i < pool.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { this.task = pool[i]; return; }
    }
    this.task = pool[pool.length - 1];
  }

  // ── Main tick ─────────────────────────────────────────────────────────

  tick(delta, world, allAgents, conceptGraph, weatherMult = 1.0, itemDefs = null, season = null) {
    this.age += delta;

    // Starvation: track time at zero hunger, die after 15 game-sec
    if (this.needs.hunger <= 0) {
      this.starvationTimer += delta;
      if (this.starvationTimer >= 15) {
        this._dropAllItems(world);
        this.isDead = true;
        this.deathCause = 'starvation';
        this.health = 0;
        return;
      }
    } else {
      this.starvationTimer = 0;
    }

    // Disease: tick infection and immunity timers
    if (this.immuneTimer > 0) this.immuneTimer -= delta;
    if (this.infected) {
      this.infectionTimer += delta;
      this.health = Math.max(0, this.health - 0.0005 * delta);
      this.needs.energy = Math.max(0, this.needs.energy - 0.001 * delta);
      if (this.infectionTimer >= 60) {
        this.infected = false;
        this.infectionTimer = 0;
        this.immuneTimer = 120;
      }
    }

    if (this.knowledge.has('organisation') && !this.task) this._adoptTask(allAgents);

    // Knowledge bonuses
    const hasFire    = this.knowledge.has('fire');
    const hasCooking = this.knowledge.has('cooking');
    const hasShelter = this.knowledge.has('shelter');
    const hasMedicine = this.knowledge.has('medicine');

    // Concepts extend lifespan
    if (this.age > this.lifeExpectancy) {
      this._dropAllItems(world);
      this.isDead = true;
      this.deathCause = 'old_age';
      this.health = 0;
      return; // dead of old age
    }

    // Life stage and maturity
    this._updateLifeStage();
    this.isAdult = (this.lifeStage === 'adult' || this.lifeStage === 'elder');
    if (this.reproductionCooldown > 0) this.reproductionCooldown -= delta;
    if (!this.lifeStageModifiers.canReproduce) this.reproductionCooldown = Math.max(this.reproductionCooldown, 5);

    // Weather protection: fire, shelter, and clothing reduce harsh-weather energy penalty
    let envMult = weatherMult;
    if (hasFire)    envMult = Math.max(1.0, envMult - 0.25);
    if (hasShelter) envMult = Math.max(1.0, envMult - 0.35);
    if (this.knowledge.has('clothing')) envMult = Math.max(1.0, envMult - 0.20);
    if (this.knowledge.has('housing')) envMult = Math.max(1.0, envMult - 0.20);
    if (this.knowledge.has('tree_house')) envMult = Math.max(1.0, envMult - 0.05);
    if (this.knowledge.has('temple'))    envMult = Math.max(1.0, envMult - 0.04);
    if (this.knowledge.has('church'))    envMult = Math.max(1.0, envMult - 0.04);

    // Drain needs
    this.needs.hunger = Math.max(0, this.needs.hunger - HUNGER_DRAIN * delta);
    const isSleeping = this.state === AgentState.SLEEPING;
    if (!isSleeping) {
      this.needs.energy = Math.max(0, this.needs.energy - ENERGY_DRAIN * delta * envMult);
    }
    if (this.discoveryFlash > 0) this.discoveryFlash -= delta;
    if (this._fireCooldown > 0) this._fireCooldown -= delta;
    if (this.speechBubbleTimer > 0) {
      this.speechBubbleTimer -= delta;
      if (this.speechBubbleTimer <= 0) this.speechBubble = null;
    }

    // Inventory spoilage
    if (itemDefs && this.inventory.stacks.length > 0) {
      let spoilMult = 1.0;
      if (this.knowledge.has('preservation')) spoilMult *= 0.50;
      if (this.knowledge.has('pottery')) spoilMult *= 0.75;
      this.inventory.tickSpoilageWithMult(delta, itemDefs, spoilMult);
    }

    // Carry capacity bonuses from knowledge
    this.inventory.maxWeight = 10.0
      + (this.knowledge.has('weaving') ? 2.0 : 0)
      + (this.knowledge.has('animal_domestication') ? 4.0 : 0);

    // Store for use in _decideAction
    this._lastWeatherMult = envMult;
    this._itemDefs = itemDefs;
    this._season = season;


    // Fire-lighting: cold agent who knows fire will light a campfire on their tile
    if (hasFire && envMult >= 1.2 && this._fireCooldown <= 0) {
      const tile = world.getTile(Math.floor(this.x), Math.floor(this.z));
      if (tile && (tile.type === TileType.FOREST || tile.type === TileType.WOODLAND || tile.type === TileType.GRASS)) {
        this._fireCooldown = 45 + Math.random() * 30;
        // Emit a campfire event to be consumed by main.js
        if (!world.campfireEvents) world.campfireEvents = [];
        world.campfireEvents.push({ tx: tile.x, tz: tile.z, agentName: this.name });
      }
    }

    // ── Sleeping: recover energy, then resume ────────────────────────────────
    if (this.state === AgentState.SLEEPING) {
      let sleepMult = hasShelter ? 1.6 : 1.0;
      if (this.knowledge.has('weaving')) sleepMult *= 1.25;
      if (this.knowledge.has('rope')) sleepMult *= 1.1;
      if (this.knowledge.has('housing')) sleepMult *= 1.15;
      if (this.knowledge.has('tree_house')) sleepMult *= 1.06;
      if (this.knowledge.has('temple'))    sleepMult *= 1.04;
      if (this.knowledge.has('church'))    sleepMult *= 1.04;
      const taskRestBonus = this.task && Agent.TASKS[this.task]?.restBonus ? Agent.TASKS[this.task].restBonus : 1.0;
      sleepMult *= taskRestBonus;
      this.needs.energy = Math.min(1, this.needs.energy + ENERGY_RECOVER * delta * 1.4 * sleepMult);
      this.restTimer -= delta;
      if (this.restTimer <= 0) {
        this.state = AgentState.WANDERING;
        this._pickWanderTarget(world, allAgents);
      }
      this._trySocialise(delta, allAgents, conceptGraph);
      return;
    }

    // ── Fishing: sit at water's edge until the catch comes in ────────────
    if (this.state === AgentState.FISHING) {
      this.fishingTimer -= delta;
      if (this.fishingTimer <= 0) {
        let yield_ = 0.5;
        if (this.knowledge.has('stone_tools')) yield_ *= 1.2;
        if (this.knowledge.has('metal_tools')) yield_ *= 1.25;
        if (this.knowledge.has('cooking'))     yield_ *= 1.5;
        if (this.knowledge.has('pottery'))     yield_ *= 1.1;
        this.needs.hunger = Math.min(1.0, this.needs.hunger + yield_);
        this.state = AgentState.WANDERING;
        this._pickWanderTarget(world, allAgents);
      }
      this._trySocialise(delta, allAgents, conceptGraph);
      return;
    }

    // ── Performing: play music, spreading knowledge faster ───────────
    if (this.state === AgentState.PERFORMING) {
      this.performTimer -= delta;
      if (this.performTimer <= 0) {
        this.state = AgentState.WANDERING;
        this._pickWanderTarget(world, allAgents);
      }
      this._trySocialise(delta, allAgents, conceptGraph);
      return;
    }

    // ── Periodic needs re-evaluation (even mid-wander) ────────────────
    this._needsCheckTimer -= delta;
    if (this._needsCheckTimer <= 0) {
      this._needsCheckTimer = 3 + Math.random() * 4;
      if (this.state === AgentState.WANDERING || this.state === AgentState.DISCOVERING) {
        this._decideAction(world, allAgents);
      }
    }

    // ── Move toward target ────────────────────────────────────────────
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.04) {
      const move = Math.min(AGENT_SPEED * this.speedMult * delta, dist);
      const newX = this.x + (dx / dist) * move;
      const newZ = this.z + (dz / dist) * move;
      if (world.canTraverse(Math.floor(newX), Math.floor(newZ), this.knowledge)) {
        this.x = newX;
        this.z = newZ;
        this.facingX = dx / dist;
        this.facingZ = dz / dist;
      } else {
        // Blocked — pick a new reachable target
        this._pickWanderTarget(world);
      }
    } else {
      this.x = this.targetX;
      this.z = this.targetZ;
      this._onArrival(world, allAgents, conceptGraph);
    }

    // ── Continuous checks ──────────────────────────────────────────────
    this._tryDiscover(delta, world, conceptGraph, allAgents);
    this._trySocialise(delta, allAgents, conceptGraph);
  }

  // ── Arrival: decide next action ───────────────────────────────────────

  _onArrival(world, allAgents, conceptGraph) {
    if (!allAgents) allAgents = [];
    const itemDefs = this._itemDefs;

    if (this.state === AgentState.GATHERING) {
      const tile = world.getTile(Math.floor(this.x), Math.floor(this.z));

      if (itemDefs && tile) {
        // New inventory-based gathering
        const gathered = GatheringSystem.gather(this, tile, world, itemDefs);
        for (const { itemId, quantity } of gathered) {
          const added = this.inventory.add(itemId, quantity, itemDefs);
          // Overflow goes to ground
          const overflow = quantity - added;
          if (overflow > 0 && world.tileItems) {
            world.tileItems.add(tile.x, tile.z, itemId, overflow);
          }
        }
        // Bridge behavior: if hungry, eat immediately after gathering
        if (this.needs.hunger < 0.6) {
          this._tryEat(itemDefs);
        }

        // Try cooking raw food if agent has fire + cooking knowledge
        GatheringSystem.cook(this, itemDefs);

        // Try hunting for raw_meat on suitable tiles
        const huntResults = GatheringSystem.hunt(this, tile);
        for (const { itemId, quantity } of huntResults) {
          const added = this.inventory.add(itemId, quantity, itemDefs);
          const overflow = quantity - added;
          if (overflow > 0 && world.tileItems) {
            world.tileItems.add(tile.x, tile.z, itemId, overflow);
          }
        }
      } else if (tile && (tile.type === TileType.GRASS || tile.type === TileType.FOREST || tile.type === TileType.WOODLAND)) {
        // Fallback: old direct-hunger system if itemDefs not loaded
        let toolMult  = this.knowledge.has('stone_tools') ? 1.20 : 1.0;
        if (this.knowledge.has('metal_tools')) toolMult *= 1.25;
        if (this.knowledge.has('hunting') && tile.type === TileType.FOREST) toolMult *= 1.35;
        if (this.knowledge.has('agriculture') && tile.type === TileType.GRASS) toolMult *= 1.35;
        let cookMult  = this.knowledge.has('cooking') ? 1.60 : 1.0;
        const yield_    = Math.max(0.15, tile.resource);
        this.needs.hunger = Math.min(1.0, this.needs.hunger + 0.60 * toolMult * cookMult * yield_);
        tile.resource = Math.max(0, tile.resource - 0.28 / toolMult);
      }
    }

    // Pick up ground items when arriving at any tile
    if (itemDefs && world.tileItems) {
      this._pickUpGroundItems(world, itemDefs);
    }

    this._decideAction(world, allAgents);
  }

  _decideAction(world, allAgents = []) {
    const taskDef = this.task ? Agent.TASKS[this.task] : null;
    const gatherThreshold = taskDef?.gatherThreshold ?? 0.25;
    const restThreshold   = taskDef?.restThreshold   ?? 0.2;
    const envMult = this._lastWeatherMult ?? 1.0;

    // Critical hunger — eat from inventory first, then seek food
    if (this.needs.hunger < gatherThreshold) {
      if (this._itemDefs && this._tryEat(this._itemDefs)) {
        // Ate from inventory, re-evaluate
        if (this.needs.hunger >= gatherThreshold) {
          this.state = AgentState.WANDERING;
          this._pickWanderTarget(world, allAgents);
          return;
        }
      }
      this.state = AgentState.GATHERING;
      this._pickGatherTarget(world);
      return;
    }

    // Low energy — rest
    if (this.needs.energy < restThreshold) {
      this.state = AgentState.SLEEPING;
      this.restTimer = 10 + Math.random() * 8;
      return;
    }

    // Cold & exposed: proactively seek forest to discover fire, or seek shelter
    if (envMult >= 1.3 && !this.knowledge.has('fire') && !this.knowledge.has('shelter')) {
      const cx = Math.floor(this.x);
      const cz = Math.floor(this.z);
      const warmTile = world.findNearest(cx, cz, [TileType.FOREST, TileType.WOODLAND], 10);
      if (warmTile) {
        this.state = AgentState.WANDERING;
        this.targetX = warmTile.x + 0.5;
        this.targetZ = warmTile.z + 0.5;
        return;
      }
    }

    // Moderate hunger: gatherers proactively seek food even before critical
    if (this.task === 'gatherer' && this.needs.hunger < 0.55) {
      this.state = AgentState.GATHERING;
      this._pickGatherTarget(world);
      return;
    }

    this.state = AgentState.WANDERING;
    this._pickWanderTarget(world, allAgents);
  }

  // ── Target selection ──────────────────────────────────────────────────

  _pickWanderTarget(world, allAgents = []) {
    const taskDef = this.task ? Agent.TASKS[this.task] : null;
    const radiusBonus = taskDef?.wanderRadiusBonus ?? 0;
    let radius = 4 + Math.floor(this.curiosity * 4) + radiusBonus;

    // Teacher: bias toward other agents to share knowledge
    if (taskDef?.seekSocial && allAgents.length > 1) {
      const others = allAgents.filter(a => a !== this && a.health > 0);
      if (others.length > 0 && Math.random() < 0.6) {
        const nearest = others.reduce((best, a) => {
          const d = Math.hypot(a.x - this.x, a.z - this.z);
          return d < best.d ? { a, d } : best;
        }, { a: others[0], d: Infinity });
        const dx = nearest.a.x - this.x;
        const dz = nearest.a.z - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2) {
          const step = Math.min(radius, dist * 0.6);
          const tx = Math.floor(this.x + (dx / dist) * step);
          const tz = Math.floor(this.z + (dz / dist) * step);
          if (world.canTraverse(tx, tz, this.knowledge)) {
            this.targetX = tx + 0.5;
            this.targetZ = tz + 0.5;
            return;
          }
        }
      }
    }

    // Collect candidate tiles and score them by seasonal preference
    const candidates = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      const tx = Math.floor(this.x) + Math.floor(Math.random() * radius * 2 + 1) - radius;
      const tz = Math.floor(this.z) + Math.floor(Math.random() * radius * 2 + 1) - radius;
      if (world.canTraverse(tx, tz, this.knowledge)) {
        const tile = world.getTile(tx, tz);
        const score = tile ? this._seasonalTileScore(tile, this._season) : 1.0;
        candidates.push({ tx, tz, score });
      }
    }
    if (candidates.length > 0) {
      // Weighted random selection by seasonal score
      const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
      let roll = Math.random() * totalScore;
      for (const c of candidates) {
        roll -= c.score;
        if (roll <= 0) {
          this.targetX = c.tx + 0.5;
          this.targetZ = c.tz + 0.5;
          return;
        }
      }
      // Fallback to last candidate
      const last = candidates[candidates.length - 1];
      this.targetX = last.tx + 0.5;
      this.targetZ = last.tz + 0.5;
      return;
    }
    this.targetX = this.x;
    this.targetZ = this.z;
  }

  /** Score a tile for seasonal preference (0.5–1.5). Winter biases toward warm tiles. */
  _seasonalTileScore(tile, season) {
    if (season !== 'Winter') return 1.0;
    const t = tile.type;
    if (t === TileType.GRASS || t === TileType.WOODLAND) return 1.3;
    if (t === TileType.MOUNTAIN || t === TileType.STONE) return 0.4;
    return 1.0;
  }

  _pickGatherTarget(world) {
    const cx = Math.floor(this.x);
    const cz = Math.floor(this.z);
    const tile = world.findNearest(cx, cz, [TileType.GRASS, TileType.FOREST, TileType.WOODLAND], 8);
    if (tile) {
      this.targetX = tile.x + 0.5;
      this.targetZ = tile.z + 0.5;
    } else {
      this._pickWanderTarget(world);
    }
  }

  // ── Concept discovery ─────────────────────────────────────────────────

  _tryDiscover(delta, world, conceptGraph, allAgents = []) {
    const tile = world.getTile(Math.floor(this.x), Math.floor(this.z));
    if (!tile) return;

    const discovered = conceptGraph.checkDiscovery(this, tile, delta, world, allAgents);
    if (discovered) {
      this.state = AgentState.DISCOVERING;
      this.discoveryFlash = 1.5;
      setTimeout(() => {
        if (this.state === AgentState.DISCOVERING) this.state = AgentState.WANDERING;
      }, 1500);
    }
  }

  // ── Social / knowledge spreading ─────────────────────────────────────

  _trySocialise(delta, allAgents, conceptGraph) {
    this.socialTimer -= delta;
    if (this.socialTimer > 0) return;
    this.socialTimer = (SOCIAL_COOLDOWN + Math.random() * 2) * (1 / this.socialMult);

    for (const other of allAgents) {
      if (other === this || other.health <= 0) continue;
      const dist = Math.hypot(this.x - other.x, this.z - other.z);
      if (dist < 5.0) {
        conceptGraph.trySpread(this, other, SOCIAL_COOLDOWN);
        // Disease spreading
        this._trySpreadInfection(other);
        if (dist < 3.5) this._tryReproduce(other, conceptGraph);
      }
    }
  }

  // ── Reproduction ──────────────────────────────────────────────────────

  _tryReproduce(other, conceptGraph) {
    if (!this.isAdult || !other.isAdult) return;
    if (this.reproductionCooldown > 0 || other.reproductionCooldown > 0) return;
    if (this.needs.hunger < 0.40 || other.needs.hunger < 0.40) return;
    if (this.needs.energy < 0.20 || other.needs.energy < 0.20) return;

    const baseCooldown = 45 + Math.random() * 45;
    const communityMult = (this.knowledge.has('community') || other.knowledge.has('community')) ? 0.82 : 1.0;
    const cooldown = baseCooldown * communityMult;
    this.reproductionCooldown  = cooldown;
    other.reproductionCooldown = cooldown;

    // Child spawns between parents, slightly randomised
    const cx = (this.x + other.x) / 2 + (Math.random() - 0.5) * 1.5;
    const cz = (this.z + other.z) / 2 + (Math.random() - 0.5) * 1.5;
    conceptGraph.birthEvents.push({ x: cx, z: cz, parentName: this.name });
  }

  // ── Disease spreading ──────────────────────────────────────────────────

  _trySpreadInfection(other) {
    // Spread from this -> other
    if (this.infected && !other.infected && !other.isImmune) {
      let chance = 0.15;
      if (other.knowledge.has('medicine')) chance *= 0.5;
      if (Math.random() < chance) {
        other.infected = true;
        other.infectionTimer = 0;
      }
    }
    // Spread from other -> this
    if (other.infected && !this.infected && !this.isImmune) {
      let chance = 0.15;
      if (this.knowledge.has('medicine')) chance *= 0.5;
      if (Math.random() < chance) {
        this.infected = true;
        this.infectionTimer = 0;
      }
    }
  }

  // ── Inventory actions ─────────────────────────────────────────────────

  /** Try to eat the best food from inventory. Returns true if ate. */
  _tryEat(itemDefs) {
    if (!itemDefs) return false;
    const food = this.inventory.getBestFood(itemDefs);
    if (!food) return false;
    const def = itemDefs.get(food.itemId);
    if (!def) return false;

    // Consume one unit
    this.inventory.remove(food.itemId, 1);
    this.needs.hunger = Math.min(1.0, this.needs.hunger + (def.effects?.hunger ?? 0.10));
    if (def.effects?.health) {
      this.health = Math.min(1.0, this.health + def.effects.health);
    }
    return true;
  }

  /** Pick up useful items from the ground on the current tile. */
  _pickUpGroundItems(world, itemDefs) {
    const tx = Math.floor(this.x);
    const tz = Math.floor(this.z);
    const groundItems = world.tileItems.getItems(tx, tz);
    if (groundItems.length === 0) return;

    for (let i = groundItems.length - 1; i >= 0; i--) {
      const g = groundItems[i];
      const def = itemDefs.get(g.itemId);
      if (!def) continue;

      // Pick up food when hungry, or any useful items when we have capacity
      const wantFood = def.category === 'food' && this.needs.hunger < 0.7;
      const wantAny = !this.inventory.isFull(g.itemId, itemDefs);
      if (!wantFood && !wantAny) continue;

      const qty = Math.min(g.quantity, 3); // pick up at most 3 at a time
      const added = this.inventory.add(g.itemId, qty, itemDefs);
      if (added > 0) {
        world.tileItems.remove(tx, tz, g.itemId, added);
      }
    }
  }

  /** Drop all inventory items to the ground (called on death). */
  _dropAllItems(world) {
    if (!world.tileItems || this.inventory.stacks.length === 0) return;
    const tx = Math.floor(this.x);
    const tz = Math.floor(this.z);
    const items = this.inventory.dropAll();
    for (const { itemId, quantity } of items) {
      world.tileItems.add(tx, tz, itemId, quantity);
    }
  }
}

// ── Name generator ────────────────────────────────────────────────────────

const SYLLABLES = ['ar','el','or','an','en','am','ul','in','er','om','al','ir','un','ae'];
function randomName() {
  const len = 2 + Math.floor(Math.random() * 2);
  let name = '';
  for (let i = 0; i < len; i++) {
    name += SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}
