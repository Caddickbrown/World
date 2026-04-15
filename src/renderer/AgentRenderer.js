import * as THREE from 'three';
import { AgentState } from '../simulation/Agent.js';
import { TileType, TILE_SIZE } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

// State body colours
const STATE_COLOR = {
  [AgentState.WANDERING]:   new THREE.Color(0x94a3b8),
  [AgentState.GATHERING]:   new THREE.Color(0xfbbf24),
  [AgentState.SLEEPING]:    new THREE.Color(0x4c6ef5),
  [AgentState.SOCIALIZING]: new THREE.Color(0xa78bfa),
  [AgentState.DISCOVERING]: new THREE.Color(0xfb923c),
  [AgentState.FISHING]:     new THREE.Color(0x22bbcc),
  [AgentState.PERFORMING]:  new THREE.Color(0xff66aa),
};

// State icon colours for the small billboard indicator above agents
const STATE_ICON_COLOR = {
  [AgentState.WANDERING]:   0x888888,
  [AgentState.GATHERING]:   0x44aa44,
  [AgentState.SLEEPING]:    0x2244aa,
  [AgentState.SOCIALIZING]: 0xffcc00,
  [AgentState.DISCOVERING]: 0xff8800,
  [AgentState.FISHING]:     0x00cccc,
  [AgentState.PERFORMING]:  0x00cccc,
};

const DEAD_COLOR = new THREE.Color(0x2a2a2a);

// Six varied skin tones, assigned round-robin by agent ID
const SKIN_TONES = [0xf5d0a9, 0xebb98a, 0xd4956e, 0xc98b6a, 0xe8c49a, 0xbf8860];

export class AgentRenderer {
  constructor(scene, agents, world) {
    this.scene  = scene;
    this.agents = agents;
    this.world  = world;
    this.meshes = [];
    this._build();
  }

  _build() {
    // Shared geometries — agents
    this._bodyGeom = new THREE.CapsuleGeometry(0.155, 0.36, 4, 8);
    this._headGeom = new THREE.SphereGeometry(0.155, 8, 7);
    this._eyeGeom  = new THREE.SphereGeometry(0.038, 5, 4);
    this._eyeMat   = new THREE.MeshStandardMaterial({ color: 0x111122, roughness: 0.5 });

    // Shared boat geometries
    this._boatHullGeom  = new THREE.BoxGeometry(0.80, 0.20, 0.38);
    this._boatDeckGeom  = new THREE.BoxGeometry(0.74, 0.03, 0.34);
    this._boatSideGeom  = new THREE.BoxGeometry(0.80, 0.14, 0.03);
    this._boatMastGeom  = new THREE.CylinderGeometry(0.020, 0.022, 0.68, 5);
    this._boatYardGeom  = new THREE.CylinderGeometry(0.012, 0.012, 0.38, 4);
    this._sailGeom      = new THREE.PlaneGeometry(0.34, 0.44);
    this._boatFlagGeom  = new THREE.PlaneGeometry(0.09, 0.06);
    this._boatHullMat   = new THREE.MeshStandardMaterial({ color: 0x6b3d1e, roughness: 0.9 });
    this._boatDeckMat   = new THREE.MeshStandardMaterial({ color: 0xb8864e, roughness: 0.75 });
    this._boatSideMat   = new THREE.MeshStandardMaterial({ color: 0x5a2e10, roughness: 0.9 });
    this._boatMastMat   = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.9 });
    this._sailMat       = new THREE.MeshStandardMaterial({ color: 0xf4edcc, side: THREE.DoubleSide, roughness: 0.75 });
    this._boatFlagMat   = new THREE.MeshStandardMaterial({ color: 0xcc2222, side: THREE.DoubleSide });

    // One shared selection ring, repositioned each frame
    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(0.30, 0.44, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    this._ring.rotation.x = -Math.PI / 2;
    this._ring.visible = false;
    this.scene.add(this._ring);

    // State indicator: small flat square billboard above the agent's head
    this._indicatorGeom = new THREE.PlaneGeometry(0.18, 0.18);

    // Speech bubble shared geometry/material
    this._speechGeom = new THREE.PlaneGeometry(0.35, 0.18);
    this._speechCanvas = this._createSpeechCanvas();
    this._speechTex = new THREE.CanvasTexture(this._speechCanvas);
    this._speechTex.needsUpdate = true;
    this._speechMat = new THREE.MeshBasicMaterial({
      map: this._speechTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (const agent of this.agents) {
      this._createMeshFor(agent);
    }
  }

  _createSpeechCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    // Rounded rect bubble
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.roundRect(2, 2, 60, 24, 8);
    ctx.fill();
    // Small triangle pointer
    ctx.beginPath();
    ctx.moveTo(24, 26);
    ctx.lineTo(32, 32);
    ctx.lineTo(36, 26);
    ctx.fill();
    // Three dots
    ctx.fillStyle = '#555';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(20 + i * 12, 14, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  _buildBoat() {
    const bg  = new THREE.Group();
    const BY  = -0.30; // base Y — hull sits just below waterline

    // Main hull — deep rectangular body
    const hull = new THREE.Mesh(this._boatHullGeom, this._boatHullMat);
    hull.position.set(0, BY + 0.10, 0);
    hull.castShadow = true;

    // Deck — lighter wood plank surface on top of hull
    const deck = new THREE.Mesh(this._boatDeckGeom, this._boatDeckMat);
    deck.position.set(0, BY + 0.215, 0);

    // Port & starboard side rails (thin dark planks standing up on deck edges)
    const portSide = new THREE.Mesh(this._boatSideGeom, this._boatSideMat);
    portSide.position.set(0, BY + 0.29, +0.185);

    const starbdSide = new THREE.Mesh(this._boatSideGeom, this._boatSideMat);
    starbdSide.position.set(0, BY + 0.29, -0.185);

    // Mast — taller, stepped slightly forward of centre
    const mast = new THREE.Mesh(this._boatMastGeom, this._boatMastMat);
    mast.position.set(0.06, BY + 0.22 + 0.34, 0);

    // Yardarm — horizontal cross-beam the sail hangs from
    const yard = new THREE.Mesh(this._boatYardGeom, this._boatMastMat);
    yard.rotation.z = Math.PI / 2;
    yard.position.set(0.06, BY + 0.22 + 0.56, 0);

    // Sail — large, centred on mast between yard and mid-mast
    const sail = new THREE.Mesh(this._sailGeom, this._sailMat);
    sail.position.set(0.07, BY + 0.22 + 0.44, 0);
    sail.rotation.y = Math.PI / 2;

    // Flag at mast-top
    const flag = new THREE.Mesh(this._boatFlagGeom, this._boatFlagMat);
    flag.position.set(0.10, BY + 0.22 + 0.70, 0);

    bg.add(hull, deck, portSide, starbdSide, mast, yard, sail, flag);
    return bg;
  }

  _createMeshFor(agent) {
    const skinColor = SKIN_TONES[agent.id % SKIN_TONES.length];

    const bodyMat = new THREE.MeshStandardMaterial({
      color: STATE_COLOR[agent.state] ?? STATE_COLOR[AgentState.WANDERING],
      roughness: 0.78,
    });
    const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.85 });

    const body = new THREE.Mesh(this._bodyGeom, bodyMat);
    body.castShadow = true;

    const head = new THREE.Mesh(this._headGeom, headMat);
    head.castShadow = true;
    head.position.y = 0.39;

    // Eyes — share geometry + material
    const eyeL = new THREE.Mesh(this._eyeGeom, this._eyeMat);
    const eyeR = new THREE.Mesh(this._eyeGeom, this._eyeMat);
    eyeL.position.set(-0.065, 0.42, 0.125);
    eyeR.position.set( 0.065, 0.42, 0.125);

    const boatGroup = this._buildBoat();
    boatGroup.visible = false;

    // Speech bubble
    const speech = new THREE.Mesh(this._speechGeom, this._speechMat);
    speech.position.set(0.15, 0.72, 0);
    speech.visible = false;

    // State indicator: small coloured square above the head, always faces camera
    const indicatorMat = new THREE.MeshBasicMaterial({
      color: STATE_ICON_COLOR[agent.state] ?? STATE_ICON_COLOR[AgentState.WANDERING],
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const indicator = new THREE.Mesh(this._indicatorGeom, indicatorMat);
    indicator.position.set(0, 0.75, 0);

    const group = new THREE.Group();
    group.add(body, head, eyeL, eyeR, boatGroup, speech, indicator);
    group.userData.agentId = agent.id;

    this.scene.add(group);
    this.meshes.push({ group, body, bodyMat, headMat, indicatorMat, boatGroup, speech, indicator, agent });
  }

  /** Call this when a new agent is born at runtime */
  addAgent(agent) {
    this._createMeshFor(agent);
  }

  /** Remove all agent meshes and free GPU memory */
  dispose() {
    for (const { group, bodyMat, headMat, indicatorMat } of this.meshes) {
      this.scene.remove(group);
      bodyMat.dispose();
      headMat.dispose();
      if (indicatorMat) indicatorMat.dispose();
    }
    this._bodyGeom.dispose();
    this._headGeom.dispose();
    this._eyeGeom.dispose();
    this._eyeMat.dispose();
    this._boatHullGeom.dispose();
    this._boatDeckGeom.dispose();
    this._boatSideGeom.dispose();
    this._boatMastGeom.dispose();
    this._boatYardGeom.dispose();
    this._sailGeom.dispose();
    this._boatFlagGeom.dispose();
    this._boatHullMat.dispose();
    this._boatDeckMat.dispose();
    this._boatSideMat.dispose();
    this._boatMastMat.dispose();
    this._sailMat.dispose();
    this._boatFlagMat.dispose();
    this.scene.remove(this._ring);
    this._ring.geometry.dispose();
    this._ring.material.dispose();
    this._speechGeom.dispose();
    this._speechMat.dispose();
    this._speechTex.dispose();
    this._indicatorGeom.dispose();
    this.meshes = [];
  }

  update() {
    let ringTarget = null;

    // Periodic dead-mesh cleanup: remove GPU resources for long-dead agents
    // Runs every ~600 frames (≈10s at 60fps) to prevent unbounded mesh growth
    this._cleanupTick = (this._cleanupTick ?? 0) + 1;
    if (this._cleanupTick % 600 === 0) {
      const toRemove = this.meshes.filter(e => e.agent.health <= 0);
      if (toRemove.length > 30) {
        for (const entry of toRemove) {
          this.scene.remove(entry.group);
          entry.bodyMat.dispose();
          entry.headMat.dispose();
        }
        this.meshes = this.meshes.filter(e => e.agent.health > 0);
      }
    }

    for (const { group, bodyMat, indicatorMat, boatGroup, speech, indicator, agent } of this.meshes) {
      if (agent.health <= 0) {
        bodyMat.color.copy(DEAD_COLOR);
        bodyMat.emissive.set(0x000000);
        group.visible = false;
        continue;
      }

      // World position
      const tile = this.world.getTile(Math.floor(agent.x), Math.floor(agent.z));
      const surfY = tile ? TerrainRenderer.surfaceY(tile.type) : 0.14;
      group.position.set(
        agent.x * TILE_SIZE,
        surfY + 0.30,
        agent.z * TILE_SIZE,
      );

      // Face movement direction
      group.rotation.y = Math.atan2(agent.facingX, agent.facingZ);

      // Boat: visible when sailing on water
      const onWater = tile?.type === TileType.WATER || tile?.type === TileType.DEEP_WATER;
      const hasSailing = agent.knowledge?.has('sailing') ?? false;
      boatGroup.visible = onWater && hasSailing;

      // Body colour + emissive selection highlight
      if (agent.discoveryFlash > 0) {
        bodyMat.color.copy(STATE_COLOR[AgentState.DISCOVERING]);
        bodyMat.emissive.setHex(0x3a1a00);
      } else {
        bodyMat.color.copy(STATE_COLOR[agent.state] ?? STATE_COLOR[AgentState.WANDERING]);
        bodyMat.emissive.setHex(agent.selected ? 0x222244 : 0x000000);
      }

      // State indicator: update colour based on current state and billboard to face camera
      if (indicator && indicatorMat) {
        indicatorMat.color.setHex(STATE_ICON_COLOR[agent.state] ?? STATE_ICON_COLOR[AgentState.WANDERING]);
        // Billboard: counteract the group's Y rotation so it always faces forward
        indicator.rotation.y = -group.rotation.y;
      }

      // Speech bubble: only agents who know 'language' can show speech bubbles
      if (speech) {
        const isChatting = agent.socialTimer > 3.5 && agent.knowledge.has('language');
        speech.visible = isChatting;
        if (isChatting) {
          // Billboard: face camera
          speech.rotation.y = -group.rotation.y;
        }
      }

      if (agent.selected) ringTarget = group;

      // Smooth growth from child (0.55) to adult (1.0) — plateaus at maturity (age 40)
      const maturityAge = 40;
      const t = Math.min(1, agent.age / maturityAge);
      const smooth = t * t * (3 - 2 * t);  // smoothstep: slower at start/end, faster mid-growth
      const scale = 0.55 + 0.45 * smooth;
      group.scale.setScalar(scale);

      // Slight bob
      group.position.y += Math.sin(Date.now() * 0.003 + agent.id * 1.3) * 0.04;
    }

    // Selection ring follows selected agent with a gentle pulse
    if (ringTarget) {
      this._ring.visible = true;
      const pulse = 0.92 + Math.sin(Date.now() * 0.004) * 0.08;
      this._ring.scale.setScalar(pulse);
      this._ring.position.set(
        ringTarget.position.x,
        ringTarget.position.y - 0.26,
        ringTarget.position.z,
      );
    } else {
      this._ring.visible = false;
    }
  }

  /** Returns the agent whose mesh was hit by a raycast, or null */
  hitTest(raycaster) {
    const allMeshes = this.meshes.map(m => m.group.children[0]);
    const hits = raycaster.intersectObjects(allMeshes, false);
    if (hits.length === 0) return null;
    const hitBody = hits[0].object;
    const entry = this.meshes.find(m => m.body === hitBody);
    return entry ? entry.agent : null;
  }
}
