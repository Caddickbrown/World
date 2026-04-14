import * as THREE from 'three';
import { TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';

const FLOCK_COUNT = 3;
const BIRDS_PER_FLOCK_MIN = 8;
const BIRDS_PER_FLOCK_MAX = 12;

const FLY_Y_MIN = 4;
const FLY_Y_MAX = 7;

// Boid parameters
const COHESION_RADIUS   = 4.0;
const SEPARATION_RADIUS = 1.2;
const ALIGNMENT_RADIUS  = 3.0;
const COHESION_FORCE    = 0.4;
const SEPARATION_FORCE  = 1.8;
const ALIGNMENT_FORCE   = 0.5;
const MAX_SPEED         = 4.5;
const MIN_SPEED         = 1.8;
const TURN_FORCE        = 0.9;

// World bounds in world units (with margin)
const MARGIN = TILE_SIZE * 4;

function clampMag(v, max) {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m > max) {
    const s = max / m;
    v.x *= s; v.y *= s; v.z *= s;
  }
  return v;
}

class Bird {
  constructor(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED) * 0.5;
    const ang = Math.random() * Math.PI * 2;
    this.vx = Math.cos(ang) * speed;
    this.vy = (Math.random() - 0.5) * 0.4;
    this.vz = Math.sin(ang) * speed;
    this.wingPhase = Math.random() * Math.PI * 2;
  }
}

export class BirdFlockRenderer {
  constructor(scene) {
    this.scene = scene;
    this._geoms = [];
    this._mats = [];
    this.flocks = [];
    this._build();
  }

  _build() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.85 });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    this._mats.push(bodyMat, wingMat);

    const worldW = WORLD_WIDTH  * TILE_SIZE;
    const worldH = WORLD_HEIGHT * TILE_SIZE;

    const bodyGeom = new THREE.BoxGeometry(0.08, 0.03, 0.15);
    const wingGeom = new THREE.PlaneGeometry(0.16, 0.06);
    this._geoms.push(bodyGeom, wingGeom);

    for (let f = 0; f < FLOCK_COUNT; f++) {
      const count = BIRDS_PER_FLOCK_MIN +
        Math.floor(Math.random() * (BIRDS_PER_FLOCK_MAX - BIRDS_PER_FLOCK_MIN + 1));

      // Centre of flock spread over the world
      const cx = MARGIN + Math.random() * (worldW - MARGIN * 2);
      const cz = MARGIN + Math.random() * (worldH - MARGIN * 2);
      const cy = FLY_Y_MIN + Math.random() * (FLY_Y_MAX - FLY_Y_MIN);

      const birds = [];
      const meshes = [];

      for (let b = 0; b < count; b++) {
        const bx = cx + (Math.random() - 0.5) * 6;
        const bz = cz + (Math.random() - 0.5) * 6;
        const by = cy + (Math.random() - 0.5) * 1.5;
        const bird = new Bird(bx, by, bz);
        birds.push(bird);

        const group = new THREE.Group();

        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.castShadow = false;
        group.add(body);

        // Left and right wing planes
        const wingL = new THREE.Mesh(wingGeom, wingMat);
        const wingR = new THREE.Mesh(wingGeom, wingMat);
        wingL.position.set(-0.12, 0, 0);
        wingR.position.set( 0.12, 0, 0);
        // Wings lie horizontal initially; flap around their X origin
        group.add(wingL, wingR);

        group.position.set(bx, by, bz);
        this.scene.add(group);
        meshes.push({ group, wingL, wingR });
      }

      // Flock wander state: slowly drift direction every few seconds
      this.flocks.push({
        birds,
        meshes,
        // Flock-level wander direction (used to gently push all birds)
        wanderAng: Math.random() * Math.PI * 2,
        wanderTimer: 3 + Math.random() * 4,
      });
    }
  }

  dispose() {
    for (const flock of this.flocks) {
      for (const { group } of flock.meshes) this.scene.remove(group);
    }
    this.flocks = [];
    for (const g of this._geoms) g.dispose();
    this._geoms = [];
    for (const m of this._mats) m.dispose();
    this._mats = [];
  }

  update(delta) {
    const worldW = WORLD_WIDTH  * TILE_SIZE;
    const worldH = WORLD_HEIGHT * TILE_SIZE;

    for (const flock of this.flocks) {
      const { birds, meshes } = flock;

      // Update flock wander
      flock.wanderTimer -= delta;
      if (flock.wanderTimer <= 0) {
        flock.wanderAng += (Math.random() - 0.5) * Math.PI * 0.9;
        flock.wanderTimer = 4 + Math.random() * 6;
      }

      // Boid forces per bird
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        let cx = 0, cy = 0, cz = 0; // cohesion
        let sx = 0, sy = 0, sz = 0; // separation
        let ax = 0, ay = 0, az = 0; // alignment
        let cohN = 0, sepN = 0, aliN = 0;

        for (let j = 0; j < birds.length; j++) {
          if (i === j) continue;
          const o = birds[j];
          const dx = o.x - b.x, dy = o.y - b.y, dz = o.z - b.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist < COHESION_RADIUS) {
            cx += o.x; cy += o.y; cz += o.z; cohN++;
          }
          if (dist < SEPARATION_RADIUS && dist > 0.001) {
            sx -= dx / dist; sy -= dy / dist; sz -= dz / dist; sepN++;
          }
          if (dist < ALIGNMENT_RADIUS) {
            ax += o.vx; ay += o.vy; az += o.vz; aliN++;
          }
        }

        let fx = 0, fy = 0, fz = 0;

        if (cohN > 0) {
          const tcx = cx / cohN - b.x;
          const tcy = cy / cohN - b.y;
          const tcz = cz / cohN - b.z;
          const m = Math.hypot(tcx, tcy, tcz) || 1;
          fx += (tcx / m) * COHESION_FORCE;
          fy += (tcy / m) * COHESION_FORCE;
          fz += (tcz / m) * COHESION_FORCE;
        }
        if (sepN > 0) {
          const m = Math.hypot(sx, sy, sz) || 1;
          fx += (sx / m) * SEPARATION_FORCE;
          fy += (sy / m) * SEPARATION_FORCE;
          fz += (sz / m) * SEPARATION_FORCE;
        }
        if (aliN > 0) {
          const m = Math.hypot(ax, ay, az) || 1;
          fx += (ax / m) * ALIGNMENT_FORCE;
          fy += (ay / m) * ALIGNMENT_FORCE;
          fz += (az / m) * ALIGNMENT_FORCE;
        }

        // Flock wander nudge
        fx += Math.cos(flock.wanderAng) * TURN_FORCE * 0.3;
        fz += Math.sin(flock.wanderAng) * TURN_FORCE * 0.3;

        // Y boundary enforcement — keep birds in fly zone
        if (b.y < FLY_Y_MIN) fy += (FLY_Y_MIN - b.y) * 2.5;
        if (b.y > FLY_Y_MAX) fy -= (b.y - FLY_Y_MAX) * 2.5;

        // Horizontal boundary enforcement
        if (b.x < MARGIN) fx += (MARGIN - b.x) * 1.5;
        if (b.x > worldW - MARGIN) fx -= (b.x - (worldW - MARGIN)) * 1.5;
        if (b.z < MARGIN) fz += (MARGIN - b.z) * 1.5;
        if (b.z > worldH - MARGIN) fz -= (b.z - (worldH - MARGIN)) * 1.5;

        // Apply forces
        b.vx += fx * delta;
        b.vy += fy * delta;
        b.vz += fz * delta;

        // Clamp speed
        const spd = Math.hypot(b.vx, b.vy, b.vz);
        if (spd > MAX_SPEED) {
          const s = MAX_SPEED / spd;
          b.vx *= s; b.vy *= s; b.vz *= s;
        } else if (spd < MIN_SPEED && spd > 0.001) {
          const s = MIN_SPEED / spd;
          b.vx *= s; b.vy *= s; b.vz *= s;
        }

        // Integrate position
        b.x += b.vx * delta;
        b.y += b.vy * delta;
        b.z += b.vz * delta;

        // Wing flap
        b.wingPhase += delta * (7 + spd * 0.8);
      }

      // Update meshes
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        const { group, wingL, wingR } = meshes[i];

        group.position.set(b.x, b.y, b.z);

        // Face direction of travel
        const hspd = Math.hypot(b.vx, b.vz);
        if (hspd > 0.01) {
          group.rotation.y = Math.atan2(-b.vx, -b.vz);
        }
        // Pitch slightly in direction of vertical velocity
        group.rotation.x = -b.vy * 0.15;

        // Wing flap: wings rotate up/down around local X from hinge at body
        const flapAngle = Math.sin(b.wingPhase) * 0.55;
        wingL.rotation.z = -flapAngle;
        wingR.rotation.z =  flapAngle;
      }
    }
  }
}
