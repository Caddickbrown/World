/**
 * CAD-121: RainbowRenderer
 *
 * Renders a rainbow arc when world.weather.rainbow is true.
 * Uses a TorusGeometry(18, 0.3, 8, 40, Math.PI) as a half-arc.
 * 7 colour bands (red→violet) stacked concentrically with slight radius offset.
 * Positioned high above the world centre at y=12.
 * Fades in/out with opacity animation.
 */
import * as THREE from 'three';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../simulation/World.js';

const RAINBOW_Y       = 12;
const FADE_IN_SPEED   = 0.6;  // opacity units per second
const FADE_OUT_SPEED  = 0.4;

// 7 rainbow bands: red → orange → yellow → green → blue → indigo → violet
// Listed outer-to-inner (largest radius first), matching arc appearance.
const BANDS = [
  { color: 0xff2200, radiusOffset:  0.42 },  // red (outer)
  { color: 0xff7700, radiusOffset:  0.28 },  // orange
  { color: 0xffee00, radiusOffset:  0.14 },  // yellow
  { color: 0x44cc11, radiusOffset:  0.00 },  // green (base)
  { color: 0x1188ff, radiusOffset: -0.14 },  // blue
  { color: 0x5544cc, radiusOffset: -0.28 },  // indigo
  { color: 0xaa22ee, radiusOffset: -0.42 },  // violet (inner)
];

const BASE_TORUS_RADIUS = 18; // main arc radius
const TUBE_RADIUS       = 0.22;

export class RainbowRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object}      weather - WeatherSystem instance
   */
  constructor(scene, weather) {
    this.scene   = scene;
    this.weather = weather;
    this._opacity = 0;
    this._meshes  = [];
    this._group   = null;
    this._build();
  }

  _build() {
    const group = new THREE.Group();

    // Centre above world
    const cx = WORLD_WIDTH;   // in world units (TILE_SIZE=2, so centre = width tiles * 1)
    const cz = WORLD_HEIGHT;

    group.position.set(cx, RAINBOW_Y, cz);

    // Rotate so the torus lies in the XY plane (forming an arch over the terrain)
    group.rotation.x = Math.PI / 2;

    for (const band of BANDS) {
      const r    = BASE_TORUS_RADIUS + band.radiusOffset;
      const geom = new THREE.TorusGeometry(r, TUBE_RADIUS, 8, 40, Math.PI);
      const mat  = new THREE.MeshStandardMaterial({
        color:       band.color,
        transparent: true,
        opacity:     0,
        roughness:   0.7,
        metalness:   0.0,
        side:        THREE.DoubleSide,
        depthWrite:  false,
      });
      const mesh = new THREE.Mesh(geom, mat);
      group.add(mesh);
      this._meshes.push(mesh);
    }

    this._group = group;
    group.visible = false;
    this.scene.add(group);
  }

  /**
   * Tick fade in/out animation.
   * @param {number} delta - real seconds
   */
  update(delta) {
    const target = this.weather.rainbow ? 0.72 : 0;

    if (target > this._opacity) {
      this._opacity = Math.min(target, this._opacity + FADE_IN_SPEED * delta);
    } else if (target < this._opacity) {
      this._opacity = Math.max(target, this._opacity - FADE_OUT_SPEED * delta);
    }

    const visible = this._opacity > 0.001;
    this._group.visible = visible;

    if (visible) {
      for (const mesh of this._meshes) {
        mesh.material.opacity = this._opacity;
      }
    }
  }

  dispose() {
    for (const mesh of this._meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.scene.remove(this._group);
    this._meshes.length = 0;
  }
}
