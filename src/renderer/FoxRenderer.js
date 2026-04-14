import * as THREE from 'three';
import { TileType, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

const FOX_COUNT = 6;

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export class FoxRenderer {
  constructor(scene, foxes, world) {
    this.scene = scene;
    this.foxes = foxes;
    this.world = world;
    this.entries = [];
    this._geoms = [];
    this._mats = [];
    this._build();
  }

  _build() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc45c0a, roughness: 0.82 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xd4700e, roughness: 0.85 });
    const tailTipMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.88 });
    const earMat = new THREE.MeshStandardMaterial({ color: 0xc45c0a, roughness: 0.82 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0xa04808, roughness: 0.88 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1000, roughness: 0.5 });
    this._mats.push(bodyMat, tailMat, tailTipMat, earMat, snoutMat, legMat, eyeMat);

    const rand = seededRand(17);

    const grassAndWoodland = [];
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = this.world.getTile(x, z);
        if (tile?.type === TileType.GRASS || tile?.type === TileType.WOODLAND) {
          grassAndWoodland.push({ x, z });
        }
      }
    }
    // Shuffle
    for (let i = grassAndWoodland.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [grassAndWoodland[i], grassAndWoodland[j]] = [grassAndWoodland[j], grassAndWoodland[i]];
    }

    const bodyGeom = new THREE.BoxGeometry(0.35, 0.18, 0.55);
    const legGeom = new THREE.CylinderGeometry(0.028, 0.022, 0.22, 5);
    const earGeom = new THREE.ConeGeometry(0.045, 0.13, 4);
    const snoutGeom = new THREE.BoxGeometry(0.10, 0.08, 0.12);
    const eyeGeom = new THREE.SphereGeometry(0.022, 5, 4);
    this._geoms.push(bodyGeom, legGeom, earGeom, snoutGeom, eyeGeom);

    for (let i = 0; i < Math.min(FOX_COUNT, grassAndWoodland.length); i++) {
      const foxSim = this.foxes[i];

      const root = new THREE.Group();
      const fox = new THREE.Group();
      fox.position.y = 0.22;

      // Body
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = 0;
      body.castShadow = true;
      fox.add(body);

      // Head group
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.06, -0.30);

      const headGeom = new THREE.BoxGeometry(0.20, 0.16, 0.22);
      this._geoms.push(headGeom);
      const head = new THREE.Mesh(headGeom, bodyMat);
      head.castShadow = true;
      headGroup.add(head);

      // Pointed ears
      const earL = new THREE.Mesh(earGeom, earMat);
      const earR = earL.clone();
      earL.position.set(-0.065, 0.12, 0.02);
      earR.position.set(0.065, 0.12, 0.02);
      earL.rotation.z = 0.18;
      earR.rotation.z = -0.18;
      earL.castShadow = earR.castShadow = true;
      headGroup.add(earL, earR);

      // Dark snout
      const snout = new THREE.Mesh(snoutGeom, snoutMat);
      snout.position.set(0, -0.03, -0.14);
      snout.castShadow = true;
      headGroup.add(snout);

      // Eyes
      const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
      const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
      eyeL.position.set(-0.072, 0.025, -0.08);
      eyeR.position.set(0.072, 0.025, -0.08);
      headGroup.add(eyeL, eyeR);

      fox.add(headGroup);

      // Bushy tail — cone angled upward behind body
      const tailGroup = new THREE.Group();
      tailGroup.position.set(0, 0.04, 0.30);
      tailGroup.rotation.x = -0.85; // angle upward

      const tailBodyGeom = new THREE.ConeGeometry(0.12, 0.45, 6);
      this._geoms.push(tailBodyGeom);
      const tailBody = new THREE.Mesh(tailBodyGeom, tailMat);
      tailBody.position.y = 0.22;
      tailBody.castShadow = true;
      tailGroup.add(tailBody);

      // White tip at end of tail
      const tailTipGeom = new THREE.SphereGeometry(0.075, 6, 5);
      this._geoms.push(tailTipGeom);
      const tailTip = new THREE.Mesh(tailTipGeom, tailTipMat);
      tailTip.position.y = 0.46;
      tailTip.castShadow = true;
      tailGroup.add(tailTip);

      fox.add(tailGroup);

      // 4 legs
      const legPositions = [
        [-0.10, -0.09, -0.15],
        [ 0.10, -0.09, -0.15],
        [-0.10, -0.09,  0.15],
        [ 0.10, -0.09,  0.15],
      ];
      const legs = legPositions.map(([lx, ly, lz]) => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(lx, ly, lz);
        leg.castShadow = true;
        fox.add(leg);
        return leg;
      });

      root.add(fox);
      this.scene.add(root);

      this.entries.push({
        root,
        fox,
        foxSim,
        legs,
        tailGroup,
        headGroup,
      });
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
    const now = Date.now() * 0.001;
    for (const entry of this.entries) {
      const { root, fox, foxSim, legs, tailGroup, headGroup } = entry;

      const tile = this.world.getTile(
        Math.floor(foxSim.x), Math.floor(foxSim.z),
      );
      const surfY = tile ? TerrainRenderer.surfaceY(tile.type) : 0.1;

      const wx = foxSim.x * TILE_SIZE;
      const wz = foxSim.z * TILE_SIZE;

      const fx = foxSim.facingX;
      const fz = foxSim.facingZ;
      const len = Math.hypot(fx, fz) || 1;
      root.position.set(wx, surfY + 0.01, wz);
      root.rotation.set(0, Math.atan2(-fx / len, -fz / len), 0);

      const phase = foxSim.walkPhase;
      const isRunning = foxSim.isStartled;
      const isIdle = foxSim.gait === 'idle';

      // Leg walk animation
      let swing = 0.18;
      let bounce = 0;
      if (isRunning) {
        swing = 0.50;
        bounce = Math.abs(Math.sin(phase * 2)) * 0.04;
      } else if (!isIdle) {
        swing = 0.28;
        bounce = Math.abs(Math.sin(phase)) * 0.018;
      } else {
        swing = 0.05;
        bounce = Math.sin(phase * 0.4) * 0.008;
      }

      fox.position.y = 0.22 + bounce;
      legs[0].rotation.x =  swing * Math.sin(phase);
      legs[1].rotation.x =  swing * Math.sin(phase + Math.PI);
      legs[2].rotation.x =  swing * Math.sin(phase + Math.PI * 0.5);
      legs[3].rotation.x =  swing * Math.sin(phase + Math.PI * 1.5);

      // Tail wag
      tailGroup.rotation.z = Math.sin(phase * (isRunning ? 3 : 1.5)) * (isRunning ? 0.20 : 0.12);

      // Alert head raise when startled
      if (isRunning) {
        headGroup.rotation.x = -0.15;
      } else {
        headGroup.rotation.x = 0;
      }
    }
  }
}
