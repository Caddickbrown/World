import * as THREE from 'three';
import { TILE_SIZE } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

const LOD_NEAR  = 30;   // world units — full detail
const LOD_FAR   = 80;   // world units — hide beyond this distance

/**
 * WhaleRenderer — renders 2 whales as large dark-blue elongated shapes.
 * Body: BoxGeometry(2, 0.5, 0.8) with additional geometry for bulk.
 * Tail fin: separate box, animated rotation.
 * LOD: only visible within LOD_FAR world units of camera.
 */
export class WhaleRenderer {
  constructor(scene, whales, world) {
    this.scene  = scene;
    this.whales = whales;
    this.world  = world;
    this.entries = [];
    this._geoms = [];
    this._mats  = [];
    this._build();
  }

  _build() {
    const bodyMat    = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.8 });
    const bellyMat   = new THREE.MeshStandardMaterial({ color: 0x3a5a7a, roughness: 0.85 });
    const finMat     = new THREE.MeshStandardMaterial({ color: 0x0f1a30, roughness: 0.85 });
    this._mats.push(bodyMat, bellyMat, finMat);

    // Shared geometries
    const mainBodyGeom = new THREE.BoxGeometry(2.0, 0.5, 0.8);    // main torso
    const midBulkGeom  = new THREE.BoxGeometry(1.2, 0.55, 0.85);  // widest mid-section
    const headGeom     = new THREE.BoxGeometry(0.5, 0.35, 0.55);  // tapered head
    const tailBaseGeom = new THREE.BoxGeometry(0.6, 0.3,  0.4);   // narrow tail stock
    const tailFinGeom  = new THREE.BoxGeometry(0.8, 0.06, 0.35);  // horizontal flukes
    const dorsalGeom   = new THREE.BoxGeometry(0.12, 0.25, 0.22); // dorsal fin
    const pectoralGeom = new THREE.BoxGeometry(0.6, 0.06, 0.18);  // pectoral fins
    this._geoms.push(
      mainBodyGeom, midBulkGeom, headGeom, tailBaseGeom,
      tailFinGeom, dorsalGeom, pectoralGeom,
    );

    for (const whaleSim of this.whales) {
      const root  = new THREE.Group();
      const whale = new THREE.Group();

      // Main body torso
      const mainBody = new THREE.Mesh(mainBodyGeom, bodyMat);
      mainBody.castShadow = true;
      whale.add(mainBody);

      // Mid-section bulk overlay
      const midBulk = new THREE.Mesh(midBulkGeom, bodyMat);
      midBulk.position.set(-0.1, 0, 0);
      midBulk.castShadow = true;
      whale.add(midBulk);

      // Head (front, tapered)
      const head = new THREE.Mesh(headGeom, bodyMat);
      head.position.set(-1.0, -0.05, 0);
      head.castShadow = true;
      whale.add(head);

      // Belly lighter colour on underside
      const bellyGeom = new THREE.BoxGeometry(1.6, 0.06, 0.6);
      this._geoms.push(bellyGeom);
      const belly = new THREE.Mesh(bellyGeom, bellyMat);
      belly.position.set(-0.1, -0.26, 0);
      whale.add(belly);

      // Tail stock
      const tailBase = new THREE.Mesh(tailBaseGeom, bodyMat);
      tailBase.position.set(0.95, 0, 0);
      tailBase.castShadow = true;
      whale.add(tailBase);

      // Tail flukes (animated)
      const tailFinGroup = new THREE.Group();
      tailFinGroup.position.set(1.35, 0, 0);
      const tailFin = new THREE.Mesh(tailFinGeom, finMat);
      tailFin.castShadow = true;
      tailFinGroup.add(tailFin);
      whale.add(tailFinGroup);

      // Dorsal fin on top
      const dorsal = new THREE.Mesh(dorsalGeom, finMat);
      dorsal.position.set(0.1, 0.35, 0);
      dorsal.castShadow = true;
      whale.add(dorsal);

      // Pectoral fins (left + right)
      const pecL = new THREE.Mesh(pectoralGeom, finMat);
      const pecR = new THREE.Mesh(pectoralGeom, finMat);
      pecL.position.set(-0.3, -0.1,  0.48);
      pecR.position.set(-0.3, -0.1, -0.48);
      pecL.rotation.z =  0.3;
      pecR.rotation.z =  0.3;
      whale.add(pecL, pecR);

      root.add(whale);
      this.scene.add(root);

      this.entries.push({ root, whale, whaleSim, tailFinGroup });
    }
  }

  dispose() {
    for (const { root } of this.entries) this.scene.remove(root);
    this.entries = [];
    for (const g of this._geoms) g.dispose();
    this._geoms = [];
    for (const m of this._mats) m.dispose();
    this._mats  = [];
  }

  /**
   * @param {THREE.Camera} camera - optional, for LOD distance check
   */
  update(camera = null) {
    for (const entry of this.entries) {
      const { root, whale, whaleSim, tailFinGroup } = entry;

      const wx = whaleSim.x * TILE_SIZE;
      const wz = whaleSim.z * TILE_SIZE;

      // LOD — hide beyond LOD_FAR from camera
      if (camera) {
        const camDist = Math.hypot(
          camera.position.x - wx,
          camera.position.z - wz,
        );
        root.visible = camDist < LOD_FAR;
        if (!root.visible) continue;
      }

      // Whales always sit at water level; breachY lifts them
      root.position.set(wx, whaleSim.breachY, wz);

      // Facing — whale swims along its X-axis (head at -X in local space)
      const fx  = whaleSim.facingX;
      const fz  = whaleSim.facingZ;
      const len = Math.hypot(fx, fz) || 1;
      // Rotate so local -X aligns with facing direction
      root.rotation.set(0, Math.atan2(-fx / len, -fz / len), 0);

      // Tail flap animation (rotation around local Z, gentle oscillation)
      const phase = whaleSim.tailPhase;
      tailFinGroup.rotation.z = Math.sin(phase) * 0.18;

      // Slight body roll during breach
      if (whaleSim.isBreaching) {
        whale.rotation.z = Math.sin(phase * 2) * 0.15;
      } else {
        whale.rotation.z *= 0.9; // damp back to 0
      }
    }
  }
}
