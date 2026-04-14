const SEASON_WEIGHTS = {
  Spring: { CLEAR: 3, CLOUDY: 2, RAIN: 3, STORM: 1 },
  Summer: { CLEAR: 5, CLOUDY: 2, RAIN: 1, STORM: 0 },
  Autumn: { CLEAR: 2, CLOUDY: 3, RAIN: 3, STORM: 2 },
  Winter: { CLEAR: 1, CLOUDY: 2, RAIN: 2, STORM: 4 },
};

export const WEATHER_META = {
  CLEAR:  { label: '☀️ Clear',   energyMult: 1.00, sky: 0x5080a0, fog: 0.006 },
  CLOUDY: { label: '☁️ Cloudy',  energyMult: 1.05, sky: 0x607080, fog: 0.009 },
  RAIN:   { label: '🌧️ Rain',    energyMult: 1.30, sky: 0x4a5870, fog: 0.013 },
  STORM:  { label: '⛈️ Storm',   energyMult: 1.70, sky: 0x28303e, fog: 0.022 },
};

// Base temperature (°C) per season, modified by weather
const SEASON_TEMP  = { Spring: 13, Summer: 24, Autumn: 9, Winter: -5 };
const WEATHER_TEMP = { CLEAR: 4, CLOUDY: 0, RAIN: -4, STORM: -10 };

// Severity order for blending (higher = worse)
const SEVERITY = { CLEAR: 0, CLOUDY: 1, RAIN: 2, STORM: 3 };

// Number of zones per axis (4×4 grid = 16 zones)
const ZONES = 4;

/**
 * WeatherSystem — now with localised 4×4 weather zones.
 *
 * Each zone evolves independently but with spatial correlation to its
 * neighbours: when a zone transitions, neighbour states are considered
 * alongside pure random weights.
 *
 * The top-level `current`, `label`, `isRaining`, etc. properties reflect
 * the *dominant* (most-severe) zone for use in global UI / camera effects.
 * Use `getWeatherAt(worldX, worldZ)` to query any position's local weather.
 */
export class WeatherSystem {
  /**
   * @param {number} worldWidth  — tile-width of the world (default 32)
   * @param {number} worldHeight — tile-height of the world (default 32)
   */
  constructor(worldWidth = 32, worldHeight = 32) {
    this._worldWidth  = worldWidth;
    this._worldHeight = worldHeight;
    this._season  = 'Spring';

    // Initialise zones: each has a weather state and an independent timer
    this._zones = [];
    for (let r = 0; r < ZONES; r++) {
      this._zones[r] = [];
      for (let c = 0; c < ZONES; c++) {
        this._zones[r][c] = {
          state:    'CLEAR',
          timer:    (r * ZONES + c) * (50 / (ZONES * ZONES)), // stagger initial timers
          duration: 50,
        };
      }
    }

    // Legacy compat: expose dominant zone state as `current`
    this.current = 'CLEAR';
  }

  // ── Zone helpers ─────────────────────────────────────────────────────────

  /** Convert world tile coords to zone row/col. */
  _zoneOf(x, z) {
    const c = Math.max(0, Math.min(ZONES - 1, Math.floor(x / this._worldWidth  * ZONES)));
    const r = Math.max(0, Math.min(ZONES - 1, Math.floor(z / this._worldHeight * ZONES)));
    return { r, c };
  }

  /** Sample a new weather state weighted by season + neighbour pressure. */
  _sampleState(season, r, c) {
    const weights = { ...SEASON_WEIGHTS[season] ?? SEASON_WEIGHTS.Spring };

    // Spatial correlation: each neighbouring zone nudges weights toward its state
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= ZONES || nc < 0 || nc >= ZONES) continue;
      const nState = this._zones[nr][nc].state;
      // Add 1.5 weight points toward the neighbour's state
      weights[nState] = (weights[nState] ?? 0) + 1.5;
    }

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    for (const [key, val] of Object.entries(weights)) {
      rand -= val;
      if (rand <= 0) return key;
    }
    return 'CLEAR';
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Update all zone timers. Call once per game tick with game-time delta.
   * @param {number} delta  — game-seconds elapsed
   * @param {string} season — current season name
   */
  update(delta, season) {
    this._season = season;
    let dominant = 'CLEAR';

    for (let r = 0; r < ZONES; r++) {
      for (let c = 0; c < ZONES; c++) {
        const zone = this._zones[r][c];
        zone.timer += delta;
        if (zone.timer >= zone.duration) {
          zone.timer    = 0;
          zone.duration = 25 + Math.random() * 55;
          zone.state    = this._sampleState(season, r, c);
        }
        if (SEVERITY[zone.state] > SEVERITY[dominant]) dominant = zone.state;
      }
    }

    this.current = dominant;
  }

  /**
   * Return the weather state string for a given world position.
   * @param {number} x — world X (tile units)
   * @param {number} z — world Z (tile units)
   * @returns {string} e.g. 'CLEAR', 'RAIN', 'STORM', 'CLOUDY'
   */
  getWeatherAt(x, z) {
    const { r, c } = this._zoneOf(x, z);
    return this._zones[r][c].state;
  }

  /**
   * Return the WEATHER_META object for the weather at a world position.
   * @param {number} x
   * @param {number} z
   */
  getMetaAt(x, z) {
    return WEATHER_META[this.getWeatherAt(x, z)];
  }

  /**
   * Returns true if it is raining at the given position.
   */
  isRainingAt(x, z) {
    const s = this.getWeatherAt(x, z);
    return s === 'RAIN' || s === 'STORM';
  }

  /**
   * Energy drain multiplier for an agent at (x, z).
   */
  energyDrainMultAt(x, z) {
    return WEATHER_META[this.getWeatherAt(x, z)].energyMult;
  }

  // ── Legacy / global accessors (dominant zone) ─────────────────────────────

  /** Current temperature in °C based on dominant zone */
  get temperature() {
    return (SEASON_TEMP[this._season] ?? 13) + (WEATHER_TEMP[this.current] ?? 0);
  }

  /** Temperature label with icon */
  get tempLabel() {
    const t = this.temperature;
    const icon = t <= -5 ? '❄️' : t <= 4 ? '🥶' : t <= 16 ? '🌤️' : t <= 26 ? '☀️' : '🌡️';
    return `${icon} ${t}°C`;
  }

  get meta()            { return WEATHER_META[this.current]; }
  get energyDrainMult() { return this.meta.energyMult; }
  get label()           { return this.meta.label; }
  get isRaining()       { return this.current === 'RAIN' || this.current === 'STORM'; }
  get isStorm()         { return this.current === 'STORM'; }
}
