import * as THREE from 'three';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';

const EAGLE_COUNT  = 3;
const SOAR_SPEED   = 0.4;  // radians/sec (orbit angular speed)
const SOAR_Y_MIN   = 8;
const SOAR_Y_MAX   = 12;

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export class EagleRenderer {
  constructor(scene) {
    this.scene = scene;
    this._eagles = [];
    this._build();
  }

  _build() {
    // Body: elongated box
    const bodyGeom = new THREE.BoxGeometry(0.28, 0.14, 0.55);
    // Wing: flat, wide box — spans each side
    const wingGeom = new THREE.BoxGeometry(1.1, 0.06, 0.35);
    // Tail: small flat box
    const tailGeom = new THREE.BoxGeometry(0.18, 0.05, 0.22);
    // Head: small sphere
    const headGeom = new THREE.SphereGeometry(0.10, 7, 5);
    // Beak: tiny box
    const beakGeom = new THREE.BoxGeometry(0.06, 0.05, 0.12);

    const bodyMat  = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.85 });
    const wingMat  = new THREE.MeshStandardMaterial({ color: 0x4a3010, roughness: 0.9  });
    const headMat  = new THREE.MeshStandardMaterial({ color: 0xf5f0e0, roughness: 0.85 });
    const beakMat  = new THREE.MeshStandardMaterial({ color: 0xe0aa20, roughness: 0.7  });

    const rand = seededRand(13);

    // World centre in world units
    const cx = WORLD_WIDTH;   // tiles * 2 * 0.5 * 2 — same as world centre
    const cz = WORLD_HEIGHT;

    for (let i = 0; i < EAGLE_COUNT; i++) {
      const group = new THREE.Group();

      // Body
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      group.add(body);

      // Left wing
      const wingL = new THREE.Mesh(wingGeom, wingMat);
      wingL.position.set(-0.69, 0.02, 0.0);
      group.add(wingL);

      // Right wing
      const wingR = new THREE.Mesh(wingGeom, wingMat);
      wingR.position.set(0.69, 0.02, 0.0);
      group.add(wingR);

      // Tail
      const tail = new THREE.Mesh(tailGeom, wingMat);
      tail.position.set(0, -0.03, -0.35);
      group.add(tail);

      // Head
      const head = new THREE.Mesh(headGeom, headMat);
      head.position.set(0, 0.07, 0.32);
      group.add(head);

      // Beak
      const beak = new THREE.Mesh(beakGeom, beakMat);
      beak.position.set(0, 0.02, 0.48);
      group.add(beak);

      // Each eagle orbits a different centre point at a different altitude and radius
      const orbitCX   = (rand() * WORLD_WIDTH  * 1.5) + WORLD_WIDTH  * 0.25;
      const orbitCZ   = (rand() * WORLD_HEIGHT * 1.5) + WORLD_HEIGHT * 0.25;
      const radius    = 12 + rand() * 14;
      const altitude  = SOAR_Y_MIN + rand() * (SOAR_Y_MAX - SOAR_Y_MIN);
      const angle     = rand() * Math.PI * 2;
      const speed     = SOAR_SPEED * (0.7 + rand() * 0.6);
      const bankPhase = rand() * Math.PI * 2; // wing bank offset

      this._eagles.push({
        group,
        orbitCX, orbitCZ,
        radius,
        altitude,
        angle,
        speed,
        bankPhase,
        time: rand() * 100,
      });

      group.position.set(
        orbitCX * 2 + radius * Math.sin(angle),
        altitude,
        orbitCZ * 2 + radius * Math.cos(angle)
      );
      this.scene.add(group);
    }
  }

  update(delta) {
    for (const e of this._eagles) {
      e.angle += e.speed * delta;
      e.time  += delta;

      const wx = e.orbitCX * 2 + e.radius * Math.sin(e.angle);
      const wz = e.orbitCZ * 2 + e.radius * Math.cos(e.angle);

      // Gentle altitude bob
      const wy = e.altitude + Math.sin(e.time * 0.4) * 0.6;

      e.group.position.set(wx, wy, wz);

      // Face direction of travel (tangent to circle)
      e.group.rotation.y = -e.angle - Math.PI / 2;

      // Gentle banking roll as the eagle turns
      e.group.rotation.z = Math.sin(e.time * e.speed * 0.8 + e.bankPhase) * 0.18;
    }
  }

  dispose() {
    for (const e of this._eagles) {
      this.scene.remove(e.group);
    }
    this._eagles.length = 0;
  }
}
