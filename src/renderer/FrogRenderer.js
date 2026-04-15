/**
 * CAD-95: FrogRenderer
 *
 * Renders each frog as a small green flattened sphere body + 4 tiny cylinders
 * for legs. Animates a hop (y oscillation) driven by Frog simulation state.
 */
import * as THREE from 'three';
import { TileType } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

const BODY_COLOR = 0x3a7a2a;  // green
const LEG_COLOR  = 0x2d6020;

export class FrogRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {Frog[]}      frogs  - array of Frog simulation objects
   * @param {object}      world  - World instance
   */
  constructor(scene, frogs, world) {
    this.scene  = scene;
    this.frogs  = frogs;
    this.world  = world;
    this._entries = [];
    this._baseY = TerrainRenderer.surfaceY(TileType.BEACH);
    this._build();
  }

  _build() {
    // Shared geometries and materials
    const bodyGeom = new THREE.SphereGeometry(0.12, 6, 4);
    bodyGeom.scale(1, 0.55, 1); // flatten vertically

    const legGeom  = new THREE.CylinderGeometry(0.018, 0.014, 0.12, 4);
    const bodyMat  = new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.88 });
    const legMat   = new THREE.MeshStandardMaterial({ color: LEG_COLOR,  roughness: 0.9  });
    const eyeGeom  = new THREE.SphereGeometry(0.025, 5, 4);
    const eyeMat   = new THREE.MeshStandardMaterial({ color: 0x111100, roughness: 0.5 });

    for (const frog of this.frogs) {
      const group = new THREE.Group();

      // Body
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.set(0, 0.065, 0);
      group.add(body);

      // Eyes (two bumps on top-front of head)
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeom, eyeMat);
        eye.position.set(side * 0.055, 0.13, 0.06);
        group.add(eye);
      }

      // 4 legs — front pair angled forward, back pair angled back
      const legDefs = [
        { x: -0.08, z:  0.06, ry:  0.4 },  // front-left
        { x:  0.08, z:  0.06, ry: -0.4 },  // front-right
        { x: -0.09, z: -0.06, ry: -0.5 },  // back-left
        { x:  0.09, z: -0.06, ry:  0.5 },  // back-right
      ];
      for (const def of legDefs) {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(def.x, 0.02, def.z);
        leg.rotation.z = def.ry;
        leg.rotation.x = Math.PI * 0.15;
        group.add(leg);
      }

      const wx = frog.currentX * 2;
      const wz = frog.currentZ * 2;
      group.position.set(wx, this._baseY, wz);
      this.scene.add(group);

      this._entries.push({ group, frog });
    }
  }

  /**
   * Update positions each frame. Call from main render loop.
   * @param {number} delta - real seconds (not game time)
   */
  update(delta) {
    for (const { group, frog } of this._entries) {
      const wx = frog.currentX * 2;
      const wz = frog.currentZ * 2;
      const wy = this._baseY + frog.currentYOffset;

      group.position.set(wx, wy, wz);
      group.rotation.y = frog.facingAngle;
    }
  }

  dispose() {
    for (const { group } of this._entries) {
      this.scene.remove(group);
    }
    this._entries.length = 0;
  }
}
