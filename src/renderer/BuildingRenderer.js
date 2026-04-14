import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../simulation/World.js';
import { TerrainRenderer } from './TerrainRenderer.js';

/** Priority: higher wins when multiple sleepers share a tile. Temple above church so shared halls outrank steeples. */
const RANK = {
  temple: 45,
  church: 42,
  workshop: 35,
  shrine: 32,
  tree_house: 30,
  barn: 24,
  coop: 22,
  housing: 20,
  shelter: 10,
};

/** Max temple meshes on the map — rare communal landmark, not a replacement for houses. */
const MAX_TEMPLES  = 2;
/** Max church meshes on the map (rare landmark, not every hut). */
const MAX_CHURCHES = 4;
/** Max workshop meshes — crafting stations scattered through settlements. */
const MAX_WORKSHOPS = 3;
/** Max shrine meshes — cultural landmarks placed by artful communities. */
const MAX_SHRINES = 3;
/** Max barn meshes — working farm buildings scattered across the land. */
const MAX_BARNS    = 2;
/** Max coop meshes — small chicken shelters near settled areas. */
const MAX_COOPS    = 3;
/** Minimum tile distance between buildings of the same concept-combo type. */
const MIN_PROXIMITY = 5;

function tileHash(tx, tz) {
  return (tx * 31 + tz * 17) >>> 0;
}

export class BuildingRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    /** @type {Map<string, { kind: string, group: THREE.Group }>} */
    this._buildings = new Map();
  }

  /** Check if a building of the given kind already exists within `radius` tiles of (tx,tz). */
  _hasNearby(kind, tx, tz, radius = MIN_PROXIMITY) {
    for (const [key, entry] of this._buildings) {
      if (entry.kind !== kind) continue;
      const [bx, bz] = key.split(',').map(Number);
      if (Math.abs(bx - tx) + Math.abs(bz - tz) < radius) return true;
    }
    return false;
  }

  /**
   * Scan sleeping agents and place / upgrade buildings on their tile.
   * Priority: temple > church > workshop > shrine > tree_house > housing > hut.
   */
  checkAgents(agents) {
    /** @type {Map<string, { rank: number, kind: string, tileType: string }>} */
    const best = new Map();

    for (const agent of agents) {
      if (agent.health <= 0 || agent.state !== 'sleeping') continue;
      if (!agent.knowledge.has('shelter')) continue;

      const tx = Math.floor(agent.x);
      const tz = Math.floor(agent.z);
      const tile = this.world.getTile(tx, tz);
      if (!tile || tile.type === TileType.WATER || tile.type === TileType.DEEP_WATER || tile.type === TileType.MOUNTAIN) continue;

      const key = `${tx},${tz}`;
      const h = tileHash(tx, tz);

      let rank = 0;
      let kind = '';

      if (agent.knowledge.has('temple') && agent.knowledge.has('housing')) {
        rank = RANK.temple;
        kind = 'temple';
      } else if (agent.knowledge.has('church') && agent.knowledge.has('housing')) {
        rank = RANK.church;
        kind = 'church';
      } else if (agent.knowledge.has('stone_tools') && agent.knowledge.has('weaving') && !this._hasNearby('workshop', tx, tz)) {
        rank = RANK.workshop;
        kind = 'workshop';
      } else if (agent.knowledge.has('art') && agent.knowledge.has('community') && !this._hasNearby('shrine', tx, tz)) {
        rank = RANK.shrine;
        kind = 'shrine';
      } else if (
        tile.type === TileType.FOREST &&
        agent.knowledge.has('tree_house')
      ) {
        rank = RANK.tree_house;
        kind = 'tree_house';
      } else if (agent.knowledge.has('barn') && agent.knowledge.has('housing')) {
        rank = RANK.barn;
        kind = 'barn';
      } else if (agent.knowledge.has('coop') && agent.knowledge.has('housing')) {
        rank = RANK.coop;
        kind = 'coop';
      } else if (agent.knowledge.has('housing')) {
        rank = RANK.housing;
        kind = `house_${h % 4}`;
      } else {
        rank = RANK.shelter;
        kind = `hut_${h % 2}`;
      }

      const prev = best.get(key);
      if (!prev || rank > prev.rank) {
        best.set(key, { rank, kind, tileType: tile.type });
      }
    }

    // Cap temple visuals: only MAX_TEMPLES tiles keep a temple; rest fall back to house
    const templeKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'temple')
      .map(([k]) => k)
      .sort();
    if (templeKeys.length > MAX_TEMPLES) {
      for (const key of templeKeys.slice(MAX_TEMPLES)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, { rank: RANK.housing, kind: `house_${h % 4}`, tileType });
      }
    }

    // Cap church visuals: only MAX_CHURCHES tiles keep ⛪; rest fall back to house
    const churchKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'church')
      .map(([k]) => k)
      .sort();
    if (churchKeys.length > MAX_CHURCHES) {
      for (const key of churchKeys.slice(MAX_CHURCHES)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, {
          rank: RANK.housing,
          kind: `house_${h % 4}`,
          tileType,
        });
      }
    }

    // Cap workshop visuals
    const workshopKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'workshop')
      .map(([k]) => k)
      .sort();
    if (workshopKeys.length > MAX_WORKSHOPS) {
      for (const key of workshopKeys.slice(MAX_WORKSHOPS)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, { rank: RANK.housing, kind: `house_${h % 4}`, tileType });
      }
    }

    // Cap shrine visuals
    const shrineKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'shrine')
      .map(([k]) => k)
      .sort();
    if (shrineKeys.length > MAX_SHRINES) {
      for (const key of shrineKeys.slice(MAX_SHRINES)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, { rank: RANK.housing, kind: `house_${h % 4}`, tileType });
      }
    }

    // Cap barn visuals
    const barnKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'barn')
      .map(([k]) => k)
      .sort();
    if (barnKeys.length > MAX_BARNS) {
      for (const key of barnKeys.slice(MAX_BARNS)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, { rank: RANK.housing, kind: `house_${h % 4}`, tileType });
      }
    }

    // Cap coop visuals
    const coopKeys = [...best.entries()]
      .filter(([, v]) => v.kind === 'coop')
      .map(([k]) => k)
      .sort();
    if (coopKeys.length > MAX_COOPS) {
      for (const key of coopKeys.slice(MAX_COOPS)) {
        const [tx, tz] = key.split(',').map(Number);
        const h = tileHash(tx, tz);
        const tileType = best.get(key).tileType;
        best.set(key, { rank: RANK.housing, kind: `house_${h % 4}`, tileType });
      }
    }

    for (const [key, { kind, tileType }] of best) {
      const existing = this._buildings.get(key);
      if (existing && existing.kind === kind) continue;
      const [tx, tz] = key.split(',').map(Number);
      this._place(key, tx, tz, kind, tileType);
    }
  }

  _place(key, tx, tz, kind, tileType) {
    const existing = this._buildings.get(key);
    if (existing) {
      this.scene.remove(existing.group);
      existing.group.traverse(obj => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
    }
    const surfY = TerrainRenderer.surfaceY(tileType);
    let group;

    if (kind === 'church') group = this._makeChurch(tx, tz, surfY);
    else if (kind === 'temple') group = this._makeTemple(tx, tz, surfY);
    else if (kind === 'workshop') group = this._makeWorkshop(tx, tz, surfY);
    else if (kind === 'shrine') group = this._makeShrine(tx, tz, surfY);
    else if (kind === 'tree_house') group = this._makeTreeHouse(tx, tz, surfY);
    else if (kind === 'barn') group = this._makeBarn(tx, tz, surfY);
    else if (kind === 'coop') group = this._makeCoop(tx, tz, surfY);
    else if (kind.startsWith('house_')) group = this._makeHouseVariant(tx, tz, surfY, Number(kind.slice(6)));
    else group = this._makeHutVariant(tx, tz, surfY, Number(kind.slice(4)) || 0);

    this.scene.add(group);
    this._buildings.set(key, { kind, group });
  }

  _makeHutVariant(tx, tz, surfY, variant) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    const wallMat = new THREE.MeshLambertMaterial({ color: variant === 0 ? 0xc4a46e : 0xb89a6e });
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.42, 0.85),
      wallMat
    );
    walls.position.set(cx, surfY + 0.21, cz);
    walls.castShadow = true;
    const roofMat = new THREE.MeshLambertMaterial({ color: variant === 0 ? 0x8a6030 : 0x6b4a28 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.68, 0.38, 4), roofMat);
    roof.position.set(cx, surfY + 0.42 + 0.19, cz);
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(walls, roof);
    return group;
  }

  _makeHouseVariant(tx, tz, surfY, v) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();

    if (v === 0) {
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x9a8878 });
      const walls = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.6, 1.05), wallMat);
      walls.position.set(cx, surfY + 0.3, cz);
      walls.castShadow = true;
      const doorMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.06), doorMat);
      door.position.set(cx, surfY + 0.15, cz + 0.53);
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x9b3a28 });
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.84, 0.5, 4), roofMat);
      roof.position.set(cx, surfY + 0.85, cz);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(walls, door, roof);
    } else if (v === 1) {
      const wood = new THREE.MeshLambertMaterial({ color: 0x6b4c32 });
      const walls = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.9), wood);
      walls.position.set(cx, surfY + 0.275, cz);
      walls.castShadow = true;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.78, 0.45, 4),
        new THREE.MeshLambertMaterial({ color: 0x4a3520 })
      );
      roof.position.set(cx, surfY + 0.8, cz);
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      group.add(walls, roof);
    } else if (v === 2) {
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a7a68 });
      const walls = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.75), wallMat);
      walls.position.set(cx, surfY + 0.25, cz);
      walls.castShadow = true;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(1.25, 0.12, 0.82),
        new THREE.MeshLambertMaterial({ color: 0x7a2820 })
      );
      roof.position.set(cx, surfY + 0.56, cz);
      roof.castShadow = true;
      group.add(walls, roof);
    } else {
      const walls = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.65, 0.9),
        new THREE.MeshLambertMaterial({ color: 0xa89888 })
      );
      walls.position.set(cx, surfY + 0.325, cz);
      walls.castShadow = true;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.08, 0.95),
        new THREE.MeshLambertMaterial({ color: 0x5c4a3a })
      );
      roof.position.set(cx, surfY + 0.69, cz);
      roof.castShadow = true;
      group.add(walls, roof);
    }
    return group;
  }

  _makeTreeHouse(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    const legMat = new THREE.MeshLambertMaterial({ color: 0x4a3520 });
    const h = 0.85;
    for (const [dx, dz] of [
      [-0.35, -0.35],
      [0.35, -0.35],
      [-0.35, 0.35],
      [0.35, 0.35],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, h, 6), legMat);
      leg.position.set(cx + dx, surfY + h / 2, cz + dz);
      leg.castShadow = true;
      group.add(leg);
    }
    const deckY = surfY + h;
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.08, 0.95),
      new THREE.MeshLambertMaterial({ color: 0x7a5a3a })
    );
    deck.position.set(cx, deckY, cz);
    deck.castShadow = true;
    group.add(deck);
    const hutWalls = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.35, 0.55),
      new THREE.MeshLambertMaterial({ color: 0xc4a46e })
    );
    hutWalls.position.set(cx, deckY + 0.04 + 0.175, cz);
    hutWalls.castShadow = true;
    const hutRoof = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 0.28, 4),
      new THREE.MeshLambertMaterial({ color: 0x2d5a2d })
    );
    hutRoof.position.set(cx, deckY + 0.04 + 0.35 + 0.14, cz);
    hutRoof.rotation.y = Math.PI / 4;
    hutRoof.castShadow = true;
    group.add(hutWalls, hutRoof);
    const ladder = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, h * 0.92, 0.04),
      new THREE.MeshLambertMaterial({ color: 0x5a4030 })
    );
    ladder.position.set(cx + 0.52, surfY + h * 0.46, cz);
    group.add(ladder);
    return group;
  }

  _makeTemple(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ color: 0xc8c0b0 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.15, 0.95), stone);
    base.position.set(cx, surfY + 0.075, cz);
    base.castShadow = true;
    group.add(base);
    const colMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d8 });
    const colPositions = [
      [-0.4, -0.28],
      [0.4, -0.28],
      [-0.4, 0.28],
      [0.4, 0.28],
    ];
    for (const [dx, dz] of colPositions) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, 8), colMat);
      col.position.set(cx + dx, surfY + 0.15 + 0.25, cz + dz);
      col.castShadow = true;
      group.add(col);
    }
    const pediment = new THREE.Mesh(
      new THREE.ConeGeometry(0.65, 0.35, 3),
      new THREE.MeshLambertMaterial({ color: 0xb8a898 })
    );
    pediment.position.set(cx, surfY + 0.15 + 0.5 + 0.12, cz - 0.15);
    pediment.rotation.z = Math.PI / 2;
    pediment.rotation.y = Math.PI;
    pediment.castShadow = true;
    group.add(pediment);
    return group;
  }

  _makeChurch(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    const wall = new THREE.MeshLambertMaterial({ color: 0xa8a098 });
    const nave = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 1.0), wall);
    nave.position.set(cx, surfY + 0.275, cz);
    nave.castShadow = true;
    group.add(nave);
    const steeple = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.55, 4),
      new THREE.MeshLambertMaterial({ color: 0x5a5048 })
    );
    steeple.position.set(cx, surfY + 0.55 + 0.275, cz + 0.35);
    steeple.castShadow = true;
    group.add(steeple);
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.18, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x2a2a28 })
    );
    crossV.position.set(cx, surfY + 0.55 + 0.55 + 0.12, cz + 0.35);
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.05, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x2a2a28 })
    );
    crossH.position.set(cx, surfY + 0.55 + 0.5 + 0.12, cz + 0.35);
    group.add(crossV, crossH);
    return group;
  }

  /** Workshop — open-sided structure with workbench and anvil, built by agents with stone_tools + weaving. */
  _makeWorkshop(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();

    // Foundation slab
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x7a6a58 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.85), baseMat);
    base.position.set(cx, surfY + 0.03, cz);
    group.add(base);

    // Four corner posts
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
    for (const [dx, dz] of [[-0.38, -0.30], [0.38, -0.30], [-0.38, 0.30], [0.38, 0.30]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.55, 6), postMat);
      post.position.set(cx + dx, surfY + 0.06 + 0.275, cz + dz);
      post.castShadow = true;
      group.add(post);
    }

    // Lean-to roof
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a6030 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.78), roofMat);
    roof.position.set(cx, surfY + 0.06 + 0.55 + 0.03, cz);
    roof.rotation.x = 0.15;
    roof.castShadow = true;
    group.add(roof);

    // Workbench
    const benchMat = new THREE.MeshLambertMaterial({ color: 0x9a7a50 });
    const bench = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.08, 0.25), benchMat);
    bench.position.set(cx - 0.1, surfY + 0.06 + 0.28, cz);
    group.add(bench);

    // Anvil shape (small dark block)
    const anvilMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.08), anvilMat);
    anvil.position.set(cx + 0.28, surfY + 0.06 + 0.05, cz + 0.05);
    group.add(anvil);

    return group;
  }

  /** Shrine — a small stone pedestal with a decorative totem, built by agents with art + community. */
  _makeShrine(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();

    // Circular stone base
    const baseMat = new THREE.MeshLambertMaterial({ color: 0xb0a898 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.45, 0.10, 8), baseMat);
    base.position.set(cx, surfY + 0.05, cz);
    base.castShadow = true;
    group.add(base);

    // Stone pedestal
    const pedMat = new THREE.MeshLambertMaterial({ color: 0xc8c0b0 });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.30, 6), pedMat);
    pedestal.position.set(cx, surfY + 0.10 + 0.15, cz);
    pedestal.castShadow = true;
    group.add(pedestal);

    // Totem / idol on top — colourful to reflect 'art'
    const totemMat = new THREE.MeshLambertMaterial({ color: 0xd4583a });
    const totem = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.25, 5), totemMat);
    totem.position.set(cx, surfY + 0.10 + 0.30 + 0.125, cz);
    totem.castShadow = true;
    group.add(totem);

    // Small offering stones around the base
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a8078 });
    for (const [dx, dz] of [[0.28, 0.12], [-0.25, 0.18], [0.10, -0.30]]) {
      const stone = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 3), stoneMat);
      stone.position.set(cx + dx, surfY + 0.03, cz + dz);
      group.add(stone);
    }

    return group;
  }

  _makeBarn(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    // Foundation slab
    const foundMat = new THREE.MeshLambertMaterial({ color: 0x8a7860 });
    const found = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.06, 0.88), foundMat);
    found.position.set(cx, surfY + 0.03, cz);
    group.add(found);
    // Walls — classic barn red
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x9b2820 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.48, 0.68), wallMat);
    walls.position.set(cx, surfY + 0.06 + 0.24, cz);
    walls.castShadow = true;
    group.add(walls);
    // Hip roof — elongated 4-sided cone
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a1808 });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.58, 0.40, 4), roofMat);
    roof.position.set(cx, surfY + 0.06 + 0.48 + 0.20, cz);
    roof.scale.set(1.15, 1, 0.88);
    roof.castShadow = true;
    group.add(roof);
    // Large front doors (two planks)
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x2a1008 });
    const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, 0.06), doorMat);
    doorL.position.set(cx - 0.065, surfY + 0.06 + 0.15, cz + 0.34 + 0.01);
    const doorR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, 0.06), doorMat);
    doorR.position.set(cx + 0.065, surfY + 0.06 + 0.15, cz + 0.34 + 0.01);
    group.add(doorL, doorR);
    // Hay bale beside the barn
    const hayMat = new THREE.MeshLambertMaterial({ color: 0xd4b450 });
    const hay = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.15), hayMat);
    hay.position.set(cx + 0.54, surfY + 0.06 + 0.08, cz - 0.18);
    group.add(hay);
    return group;
  }

  _makeCoop(tx, tz, surfY) {
    const cx = tx * TILE_SIZE + TILE_SIZE / 2;
    const cz = tz * TILE_SIZE + TILE_SIZE / 2;
    const group = new THREE.Group();
    // Base
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x9a8870 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.05, 0.54), baseMat);
    base.position.set(cx, surfY + 0.025, cz);
    group.add(base);
    // Walls — pale wood
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xc8a870 });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.28, 0.38), wallMat);
    walls.position.set(cx, surfY + 0.05 + 0.14, cz);
    walls.castShadow = true;
    group.add(walls);
    // Shed roof — slightly slanted flat panel
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x6a4028 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.06, 0.48), roofMat);
    roof.position.set(cx, surfY + 0.05 + 0.28 + 0.04, cz);
    roof.rotation.x = 0.12;
    roof.castShadow = true;
    group.add(roof);
    // Small chicken door
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x3a2010 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.06), doorMat);
    door.position.set(cx, surfY + 0.05 + 0.06, cz + 0.19 + 0.02);
    group.add(door);
    // Small fenced run — four thin posts and a rail
    const postMat = new THREE.MeshLambertMaterial({ color: 0x8a6840 });
    const postGeom = new THREE.CylinderGeometry(0.014, 0.012, 0.22, 4);
    const railGeom = new THREE.BoxGeometry(0.38, 0.02, 0.02);
    for (const [px2, pz2] of [[-0.18, 0.32], [0.18, 0.32], [-0.18, 0.52], [0.18, 0.52]]) {
      const post = new THREE.Mesh(postGeom, postMat);
      post.position.set(cx + px2, surfY + 0.05 + 0.11, cz + pz2);
      group.add(post);
    }
    const rail = new THREE.Mesh(railGeom, postMat);
    rail.position.set(cx, surfY + 0.05 + 0.20, cz + 0.42);
    group.add(rail);
    return group;
  }

  dispose() {
    for (const { group } of this._buildings.values()) {
      this.scene.remove(group);
      group.traverse(obj => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
    }
    this._buildings.clear();
  }
}

