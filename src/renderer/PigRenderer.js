import * as THREE from 'three';
import { TileType, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

// How many pigs to scatter across the world
const PIG_COUNT = 9;

// Seeded pseudo-random (deterministic placement each load)
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export class PigRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this._pigs = []; // { group, homeX, homeZ, phase, wanderAngle, wanderTimer, surfY, legs }
    this._disposables = [];
    this._build();
  }

  _build() {
    // Shared materials
    const bodyMat   = new THREE.MeshStandardMaterial({ color: 0xf4a0a0, roughness: 0.80 });
    const detailMat = new THREE.MeshStandardMaterial({ color: 0xe88888, roughness: 0.85 });
    const legMat    = new THREE.MeshStandardMaterial({ color: 0xf0b8b8, roughness: 0.88 });
    const eyeMat    = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.5  });
    const nostrilMat= new THREE.MeshStandardMaterial({ color: 0xc06060, roughness: 0.9  });

    // Shared geometries
    const bodyGeom    = new THREE.BoxGeometry(0.35, 0.22, 0.28);
    const headGeom    = new THREE.BoxGeometry(0.22, 0.20, 0.20);
    const snoutGeom   = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 8);
    const nostrilGeom = new THREE.CylinderGeometry(0.018, 0.018, 0.065, 6);
    const earGeom     = new THREE.ConeGeometry(0.055, 0.10, 5);
    const legGeom     = new THREE.CylinderGeometry(0.033, 0.028, 0.14, 6);
    const eyeGeom     = new THREE.SphereGeometry(0.025, 5, 4);
    // Tail: small torus segment approximating a curl
    const tailGeom    = new THREE.TorusGeometry(0.045, 0.016, 5, 8, Math.PI * 1.4);

    this._disposables.push(
      bodyMat, detailMat, legMat, eyeMat, nostrilMat,
      bodyGeom, headGeom, snoutGeom, nostrilGeom, earGeom,
      legGeom, eyeGeom, tailGeom
    );

    // Collect grass tiles
    const grassTiles = [];
    for (let z = 0; z < WORLD_HEIGHT; z++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        const tile = this.world.getTile(x, z);
        if (tile?.type === TileType.GRASS) grassTiles.push({ x, z });
      }
    }

    const rand = seededRand(137);

    // Shuffle grass tiles
    for (let i = grassTiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [grassTiles[i], grassTiles[j]] = [grassTiles[j], grassTiles[i]];
    }

    const surfY = TerrainRenderer.surfaceY(TileType.GRASS);

    for (let i = 0; i < Math.min(PIG_COUNT, grassTiles.length); i++) {
      const tile = grassTiles[i];

      const offX = (rand() - 0.5) * 0.8;
      const offZ = (rand() - 0.5) * 0.8;
      const homeX = (tile.x + 0.5 + offX) * TILE_SIZE;
      const homeZ = (tile.z + 0.5 + offZ) * TILE_SIZE;

      const group = new THREE.Group();

      // --- Body ---
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.set(0, 0.11, 0);
      body.castShadow = true;
      group.add(body);

      // --- Head ---
      const head = new THREE.Mesh(headGeom, bodyMat);
      head.position.set(0, 0.16, 0.22);
      head.castShadow = true;
      group.add(head);

      // --- Snout (flat disc on front of head) ---
      const snout = new THREE.Mesh(snoutGeom, detailMat);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, 0.14, 0.335);
      group.add(snout);

      // Nostrils
      const nostrilL = new THREE.Mesh(nostrilGeom, nostrilMat);
      const nostrilR = new THREE.Mesh(nostrilGeom, nostrilMat);
      nostrilL.rotation.x = Math.PI / 2;
      nostrilR.rotation.x = Math.PI / 2;
      nostrilL.position.set(-0.028, 0.14, 0.368);
      nostrilR.position.set( 0.028, 0.14, 0.368);
      group.add(nostrilL, nostrilR);

      // --- Ears (small tapered cones on top of head) ---
      const earL = new THREE.Mesh(earGeom, detailMat);
      const earR = new THREE.Mesh(earGeom, detailMat);
      earL.position.set(-0.075, 0.30, 0.18);
      earR.position.set( 0.075, 0.30, 0.18);
      earL.rotation.z =  0.25;
      earR.rotation.z = -0.25;
      group.add(earL, earR);

      // --- Eyes ---
      const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
      const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
      eyeL.position.set(-0.072, 0.20, 0.318);
      eyeR.position.set( 0.072, 0.20, 0.318);
      group.add(eyeL, eyeR);

      // --- Legs (4 short cylinders) ---
      const legOffsets = [
        [-0.12, 0.025, 0.08],
        [ 0.12, 0.025, 0.08],
        [-0.12, 0.025, -0.08],
        [ 0.12, 0.025, -0.08],
      ];
      const legs = legOffsets.map(([lx, ly, lz]) => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(lx, ly, lz);
        return leg;
      });
      group.add(...legs);

      // --- Tail (curly torus segment at rear) ---
      const tail = new THREE.Mesh(tailGeom, detailMat);
      tail.position.set(0, 0.16, -0.155);
      tail.rotation.x = -Math.PI / 4;
      tail.rotation.y =  Math.PI / 2;
      group.add(tail);

      group.position.set(homeX, surfY + 0.14, homeZ);
      group.rotation.y = rand() * Math.PI * 2;
      this.scene.add(group);

      this._pigs.push({
        group,
        legs,
        homeX,
        homeZ,
        surfY,
        phase: rand() * Math.PI * 2,
        wanderAngle: rand() * Math.PI * 2,
        wanderTimer: rand() * 4,
      });
    }
  }

  update(delta) {
    const now = Date.now() * 0.001;
    for (const pig of this._pigs) {
      // Wander slowly on GRASS tiles
      pig.wanderTimer -= delta;
      if (pig.wanderTimer <= 0) {
        pig.wanderAngle += (Math.random() - 0.5) * 1.0;
        pig.wanderTimer = 2.5 + Math.random() * 3.5;
      }

      const speed = 0.18;
      const wx = pig.homeX + Math.cos(pig.wanderAngle) * 0.55;
      const wz = pig.homeZ + Math.sin(pig.wanderAngle) * 0.55;
      const dx = wx - pig.group.position.x;
      const dz = wz - pig.group.position.z;

      pig.group.position.x += dx * delta * speed;
      pig.group.position.z += dz * delta * speed;

      // Face direction of travel
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
        pig.group.rotation.y = Math.atan2(dx, dz);
      }

      // Gentle bob
      pig.group.position.y = pig.surfY + 0.14 + Math.abs(Math.sin(now * 1.2 + pig.phase)) * 0.008;

      // Leg walk animation
      const t = now * 1.2 + pig.phase;
      const swing = 0.20 * Math.sin(t);
      pig.legs[0].rotation.x =  swing;
      pig.legs[3].rotation.x =  swing;
      pig.legs[1].rotation.x = -swing;
      pig.legs[2].rotation.x = -swing;
    }
  }

  dispose() {
    for (const { group } of this._pigs) {
      this.scene.remove(group);
    }
    for (const d of this._disposables) d.dispose();
    this._pigs = [];
  }
}
