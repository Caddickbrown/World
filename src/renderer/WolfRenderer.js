import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

/**
 * WolfRenderer — renders a pack of 4 wolves.
 * Each wolf: grey torso (BoxGeometry) + sphere head + 4 cylinder legs.
 * Slightly larger and lower-profile than a fox.
 */
export class WolfRenderer {
  constructor(scene, wolves, world) {
    this.scene = scene;
    this.wolves = wolves; // array of Wolf instances (the pack)
    this.world = world;
    this.entries = [];
    this._geoms = [];
    this._mats = [];
    this._build();
  }

  _build() {
    // Shared grey materials
    const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.85 });
    const darkMat  = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.9 });
    const legMat   = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.88 });
    const eyeMat   = new THREE.MeshStandardMaterial({ color: 0xffe040, roughness: 0.3 });
    const noseMat  = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    this._mats.push(bodyMat, darkMat, legMat, eyeMat, noseMat);

    // Shared geometries
    const torsoGeom  = new THREE.BoxGeometry(0.40, 0.22, 0.60);
    const headGeom   = new THREE.SphereGeometry(0.14, 8, 6);
    const snoutGeom  = new THREE.BoxGeometry(0.10, 0.08, 0.14);
    const earGeom    = new THREE.ConeGeometry(0.045, 0.12, 4);
    const legGeom    = new THREE.CylinderGeometry(0.032, 0.026, 0.26, 5);
    const eyeGeom    = new THREE.SphereGeometry(0.024, 5, 4);
    const tailGeom   = new THREE.CylinderGeometry(0.04, 0.02, 0.35, 5);
    this._geoms.push(torsoGeom, headGeom, snoutGeom, earGeom, legGeom, eyeGeom, tailGeom);

    for (let i = 0; i < this.wolves.length; i++) {
      const wolfSim = this.wolves[i];

      const root = new THREE.Group();
      const wolf = new THREE.Group();
      wolf.position.y = 0.26; // lower profile than fox

      // Torso
      const torso = new THREE.Mesh(torsoGeom, bodyMat);
      torso.castShadow = true;
      wolf.add(torso);

      // Head group (at front of torso)
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.08, -0.34);

      const head = new THREE.Mesh(headGeom, bodyMat);
      head.castShadow = true;
      headGroup.add(head);

      // Pointed ears
      const earL = new THREE.Mesh(earGeom, darkMat);
      const earR = earL.clone();
      earL.position.set(-0.075, 0.14, 0.0);
      earR.position.set( 0.075, 0.14, 0.0);
      earL.rotation.z =  0.15;
      earR.rotation.z = -0.15;
      earL.castShadow = earR.castShadow = true;
      headGroup.add(earL, earR);

      // Snout
      const snout = new THREE.Mesh(snoutGeom, noseMat);
      snout.position.set(0, -0.03, -0.15);
      headGroup.add(snout);

      // Eyes (amber)
      const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
      const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
      eyeL.position.set(-0.07, 0.03, -0.10);
      eyeR.position.set( 0.07, 0.03, -0.10);
      headGroup.add(eyeL, eyeR);

      wolf.add(headGroup);

      // Tail (angled up slightly behind torso)
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.06, 0.34);
      tailGroup.rotation.x = -0.7;
      const tail = new THREE.Mesh(tailGeom, darkMat);
      tail.position.y = 0.17;
      tail.castShadow = true;
      tailGroup.add(tail);
      wolf.add(tailGroup);

      // 4 legs — slightly longer than fox (wolfier)
      const legPositions = [
        [-0.12, -0.11, -0.17],
        [ 0.12, -0.11, -0.17],
        [-0.12, -0.11,  0.17],
        [ 0.12, -0.11,  0.17],
      ];
      const legs = legPositions.map(([lx, ly, lz]) => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(lx, ly, lz);
        leg.castShadow = true;
        wolf.add(leg);
        return leg;
      });

      root.add(wolf);
      this.scene.add(root);

      this.entries.push({ root, wolf, wolfSim, legs, tailGroup, headGroup });
    }
  }

  dispose() {
    for (const { root } of this.entries) this.scene.remove(root);
    this.entries = [];
    for (const g of this._geoms) g.dispose();
    this._geoms = [];
    for (const m of this._mats) m.dispose();
    this._mats = [];
  }

  update() {
    for (const entry of this.entries) {
      const { root, wolf, wolfSim, legs, tailGroup, headGroup } = entry;

      if (wolfSim.isDead) {
        root.visible = false;
        continue;
      }
      root.visible = true;

      const tile = this.world.getTile(Math.floor(wolfSim.x), Math.floor(wolfSim.z));
      const surfY = tile ? TerrainRenderer.surfaceY(tile.type) : 0.1;

      const wx = wolfSim.x * TILE_SIZE;
      const wz = wolfSim.z * TILE_SIZE;

      const fx = wolfSim.facingX;
      const fz = wolfSim.facingZ;
      const len = Math.hypot(fx, fz) || 1;
      root.position.set(wx, surfY + 0.01, wz);
      root.rotation.set(0, Math.atan2(-fx / len, -fz / len), 0);

      const phase = wolfSim.walkPhase;
      const isRunning = wolfSim.isHunting || wolfSim.isFleeing;
      const isIdle = wolfSim.gait === 'idle';

      let swing = 0.18;
      let bounce = 0;
      if (isRunning) {
        swing  = 0.52;
        bounce = Math.abs(Math.sin(phase * 2)) * 0.05;
      } else if (!isIdle) {
        swing  = 0.28;
        bounce = Math.abs(Math.sin(phase)) * 0.020;
      } else {
        swing  = 0.06;
        bounce = Math.sin(phase * 0.4) * 0.008;
      }

      wolf.position.y = 0.26 + bounce;
      legs[0].rotation.x =  swing * Math.sin(phase);
      legs[1].rotation.x =  swing * Math.sin(phase + Math.PI);
      legs[2].rotation.x =  swing * Math.sin(phase + Math.PI * 0.5);
      legs[3].rotation.x =  swing * Math.sin(phase + Math.PI * 1.5);

      // Tail swings when running
      tailGroup.rotation.z = Math.sin(phase * (isRunning ? 3.5 : 1.5)) * (isRunning ? 0.22 : 0.10);

      // Head lowers when hunting, raises when idle
      headGroup.rotation.x = isRunning ? 0.15 : 0;
    }
  }
}
