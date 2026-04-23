/**
 * ChunkSystem — divides the world map into 16×16 tile chunks.
 * Manages which chunks are loaded based on camera/agent position.
 *
 * CAD-165: chunk generation is now dispatched to TerrainWorker so tile-data
 * production never blocks the main thread.  Callers register an onChunkData
 * callback to receive the typed arrays when the worker finishes.
 *
 * Integration plan (future):
 *   - World.js: store tiles in chunks instead of flat array
 *   - Renderer: only render loaded chunks
 *   - Currently: provides chunk utilities for future 128×128 expansion (CAD-219)
 */

export const CHUNK_SIZE = 16;  // tiles per chunk side

export class ChunkSystem {
  /**
   * @param {number} worldWidth  — total world width in tiles
   * @param {number} worldHeight — total world height in tiles
   * @param {number} viewDistance — chunks to load around focus point (default 3)
   * @param {number} [seed]       — world seed forwarded to TerrainWorker
   */
  constructor(worldWidth, worldHeight, viewDistance = 3, seed = 0) {
    this.worldWidth  = worldWidth;
    this.worldHeight = worldHeight;
    this.viewDistance = viewDistance;
    this.seed = seed;
    this.chunksX = Math.ceil(worldWidth  / CHUNK_SIZE);
    this.chunksZ = Math.ceil(worldHeight / CHUNK_SIZE);

    /** Set of loaded chunk keys "cx,cz" */
    this.loadedChunks = new Set();

    /** Keys currently pending worker response */
    this._pendingChunks = new Set();

    /** Listeners called when chunks load/unload */
    this._onLoad   = [];
    this._onUnload = [];

    /** Listeners called when chunk tile data arrives from the worker */
    this._onChunkData = [];

    // Spin up the TerrainWorker
    this._worker = null;
    this._initWorker();
  }

  // ── TerrainWorker integration ─────────────────────────────────────────────

  _initWorker() {
    try {
      // Use import.meta.url so the path resolves correctly regardless of bundler.
      // Vite/Rollup will inline worker scripts at build time when the ?worker hint is
      // absent; at runtime in dev-mode the raw URL is used directly.
      this._worker = new Worker(
        new URL('../workers/TerrainWorker.js', import.meta.url),
        { type: 'module' }
      );
      this._worker.onmessage  = (e) => this._onWorkerMessage(e.data);
      this._worker.onerror    = (e) => console.error('[ChunkSystem] TerrainWorker error:', e);
    } catch (err) {
      // Graceful fallback: worker unavailable (e.g. unit-test environment).
      console.warn('[ChunkSystem] Could not start TerrainWorker, falling back to sync stub:', err);
      this._worker = null;
    }
  }

  _onWorkerMessage(data) {
    const { type, chunkX, chunkZ } = data;
    const key = this.chunkKey(chunkX, chunkZ);

    if (type === 'CHUNK_READY') {
      this._pendingChunks.delete(key);
      const { types, elevations } = data;
      this._onChunkData.forEach(fn => fn(chunkX, chunkZ, types, elevations));
    } else if (type === 'CHUNK_ERROR') {
      this._pendingChunks.delete(key);
      console.error(`[ChunkSystem] TerrainWorker failed for chunk ${key}:`, data.message);
    }
  }

  /**
   * Request terrain generation for a chunk via the worker.
   * If the worker is unavailable the request is silently dropped — callers
   * that need synchronous tile access should use World.tiles directly.
   * @param {number} cx
   * @param {number} cz
   */
  requestChunkGeneration(cx, cz) {
    const key = this.chunkKey(cx, cz);
    if (this._pendingChunks.has(key)) return; // already in-flight
    if (!this._worker) return;

    this._pendingChunks.add(key);
    this._worker.postMessage({
      type: 'GENERATE_CHUNK',
      chunkX: cx,
      chunkZ: cz,
      seed: this.seed,
    });
  }

  /**
   * Register a callback that fires when the worker delivers tile data.
   * Signature: fn(chunkX, chunkZ, types: Uint8Array, elevations: Float32Array)
   */
  onChunkData(fn) { this._onChunkData.push(fn); }

  /** Terminate the worker. Call when the world is disposed. */
  terminateWorker() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }

  // ── Chunk management (unchanged public API) ───────────────────────────────

  /** Convert tile coordinate to chunk coordinate */
  tileToChunk(tileCoord) {
    return Math.floor(tileCoord / CHUNK_SIZE);
  }

  /** Get chunk key string */
  chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  /** Get the tile bounds for a given chunk */
  chunkBounds(cx, cz) {
    return {
      x0: cx * CHUNK_SIZE,
      z0: cz * CHUNK_SIZE,
      x1: Math.min((cx + 1) * CHUNK_SIZE, this.worldWidth),
      z1: Math.min((cz + 1) * CHUNK_SIZE, this.worldHeight),
    };
  }

  /**
   * Update loaded chunks based on a focus point (e.g. camera or average agent position).
   * Loads chunks within viewDistance, unloads those outside.
   * New chunks are automatically dispatched to TerrainWorker for generation.
   * @param {number} focusTileX
   * @param {number} focusTileZ
   * @returns {{ loaded: string[], unloaded: string[] }}
   */
  update(focusTileX, focusTileZ) {
    const fcx = this.tileToChunk(focusTileX);
    const fcz = this.tileToChunk(focusTileZ);

    const desired = new Set();
    for (let dz = -this.viewDistance; dz <= this.viewDistance; dz++) {
      for (let dx = -this.viewDistance; dx <= this.viewDistance; dx++) {
        const cx = fcx + dx;
        const cz = fcz + dz;
        if (cx >= 0 && cx < this.chunksX && cz >= 0 && cz < this.chunksZ) {
          desired.add(this.chunkKey(cx, cz));
        }
      }
    }

    const loaded   = [];
    const unloaded = [];

    // Load new chunks — dispatch generation to worker
    for (const key of desired) {
      if (!this.loadedChunks.has(key)) {
        this.loadedChunks.add(key);
        loaded.push(key);
        this._onLoad.forEach(fn => fn(key));

        // Dispatch off-thread generation for the new chunk
        const [cx, cz] = key.split(',').map(Number);
        this.requestChunkGeneration(cx, cz);
      }
    }

    // Unload distant chunks
    for (const key of this.loadedChunks) {
      if (!desired.has(key)) {
        this.loadedChunks.delete(key);
        unloaded.push(key);
        this._onUnload.forEach(fn => fn(key));
      }
    }

    return { loaded, unloaded };
  }

  /** Check if a tile is in a loaded chunk */
  isTileLoaded(tileX, tileZ) {
    const key = this.chunkKey(this.tileToChunk(tileX), this.tileToChunk(tileZ));
    return this.loadedChunks.has(key);
  }

  /** Get all tile coords in a chunk */
  getTilesInChunk(cx, cz) {
    const b = this.chunkBounds(cx, cz);
    const tiles = [];
    for (let z = b.z0; z < b.z1; z++) {
      for (let x = b.x0; x < b.x1; x++) {
        tiles.push({ x, z });
      }
    }
    return tiles;
  }

  /** Register load/unload callbacks */
  onLoad(fn)   { this._onLoad.push(fn); }
  onUnload(fn) { this._onUnload.push(fn); }

  /** Get count of currently loaded chunks */
  get loadedCount() { return this.loadedChunks.size; }

  /** Get all loaded chunk keys */
  get allLoadedChunks() { return [...this.loadedChunks]; }
}
