/**
 * MinimapRenderer — 2D canvas overlay showing terrain and agent positions.
 * Toggle with 'M' key (wired up in main.js separately).
 */
export class MinimapRenderer {
  constructor(world, size = 160) {
    this.world = world;
    this.size = size;
    this.visible = true;

    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.cssText = `
      position: fixed;
      bottom: 60px;
      right: 12px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(0,0,0,0.5);
      image-rendering: pixelated;
      z-index: 100;
    `;
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    // Pre-render terrain (static — only changes if world regenerates)
    this._terrainCache = null;
    this._renderTerrain();
  }

  // Tile type -> colour mapping
  static TILE_COLOURS = {
    DEEP_WATER: '#1a3a5c',
    WATER:      '#2b6cb0',
    BEACH:      '#c9a96e',
    GRASS:      '#4a7c3f',
    WOODLAND:   '#2d6a2d',
    FOREST:     '#1a4a1a',
    DESERT:     '#c8a84b',
    STONE:      '#7a7a7a',
    MOUNTAIN:   '#4a4a4a',
  };

  _renderTerrain() {
    const { width, height, tiles } = this.world;
    const cellW = this.size / width;
    const cellH = this.size / height;
    const ctx = this.ctx;

    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const tile = tiles[z][x];
        if (!tile) continue;
        ctx.fillStyle = MinimapRenderer.TILE_COLOURS[tile.type] || '#444';
        ctx.fillRect(x * cellW, z * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
    // Cache terrain as image
    this._terrainCache = ctx.getImageData(0, 0, this.size, this.size);
  }

  update(agents) {
    if (!this.visible) return;
    const { width, height } = this.world;
    const cellW = this.size / width;
    const cellH = this.size / height;
    const ctx = this.ctx;

    // Restore terrain
    if (this._terrainCache) ctx.putImageData(this._terrainCache, 0, 0);

    // Draw agents as dots
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const agent of agents) {
      const px = agent.x * cellW;
      const pz = agent.z * cellH;
      ctx.beginPath();
      ctx.arc(px, pz, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  destroy() {
    this.canvas.remove();
  }
}
