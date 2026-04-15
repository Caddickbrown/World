import { TileType } from './World.js';
import { Inventory } from './Inventory.js';
import { GatheringSystem } from './GatheringSystem.js';
import { UtilityAI } from '../systems/UtilityAI.js';

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

    /** Family relationships */
    this.parents  = []; // array of agent IDs
    this.children = []; // array of agent IDs

    // CAD-125: Home ownership — building ID or tile coords key
    this.homeId = null;

    // CAD-185: Bonded pairs — partner agent ID and interaction history
    this.bondedPartnerId = null;
    this.socialHistory = {}; // map of agentId -> interaction count

    // CAD-187: Agent memory — food sources, dangers, relationships
    this.memory = {
      foodSources: [],  // [{x, y, type, lastVisited}]  (y = game-day)
      dangers: [],      // [{x, z, type, time}]
    };

    // CAD-184: Role assigned at age 10 based on personality + available concepts
    this.role = null;
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

  /** Generate offspring personality from two parents (CAD-189: heritable traits) */
  static inheritPersonality(parentA, parentB) {
    const traits = ['curiosity', 'sociability', 'industriousness', 'courage', 'creativity', 'caution'];
    const child = {};
    for (const t of traits) {
      const parentVal = (parentA.personality[t] + parentB.personality[t]) / 2;
      const mutation = (Math.random() - 0.5) * 0.1; // ±5% noise
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

  tick(delta, world, allAgents, conceptGraph, weatherMult = 1.0, itemDefs = null, season = null, spatialGrid = null, timeSystem = null) {
    // Store spatial grid for use in proximity checks this tick
    this._spatialGrid = spatialGrid;
    // Store timeSystem for use in _decideAction
    this._timeSystem = timeSystem;
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

    // CAD-187: Memory decay — remove food sources older than 30 game days
    if (world.day !== undefined && this.memory.foodSources.length > 0) {
      this.memory.foodSources = this.memory.foodSources.filter(
        fs => (world.day - fs.lastVisited) < 30,
      );
    }

    // CAD-184: Role assignment at age 10 (adult life stage just reached)
    if (!this.role && this.isAdult && this.age >= 10) {
      this._assignRole(allAgents, world);
    }

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
      // CAD-125: Claim a building as home when sleeping in one for the first time
      if (this.homeId === null && (hasShelter || this.knowledge.has('housing'))) {
        const bx = Math.floor(this.x);
        const bz = Math.floor(this.z);
        const buildingKey = `${bx},${bz}`;
        if (!world._homeOccupants) world._homeOccupants = {};
        const occupants = world._homeOccupants[buildingKey] || [];
        if (occupants.length < 2) {
          this.homeId = buildingKey;
          world._homeOccupants[buildingKey] = [...occupants, this.id];
        }
      }

      let sleepMult = hasShelter ? 1.6 : 1.0;
      if (this.knowledge.has('weaving')) sleepMult *= 1.25;
      if (this.knowledge.has('rope')) sleepMult *= 1.1;
      if (this.knowledge.has('housing')) sleepMult *= 1.15;
      if (this.knowledge.has('tree_house')) sleepMult *= 1.06;
      if (this.knowledge.has('temple'))    sleepMult *= 1.04;
      if (this.knowledge.has('church'))    sleepMult *= 1.04;
      const taskRestBonus = this.task && Agent.TASKS[this.task]?.restBonus ? Agent.TASKS[this.task].restBonus : 1.0;
      sleepMult *= taskRestBonus;
      // Nighttime sleeping recovers energy faster
      if (this._nightSleeping) sleepMult *= 1.5;
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
        this._decideAction(world, allAgents, conceptGraph, this._timeSystem);
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

    // ── Lava damage: agents on a LAVA tile take continuous damage ─────
    // LAVA is impassable so this guards edge cases (world edits, respawn overlap).
    const currentTile = world.getTile(Math.floor(this.x), Math.floor(this.z));
    if (currentTile && currentTile.type === TileType.LAVA) {
      this.health = Math.max(0, this.health - 0.05 * delta);
      this._pickWanderTarget(world); // flee immediately
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
        // CAD-187: Remember this food source location after successful gathering
        if (gathered.length > 0) {
          this._rememberFoodSource(tile.x, tile.z, tile.type, world.day || 0);
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

        // Craft medicine from herbs (requires herbalism knowledge, 3 herbs → 1 medicine)
        if (this.knowledge.has('herbalism')) {
          GatheringSystem.craftMedicine(this, itemDefs);
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

    this._decideAction(world, allAgents, conceptGraph, this._timeSystem);
  }

  _decideAction(world, allAgents = [], conceptGraph = null, timeSystem = null) {
    const taskDef = this.task ? Agent.TASKS[this.task] : null;
    const gatherThreshold = taskDef?.gatherThreshold ?? 0.25;
    const restThreshold   = taskDef?.restThreshold   ?? 0.2;
    const envMult = this._lastWeatherMult ?? 1.0;

    // Low health — use medicine from inventory if available
    if (this.health < 0.40 && this._itemDefs) {
      this._useMedicine(this._itemDefs);
    }

    // ── Time-of-day behaviour ────────────────────────────────────────────
    if (timeSystem) {
      const nighttime = this.isNighttime(timeSystem);
      const dawn      = this.isDawnTime(timeSystem);
      const dusk      = this.isDuskTime(timeSystem);

      if (nighttime) {
        // At night agents strongly prefer sleeping/resting.
        // If energy is not nearly full, go to sleep.
        if (this.needs.energy < 0.9) {
          this.state = AgentState.SLEEPING;
          // Longer rest timer at night
          this.restTimer = 14 + Math.random() * 10;
          // Night sleeping recovers energy faster
          this._nightSleeping = true;
          return;
        }
      } else {
        this._nightSleeping = false;
      }

      if (dawn) {
        // At dawn, prioritise food/foraging even if not critically hungry
        if (this.needs.hunger < 0.75) {
          this.state = AgentState.GATHERING;
          this._pickGatherTarget(world);
          return;
        }
      }

      if (dusk) {
        // CAD-125: At dusk, agents with a homeId navigate toward their home building
        if (this.homeId && this.state !== AgentState.SLEEPING) {
          const [hx, hz] = this.homeId.split(',').map(Number);
          if (!isNaN(hx) && !isNaN(hz)) {
            const dx = hx - this.x;
            const dz = hz - this.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 1.5 && world.canTraverse(Math.floor(hx), Math.floor(hz), this.knowledge)) {
              this.state = AgentState.WANDERING;
              this.targetX = hx + 0.5;
              this.targetZ = hz + 0.5;
              return;
            }
          }
        }
        // At dusk, head toward shelter if known, or a safe tile to rest soon
        if (this.knowledge.has('shelter') || this.knowledge.has('housing')) {
          // Bias wander toward staying close to current position (settle down)
          if (this.state !== AgentState.SLEEPING) {
            this.state = AgentState.WANDERING;
            // Target a nearby tile — stay close to home
            const tx = Math.floor(this.x) + Math.round((Math.random() - 0.5) * 2);
            const tz = Math.floor(this.z) + Math.round((Math.random() - 0.5) * 2);
            if (world.canTraverse(tx, tz, this.knowledge)) {
              this.targetX = tx + 0.5;
              this.targetZ = tz + 0.5;
              return;
            }
          }
        }
      }
    }

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

    // UtilityAI — score all remaining actions and pick the best
    const best = UtilityAI.bestAction(this, world, allAgents, conceptGraph);
    if (best) {
      switch (best.name) {
        case 'gather':
          this.state = AgentState.GATHERING;
          this._pickGatherTarget(world);
          return;
        case 'sleep':
          this.state = AgentState.SLEEPING;
          this.restTimer = 10 + Math.random() * 8;
          return;
        case 'fish':
          this.state = AgentState.FISHING;
          this.fishingTimer = 6 + Math.random() * 4;
          this._fishingTrip = true;
          return;
        case 'perform':
          this.state = AgentState.PERFORMING;
          this.performTimer = 5 + Math.random() * 5;
          return;
        case 'socialize':
        case 'hunt':
        case 'craft':
        case 'wander':
        default:
          // Fall through to wander
          break;
      }
    }

    this.state = AgentState.WANDERING;
    this._pickWanderTarget(world, allAgents);
  }

  // ── Target selection ──────────────────────────────────────────────────

  _pickWanderTarget(world, allAgents = []) {
    const taskDef = this.task ? Agent.TASKS[this.task] : null;
    const radiusBonus = taskDef?.wanderRadiusBonus ?? 0;
    let radius = 4 + Math.floor(this.curiosity * 4) + radiusBonus;

    // CAD-185: Bonded agents preferentially wander toward each other
    if (this.bondedPartnerId !== null && allAgents.length > 0 && Math.random() < 0.4) {
      const partner = allAgents.find(a => a.id === this.bondedPartnerId && a.health > 0);
      if (partner) {
        const dx = partner.x - this.x;
        const dz = partner.z - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 2) {
          const step = Math.min(radius, dist * 0.7);
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

    // Teacher: bias toward other agents to share knowledge
    // Use SpatialGrid for nearby candidates when available, else fall back to allAgents
    if (taskDef?.seekSocial && allAgents.length > 1) {
      const candidatePool = this._spatialGrid
        ? this._spatialGrid.getNearby(this.x, this.z, radius + 2).filter(a => a !== this && a.health > 0)
        : allAgents.filter(a => a !== this && a.health > 0);
      const others = candidatePool.length > 0 ? candidatePool : allAgents.filter(a => a !== this && a.health > 0);
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

    // CAD-187: Prefer known food sources from memory before random search
    if (this.memory.foodSources.length > 0) {
      // Sort by recency and distance
      const sorted = [...this.memory.foodSources].sort((a, b) => {
        const da = Math.hypot(a.x - cx, (a.y || a.z || 0) - cz);
        const db = Math.hypot(b.x - cx, (b.y || b.z || 0) - cz);
        return da - db;
      });
      const best = sorted[0];
      const memTile = world.getTile(Math.floor(best.x), Math.floor(best.z || best.y || cz));
      if (memTile && world.canTraverse(Math.floor(best.x), Math.floor(best.z || best.y || cz), this.knowledge)) {
        this.targetX = best.x + 0.5;
        this.targetZ = (best.z || best.y || cz) + 0.5;
        return;
      }
    }

    const tile = world.findNearest(cx, cz, [TileType.GRASS, TileType.FOREST, TileType.WOODLAND], 8);
    if (tile) {
      this.targetX = tile.x + 0.5;
      this.targetZ = tile.z + 0.5;
    } else {
      this._pickWanderTarget(world);
    }
  }

  /** CAD-187: Record a food source in memory after successful gathering */
  _rememberFoodSource(tx, tz, tileType, gameDay) {
    const existing = this.memory.foodSources.find(fs => fs.x === tx && (fs.z === tz || fs.y === tz));
    if (existing) {
      existing.lastVisited = gameDay;
    } else {
      this.memory.foodSources.push({ x: tx, z: tz, y: tz, type: tileType, lastVisited: gameDay });
      // Cap memory at 10 locations
      if (this.memory.foodSources.length > 10) {
        this.memory.foodSources.sort((a, b) => a.lastVisited - b.lastVisited);
        this.memory.foodSources.shift();
      }
    }
  }

  /** CAD-187: Record a danger event in memory */
  _rememberDanger(dx, dz, type, gameDay) {
    this.memory.dangers.push({ x: dx, z: dz, type, time: gameDay });
    // Cap at 5 dangers
    if (this.memory.dangers.length > 5) this.memory.dangers.shift();
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

    // Use SpatialGrid for fast proximity query when available
    const candidates = this._spatialGrid
      ? this._spatialGrid.getNearby(this.x, this.z, 5.0)
      : allAgents;

    for (const other of candidates) {
      if (other === this || other.health <= 0) continue;
      const dist = Math.hypot(this.x - other.x, this.z - other.z);
      if (dist < 5.0) {
        conceptGraph.trySpread(this, other, SOCIAL_COOLDOWN);
        // Disease spreading
        this._trySpreadInfection(other);
        // CAD-185: track social history and potentially bond
        this._trackSocialAndBond(other);
        if (dist < 3.5) this._tryReproduce(other, conceptGraph);
      }
    }
  }

  // CAD-185: Track social interactions and form bonds
  _trackSocialAndBond(other) {
    if (!this.isAdult || !other.isAdult) return;
    if (this.bondedPartnerId !== null || other.bondedPartnerId !== null) return;

    // Increment interaction count for both agents
    this.socialHistory[other.id] = (this.socialHistory[other.id] || 0) + 1;
    other.socialHistory[this.id] = (other.socialHistory[this.id] || 0) + 1;

    // 5% bond chance once they've interacted 3+ times
    if (this.socialHistory[other.id] >= 3 && Math.random() < 0.05) {
      this.bondedPartnerId = other.id;
      other.bondedPartnerId = this.id;
    }
  }

  // ── Reproduction ──────────────────────────────────────────────────────

  _tryReproduce(other, conceptGraph) {
    if (!this.isAdult || !other.isAdult) return;
    if (this.reproductionCooldown > 0 || other.reproductionCooldown > 0) return;
    if (this.needs.hunger < 0.40 || other.needs.hunger < 0.40) return;
    if (this.needs.energy < 0.20 || other.needs.energy < 0.20) return;

    // CAD-185: Bonded pairs have a higher reproduction chance (1.0 base vs 0.15 normally)
    const isBonded = this.bondedPartnerId === other.id;
    const reproChance = isBonded ? 1.0 : 0.15;
    if (Math.random() > reproChance) return;

    const baseCooldown = 45 + Math.random() * 45;
    const communityMult = (this.knowledge.has('community') || other.knowledge.has('community')) ? 0.82 : 1.0;
    const cooldown = baseCooldown * communityMult;
    this.reproductionCooldown  = cooldown;
    other.reproductionCooldown = cooldown;

    // Child spawns between parents, slightly randomised
    const cx = (this.x + other.x) / 2 + (Math.random() - 0.5) * 1.5;
    const cz = (this.z + other.z) / 2 + (Math.random() - 0.5) * 1.5;
    // CAD-189: pass parent refs so heritable traits can be applied at birth
    conceptGraph.birthEvents.push({ x: cx, z: cz, parentName: this.name, parentAId: this.id, parentBId: other.id, parentAPersonality: this.personality, parentBPersonality: other.personality });
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

  /** Use medicine from inventory to restore health. Returns true if medicine was consumed. */
  _useMedicine(itemDefs) {
    if (!itemDefs || !this.inventory.has('medicine')) return false;
    const def = itemDefs.get('medicine');
    if (!def) return false;
    this.inventory.remove('medicine', 1);
    this.health = Math.min(1.0, this.health + (def.effects?.health ?? 0.35));
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

  /**
   * Returns true if the given timeSystem indicates it is night (20:00–06:00),
   * false otherwise. Accepts either a TimeSystem instance (with .hour getter)
   * or a raw hour number.
   */
  isNighttime(timeSystem) {
    const h = typeof timeSystem === 'number' ? timeSystem : timeSystem.hour;
    return h >= 20 || h < 6;
  }

  /**
   * Returns true if the given timeSystem indicates it is dawn (06:00–08:00).
   */
  isDawnTime(timeSystem) {
    const h = typeof timeSystem === 'number' ? timeSystem : timeSystem.hour;
    return h >= 6 && h < 8;
  }

  /**
   * Returns true if the given timeSystem indicates it is dusk (18:00–20:00).
   */
  isDuskTime(timeSystem) {
    const h = typeof timeSystem === 'number' ? timeSystem : timeSystem.hour;
    return h >= 18 && h < 20;
  }

  // CAD-184: Role assignment based on personality + available settlement concepts
  _assignRole(allAgents, world) {
    // Collect concepts known by any nearby agent as a proxy for "settlement has concept"
    const knownBySettlement = new Set(this.knowledge);
    const nearby = this._spatialGrid
      ? this._spatialGrid.getNearby(this.x, this.z, 10).filter(a => a !== this && a.health > 0)
      : (allAgents || []).filter(a => a !== this && a.health > 0);
    for (const a of nearby.slice(0, 20)) {
      for (const k of a.knowledge) knownBySettlement.add(k);
    }

    const p = this.personality;
    const candidates = [];

    if (knownBySettlement.has('agriculture') && p.industriousness >= 0.5)
      candidates.push({ role: 'farmer',   weight: 0.5 + p.industriousness });
    if (knownBySettlement.has('animal_domestication') && nearby.length > 0)
      candidates.push({ role: 'herder',   weight: 0.4 + p.caution });
    if (knownBySettlement.has('construction'))
      candidates.push({ role: 'builder',  weight: 0.4 + (p.industriousness + p.courage) / 2 });
    if (knownBySettlement.has('medicine'))
      candidates.push({ role: 'healer',   weight: 0.5 + p.caution });
    if (knownBySettlement.has('music') && p.creativity >= 0.5)
      candidates.push({ role: 'musician', weight: 0.4 + p.creativity });
    if (knownBySettlement.has('trade'))
      candidates.push({ role: 'trader',   weight: 0.4 + p.sociability });
    if (knownBySettlement.has('governance'))
      candidates.push({ role: 'guard',    weight: 0.4 + p.courage });

    if (candidates.length === 0) return;

    const totalW = candidates.reduce((s, c) => s + c.weight, 0);
    let roll = Math.random() * totalW;
    for (const c of candidates) {
      roll -= c.weight;
      if (roll <= 0) {
        this.role = c.role;
        this._applyRoleBonus(c.role);
        return;
      }
    }
    this.role = candidates[candidates.length - 1].role;
    this._applyRoleBonus(this.role);
  }

  _applyRoleBonus(role) {
    switch (role) {
      case 'farmer':   this.personality.industriousness = Math.min(1, this.personality.industriousness + 0.05); break;
      case 'herder':   this.personality.caution         = Math.min(1, this.personality.caution + 0.05); break;
      case 'builder':  this.personality.courage         = Math.min(1, this.personality.courage + 0.05); break;
      case 'healer':   this.personality.caution         = Math.min(1, this.personality.caution + 0.05); break;
      case 'musician': this.personality.creativity      = Math.min(1, this.personality.creativity + 0.05); break;
      case 'trader':   this.personality.sociability     = Math.min(1, this.personality.sociability + 0.05); break;
      case 'guard':    this.personality.courage         = Math.min(1, this.personality.courage + 0.05); break;
    }
  }

  // CAD-200: Attempt to domesticate a nearby wolf. Call once per game-day from main.js.
  tryDomesticateWolves(wolves) {
    if (!this.knowledge.has('animal_domestication')) return;
    for (const wolf of wolves) {
      if (!wolf || wolf.isDead || wolf.owner !== null) continue;
      const d = Math.hypot(wolf.x - this.x, wolf.z - this.z);
      if (d <= 2 && wolf.fearLevel < 0.3) {
        // 1% chance per day
        if (Math.random() < 0.01) {
          wolf.owner = this;
        }
      }
    }
  }

  /**
   * Returns an object with { parents: Agent[], children: Agent[], siblings: Agent[] }
   * resolved from the provided allAgents array.
   */
  getFamily(allAgents) {
    const byId = new Map(allAgents.map(a => [a.id, a]));
    const parents  = this.parents.map(id => byId.get(id)).filter(Boolean);
    const children = this.children.map(id => byId.get(id)).filter(Boolean);
    // Siblings share at least one parent ID with this agent
    const parentSet = new Set(this.parents);
    const siblings  = allAgents.filter(a =>
      a !== this && a.parents.some(pid => parentSet.has(pid))
    );
    return { parents, children, siblings };
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

