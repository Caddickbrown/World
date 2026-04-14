/**
 * ChunkSystem — divides the world map into 16×16 tile chunks.
 * Manages which chunks are loaded based on camera/agent position.
 *
 * Integration plan (future):
 *   - World.js: store tiles in chunks instead of flat array
 *   - Renderer: only render loaded chunks
 *   - Currently: provides chunk utilities for future 128×128 expansion (CAD-219)
 */

export const CHUNK_SIZE = 16;  // tiles per chunk side

export class ChunkSystem {
  /**
   * @param {number} worldWidth — total world width in tiles
   * @param {number} worldHeight — total world height in tiles
   * @param {number} viewDistance — chunks to load around focus point (default 3)
   */
  constructor(worldWidth, worldHeight, viewDistance = 3) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.viewDistance = viewDistance;
    this.chunksX = Math.ceil(worldWidth / CHUNK_SIZE);
    this.chunksZ = Math.ceil(worldHeight / CHUNK_SIZE);
    
    /** Set of loaded chunk keys "cx,cz" */
    this.loadedChunks = new Set();
    
    /** Listeners called when chunks load/unload */
    this._onLoad = [];
    this._onUnload = [];
  }

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

    const loaded = [];
    const unloaded = [];

    // Load new chunks
    for (const key of desired) {
      if (!this.loadedChunks.has(key)) {
        this.loadedChunks.add(key);
        loaded.push(key);
        this._onLoad.forEach(fn => fn(key));
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
  onLoad(fn) { this._onLoad.push(fn); }
  onUnload(fn) { this._onUnload.push(fn); }

  /** Get count of currently loaded chunks */
  get loadedCount() { return this.loadedChunks.size; }

  /** Get all loaded chunk keys */
  get allLoadedChunks() { return [...this.loadedChunks]; }
}
