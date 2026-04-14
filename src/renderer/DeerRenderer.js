import * as THREE from 'three';
import { TileType, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

const DEER_COUNT = 5;

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export class DeerRenderer {
  constructor(scene, deer, world) {
    this.scene = scene;
    this.deer = deer;
    this.world = world;
    this.entries = [];
    this._geoms = [];
    this._mats = [];
    this._build();
  }

  _build() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.84 });
    const neckMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.84 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.88 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x9a6848, roughness: 0.84 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xf5f2ec, roughness: 0.88 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.92 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1000, roughness: 0.5 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x1a0e06, roughness: 0.9 });
    this._mats.push(bodyMat, neckMat, legMat, headMat, tailMat, antlerMat, eyeMat, noseMat);

    const rand = seededRand(29);

    // Collect valid spawn tiles
    const validTiles = [];
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = this.world.getTile(x, z);
        if (tile?.type === TileType.GRASS || tile?.type === TileType.WOODLAND) {
          validTiles.push({ x, z });
        }
      }
    }
    for (let i = validTiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [validTiles[i], validTiles[j]] = [validTiles[j], validTiles[i]];
    }

    const bodyGeom = new THREE.BoxGeometry(0.3, 0.3, 0.55);
    const legGeom = new THREE.CylinderGeometry(0.032, 0.025, 0.28, 5);
    const eyeGeom = new THREE.SphereGeometry(0.022, 5, 4);
    this._geoms.push(bodyGeom, legGeom, eyeGeom);

    for (let i = 0; i < Math.min(DEER_COUNT, validTiles.length); i++) {
      const deerSim = this.deer[i];

      const root = new THREE.Group();
      const deerGroup = new THREE.Group();
      deerGroup.position.y = 0.38;

      // Body
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.castShadow = true;
      deerGroup.add(body);

      // Long neck: cylinder angled upward
      const neckGeom = new THREE.CylinderGeometry(0.06, 0.09, 0.36, 7);
      this._geoms.push(neckGeom);
      const neck = new THREE.Mesh(neckGeom, neckMat);
      neck.rotation.x = -0.65;
      neck.position.set(0, 0.18, -0.20);
      neck.castShadow = true;
      deerGroup.add(neck);

      // Head group (so we can rotate it for alert animation)
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.36, -0.38);

      const headGeom = new THREE.SphereGeometry(0.12, 8, 6);
      this._geoms.push(headGeom);
      const head = new THREE.Mesh(headGeom, headMat);
      head.scale.set(0.85, 0.90, 1.05);
      head.castShadow = true;
      headGroup.add(head);

      // Nose
      const noseGeom = new THREE.SphereGeometry(0.045, 5, 4);
      this._geoms.push(noseGeom);
      const nose = new THREE.Mesh(noseGeom, noseMat);
      nose.position.set(0, -0.04, -0.10);
      headGroup.add(nose);

      // Ears
      const earGeom = new THREE.ConeGeometry(0.04, 0.14, 4);
      this._geoms.push(earGeom);
      const earL = new THREE.Mesh(earGeom, bodyMat);
      const earR = earL.clone();
      earL.position.set(-0.10, 0.08, 0.02);
      earR.position.set(0.10, 0.08, 0.02);
      earL.rotation.z = 0.4;
      earR.rotation.z = -0.4;
      headGroup.add(earL, earR);

      // Eyes
      const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
      const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
      eyeL.position.set(-0.09, 0.02, -0.06);
      eyeR.position.set(0.09, 0.02, -0.06);
      headGroup.add(eyeL, eyeR);

      // Antlers for males (~50%)
      let antlers = null;
      if (deerSim.isMale) {
        antlers = new THREE.Group();
        antlers.position.set(0, 0.12, 0.04);

        function makeAntler(side) {
          const g = new THREE.Group();
          g.position.x = side * 0.055;

          const mainGeom = new THREE.CylinderGeometry(0.012, 0.018, 0.25, 4);
          const main = new THREE.Mesh(mainGeom, antlerMat);
          main.position.y = 0.12;
          main.rotation.z = side * 0.25;
          g.add(main);

          // Two forks
          const fork1Geom = new THREE.CylinderGeometry(0.008, 0.012, 0.16, 4);
          const fork1 = new THREE.Mesh(fork1Geom, antlerMat);
          fork1.position.set(side * 0.05, 0.26, -0.03);
          fork1.rotation.set(-0.4, 0, side * 0.5);
          g.add(fork1);

          const fork2Geom = new THREE.CylinderGeometry(0.008, 0.012, 0.14, 4);
          const fork2 = new THREE.Mesh(fork2Geom, antlerMat);
          fork2.position.set(side * 0.08, 0.22, 0.04);
          fork2.rotation.set(0.3, 0, side * 0.35);
          g.add(fork2);

          [mainGeom, fork1Geom, fork2Geom].forEach(geo => this._geoms.push(geo));
          return g;
        }

        const makeAntlerBound = makeAntler.bind(this);
        antlers.add(makeAntlerBound(-1), makeAntlerBound(1));
        headGroup.add(antlers);
      }

      deerGroup.add(headGroup);

      // White tail patch
      const tailGeom = new THREE.SphereGeometry(0.065, 6, 5);
      this._geoms.push(tailGeom);
      const tail = new THREE.Mesh(tailGeom, tailMat);
      tail.position.set(0, 0.04, 0.30);
      tail.castShadow = true;
      deerGroup.add(tail);

      // 4 legs (slightly longer than sheep)
      const legPositions = [
        [-0.10, -0.14, -0.16],
        [ 0.10, -0.14, -0.16],
        [-0.10, -0.14,  0.16],
        [ 0.10, -0.14,  0.16],
      ];
      const legs = legPositions.map(([lx, ly, lz]) => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(lx, ly, lz);
        leg.castShadow = true;
        deerGroup.add(leg);
        return leg;
      });

      root.add(deerGroup);
      this.scene.add(root);

      this.entries.push({
        root,
        deerGroup,
        deerSim,
        legs,
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
    for (const entry of this.entries) {
      const { root, deerGroup, deerSim, legs, headGroup } = entry;

      const tile = this.world.getTile(
        Math.floor(deerSim.x), Math.floor(deerSim.z),
      );
      const surfY = tile ? TerrainRenderer.surfaceY(tile.type) : 0.1;

      const wx = deerSim.x * TILE_SIZE;
      const wz = deerSim.z * TILE_SIZE;

      const fx = deerSim.facingX;
      const fz = deerSim.facingZ;
      const len = Math.hypot(fx, fz) || 1;
      root.position.set(wx, surfY + 0.01, wz);
      root.rotation.set(0, Math.atan2(-fx / len, -fz / len), 0);

      const phase = deerSim.walkPhase;
      const isFleeing = deerSim.isFleeing;
      const isIdle = deerSim.gait === 'idle';
      const alertLevel = deerSim.alertLevel ?? 0;

      let swing = 0.18;
      let bounce = 0;
      if (isFleeing) {
        swing = 0.55;
        bounce = Math.abs(Math.sin(phase * 2)) * 0.05;
      } else if (!isIdle) {
        swing = 0.26;
        bounce = Math.abs(Math.sin(phase)) * 0.016;
      } else {
        swing = 0.04;
        bounce = Math.sin(phase * 0.4) * 0.007;
      }

      deerGroup.position.y = 0.38 + bounce;
      legs[0].rotation.x =  swing * Math.sin(phase);
      legs[1].rotation.x =  swing * Math.sin(phase + Math.PI);
      legs[2].rotation.x =  swing * Math.sin(phase + Math.PI * 0.5);
      legs[3].rotation.x =  swing * Math.sin(phase + Math.PI * 1.5);

      // Alert animation: head raises when fleeing
      const headRaise = alertLevel * 0.45;
      headGroup.rotation.x = -headRaise;
      headGroup.position.y = 0.36 + alertLevel * 0.06;
    }
  }
}
