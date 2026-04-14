/**
 * Uniform grid for fast spatial proximity queries.
 * Divides the world into cells of cellSize×cellSize tiles.
 * Agents are bucketed by cell — getNearby only checks relevant cells.
 */
export class SpatialGrid {
  constructor(worldWidth, worldHeight, cellSize = 4) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(worldWidth / cellSize);
    this.rows = Math.ceil(worldHeight / cellSize);
    this.cells = new Array(this.cols * this.rows);
    this.clear();
  }

  /** Remove all agents from the grid. */
  clear() {
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = new Set();
    }
  }

  /** Convert world coords to cell index. */
  _cellIndex(x, z) {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(z / this.cellSize)));
    return row * this.cols + col;
  }

  /** Add an agent to the grid at its current position. */
  insert(agent) {
    const idx = this._cellIndex(agent.x, agent.z);
    this.cells[idx].add(agent);
  }

  /** Remove an agent from the grid at its current position. */
  remove(agent) {
    const idx = this._cellIndex(agent.x, agent.z);
    this.cells[idx].delete(agent);
  }

  /** Move an agent from its old cell to its new cell (if changed). */
  update(agent, oldX, oldZ) {
    const oldIdx = this._cellIndex(oldX, oldZ);
    const newIdx = this._cellIndex(agent.x, agent.z);
    if (oldIdx !== newIdx) {
      this.cells[oldIdx].delete(agent);
      this.cells[newIdx].add(agent);
    }
  }

  /**
   * Return all agents within `radius` tiles of (x, z).
   * Checks only the cells that could overlap the query circle.
   * Callers should still do a precise distance check on the results.
   */
  getNearby(x, z, radius) {
    const results = [];
    const minCol = Math.max(0, Math.floor((x - radius) / this.cellSize));
    const maxCol = Math.min(this.cols - 1, Math.floor((x + radius) / this.cellSize));
    const minRow = Math.max(0, Math.floor((z - radius) / this.cellSize));
    const maxRow = Math.min(this.rows - 1, Math.floor((z + radius) / this.cellSize));

    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const cell = this.cells[row * this.cols + col];
        for (const agent of cell) {
          results.push(agent);
        }
      }
    }
    return results;
  }
}
