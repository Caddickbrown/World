/**
 * TerrainWorker.js
 *
 * Generates tile data for a single 16×16 chunk off the main thread.
 * Self-contained — no ES module imports. All noise/generation logic is inlined.
 *
 * Messages received:
 *   { type: 'GENERATE_CHUNK', chunkX, chunkZ, seed }
 *
 * Messages sent:
 *   { type: 'CHUNK_READY', chunkX, chunkZ, tileData }
 *   where tileData is an Int32Array (transferable) of length CHUNK_SIZE * CHUNK_SIZE.
 *   Each element encodes: tileType index (lower 8 bits) | elevation * 1000 (upper bits)
 *   The companion TILE_FIELDS Float32Array carries per-tile floats (elevation only for now).
 */

const CHUNK_SIZE = 16;

// ── Tile type constants (must stay in sync with World.js TileType) ──────────
const TileType = {
  DEEP_WATER: 0,
  WATER:      1,
  BEACH:      2,
  GRASS:      3,
  WOODLAND:   4,
  FOREST:     5,
  DESERT:     6,
  STONE:      7,
  MOUNTAIN:   8,
  GLACIER:    9,
  LAVA:       10,
  DIRT:       11,
};

// Reverse mapping: index → string (used when posting back)
const TileTypeNames = [
  'DEEP_WATER', 'WATER', 'BEACH', 'GRASS', 'WOODLAND',
  'FOREST', 'DESERT', 'STONE', 'MOUNTAIN', 'GLACIER', 'LAVA', 'DIRT',
];

// ── Inlined noise / rng (identical to World.js) ──────────────────────────────

function _noise(x, z, seed) {
  const s = seed * 0.137;
  return (
    Math.sin(x * 0.045 + s)        * Math.cos(z * 0.035 + s * 1.71) * 0.45 +
    Math.sin(x * 0.088 + s * 2.13) * Math.cos(z * 0.073 + s * 0.63) * 0.30 +
    Math.sin(x * 0.180 + s * 0.54) * Math.cos(z * 0.153 + s * 1.23) * 0.15 +
    Math.cos(x * 0.028 + z * 0.040 + s * 1.87)                       * 0.25
  ) / 1.15;
}

function _rng(x, z, offset = 0) {
  return Math.sin(x * 127.1 + z * 311.7 + offset * 74.5) * 0.5 + 0.5;
}

// ── Tile generation for a single chunk ───────────────────────────────────────

/**
 * Generate tile data for a CHUNK_SIZE×CHUNK_SIZE region.
 *
 * Returns an object with two transferable TypedArrays:
 *   types      — Uint8Array  [CHUNK_SIZE*CHUNK_SIZE]  tile type index per cell
 *   elevations — Float32Array[CHUNK_SIZE*CHUNK_SIZE]  elevation per cell
 *
 * Row-major order: index = localZ * CHUNK_SIZE + localX
 * where localX = tileX - chunkX*CHUNK_SIZE, localZ = tileZ - chunkZ*CHUNK_SIZE
 *
 * NOTE: This replicates the first pass of World._generate() (base terrain + desert
 * noise + elevation). It intentionally skips glaciers, lava, rivers and caves — those
 * are global passes that depend on neighboring chunks and are handled by the main
 * thread World instance. The tileData here is used only to decide rendering; the
 * authoritative tile state is always in the World object owned by SimulationWorker.
 */
function generateChunk(chunkX, chunkZ, seed) {
  const count = CHUNK_SIZE * CHUNK_SIZE;
  const types      = new Uint8Array(count);
  const elevations = new Float32Array(count);

  const x0 = chunkX * CHUNK_SIZE;
  const z0 = chunkZ * CHUNK_SIZE;

  const baseElev = {
    [TileType.WATER]:    0.04,
    [TileType.BEACH]:    0.06,
    [TileType.GRASS]:    0.12,
    [TileType.WOODLAND]: 0.17,
    [TileType.FOREST]:   0.22,
    [TileType.DESERT]:   0.12,
    [TileType.STONE]:    0.32,
    [TileType.MOUNTAIN]: 1.50,
    [TileType.GLACIER]:  0.60,
    [TileType.LAVA]:     0.08,
    [TileType.DIRT]:     0.12,
  };

  const aridS = seed * 0.491;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = x0 + lx;
      const z = z0 + lz;
      const idx = lz * CHUNK_SIZE + lx;

      const n = _noise(x, z, seed);
      let type;
      if      (n < -0.22) type = TileType.WATER;
      else if (n < -0.08) type = TileType.BEACH;
      else if (n <  0.18) type = TileType.GRASS;
      else if (n <  0.30) type = TileType.WOODLAND;
      else if (n <  0.52) type = TileType.FOREST;
      else if (n <  0.72) type = TileType.STONE;
      else                type = TileType.MOUNTAIN;

      // Desert arid patches (same formula as World.js)
      if (type === TileType.GRASS || type === TileType.WOODLAND || type === TileType.FOREST) {
        const arid = (
          Math.sin(x * 0.023 + aridS)        * Math.cos(z * 0.018 + aridS * 1.6) * 0.50 +
          Math.sin(x * 0.043 + aridS * 1.9)  * Math.cos(z * 0.033 + aridS * 0.5) * 0.30 +
          Math.cos(x * 0.013 + z * 0.020 + aridS * 1.2)                           * 0.20
        ) / 1.0 + 0.5;
        if (arid > 0.91) type = TileType.DESERT;
      }

      const base = baseElev[type] ?? 0.12;
      const elev = base + (Math.sin(x * 3.7 + z * 2.3 + seed) * 0.5 + 0.5) * 0.06;

      // Simple deep-water heuristic within the chunk boundary
      // (full deep-water pass needs neighbours; we approximate here)
      // A full accurate pass is not possible without surrounding tiles,
      // so we leave WATER as-is — ChunkSystem/World has the authoritative type.

      types[idx]      = type;
      elevations[idx] = elev;
    }
  }

  return { types, elevations };
}

// ── Worker message handler ────────────────────────────────────────────────────

self.onmessage = function (e) {
  const { type, chunkX, chunkZ, seed } = e.data;

  if (type !== 'GENERATE_CHUNK') return;

  try {
    const { types, elevations } = generateChunk(chunkX, chunkZ, seed);

    // Post back with Transferable ownership for zero-copy transfer
    self.postMessage(
      { type: 'CHUNK_READY', chunkX, chunkZ, types, elevations },
      [types.buffer, elevations.buffer]
    );
  } catch (err) {
    self.postMessage({ type: 'CHUNK_ERROR', chunkX, chunkZ, message: err.message });
  }
};
