/**
 * CAD-92: InsectSwarmRenderer
 *
 * Renders 4 swarms of 20 insects each. Each insect is a tiny dark sphere
 * (SphereGeometry(0.03)). Positions are updated each frame with slight
 * random jitter from InsectSwarm.getPositions().
 */
import * as THREE from 'three';
import { InsectSwarm } from '../simulation/InsectSwarm.js';

const SWARM_COUNT  = 4;
const INSECTS_EACH = 20;

export class InsectSwarmRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object}      world  - World instance
   */
  constructor(scene, world) {
    this.scene  = scene;
    this.world  = world;
    this._swarms = [];
    this._meshGroups = [];
    this._time = 0;
    this._build();
  }

  _build() {
    const geom = new THREE.SphereGeometry(0.03, 4, 3);
    const mat  = new THREE.MeshStandardMaterial({
      color: 0x1a1008,
      roughness: 0.9,
      metalness: 0.0,
    });

    for (let s = 0; s < SWARM_COUNT; s++) {
      const swarm = new InsectSwarm(this.world, s);
      this._swarms.push(swarm);

      const meshes = [];
      for (let i = 0; i < INSECTS_EACH; i++) {
        const mesh = new THREE.Mesh(geom, mat);
        this.scene.add(mesh);
        meshes.push(mesh);
      }
      this._meshGroups.push(meshes);
    }
  }

  /**
   * Tick simulation and update mesh positions.
   * @param {number} delta - real seconds elapsed (used for animation)
   */
  update(delta) {
    this._time += delta;

    for (let s = 0; s < this._swarms.length; s++) {
      const swarm  = this._swarms[s];
      const meshes = this._meshGroups[s];

      swarm.tick(delta, this.world);
      const positions = swarm.getPositions(this._time);

      for (let i = 0; i < meshes.length; i++) {
        const p = positions[i];
        if (p) meshes[i].position.set(p.wx, p.wy, p.wz);
      }
    }
  }

  dispose() {
    for (const meshes of this._meshGroups) {
      for (const mesh of meshes) {
        this.scene.remove(mesh);
      }
    }
    this._meshGroups.length = 0;
    this._swarms.length = 0;
  }
}
