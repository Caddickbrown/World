import * as THREE from 'three';
import { TileType, TILE_SIZE } from '../simulation/World.js';

// Visual height of each tile type (the box's Y scale)
const TILE_HEIGHT = {
  [TileType.DEEP_WATER]: 0.02,
  [TileType.WATER]:    0.05,
  [TileType.BEACH]:    0.10,
  [TileType.GRASS]:    0.14,
  [TileType.WOODLAND]: 0.17,
  [TileType.DESERT]:   0.12,
  [TileType.FOREST]:   0.24,
  [TileType.STONE]:    0.34,
  [TileType.MOUNTAIN]: 1.50,
};

// Base colours per tile type (HSL for easy variation)
const TILE_COLOR_HSL = {
  [TileType.DEEP_WATER]: [215, 80, 30],
  [TileType.WATER]:    [208, 82, 55],
  [TileType.BEACH]:    [ 42, 60, 72],
  [TileType.GRASS]:    [ 94, 62, 50],
  [TileType.WOODLAND]: [110, 52, 38],
  [TileType.DESERT]:   [ 38, 55, 62],
  [TileType.FOREST]:   [132, 66, 30],
  [TileType.STONE]:    [ 28, 22, 62],
  [TileType.MOUNTAIN]: [215, 18, 68],
};

const GAP = 0.0; // gap between tiles

export class TerrainRenderer {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this._meshes = []; // tracked for dispose()
    this._animatedAnimals = []; // { mesh, instances: [{baseX,baseY,baseZ,scale,rotY,seed}], config }
    this._animTime = 0;
    this._build();
  }

  /**
   * Returns the Y world-coordinate of the top surface of a tile of the given type.
   * Used by fauna and flora renderers to place meshes at the correct height.
   */
  static surfaceY(tileType) {
    return TILE_HEIGHT[tileType] ?? 0.14;
  }

  /** Remove all terrain meshes and free GPU memory */
  dispose() {
    for (const mesh of this._meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._meshes = [];
    this._animatedAnimals = [];
  }

  _build() {
    // Group tiles by type for instanced rendering
    const buckets = {
      [TileType.DEEP_WATER]: [],
      [TileType.WATER]:    [],
      [TileType.BEACH]:    [],
      [TileType.GRASS]:    [],
      [TileType.WOODLAND]: [],
      [TileType.DESERT]:   [],
      [TileType.FOREST]:   [],
      [TileType.STONE]:    [],
      [TileType.MOUNTAIN]: [],
    };

    for (let z = 0; z < this.world.height; z++) {
      for (let x = 0; x < this.world.width; x++) {
        const tile = this.world.tiles[z][x];
        if (buckets[tile.type]) buckets[tile.type].push(tile);
      }
    }

    for (const [type, tiles] of Object.entries(buckets)) {
      if (tiles.length === 0) continue;

      const baseH = TILE_HEIGHT[type];
      const [h, s, l] = TILE_COLOR_HSL[type];
      const isMountain = type === TileType.MOUNTAIN;

      // Mountains use tapered cones for a peak shape; other tiles use boxes
      const geom = isMountain
        ? new THREE.ConeGeometry(0.92, 1.5, 8)
        : new THREE.BoxGeometry(TILE_SIZE - GAP, 1, TILE_SIZE - GAP);
      const mat  = new THREE.MeshLambertMaterial();
      const mesh = new THREE.InstancedMesh(geom, mat, tiles.length);
      mesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();

      tiles.forEach((tile, i) => {
        const hVariation = baseH + tile.elevation * 0.08;
        const lVariation = l + (Math.sin(tile.x * 3.1 + tile.z * 2.7) * 0.5 + 0.5) * 6 - 3;

        if (isMountain) {
          // Cone: base at y=0, tip at y=height; geom is centered, so position at half-height
          const widthVar = 0.85 + this._rng(tile.x, tile.z, 14) * 0.25;
          const tiltX = (this._rng(tile.x, tile.z, 15) - 0.5) * 0.12;
          const tiltZ = (this._rng(tile.x, tile.z, 16) - 0.5) * 0.12;
          dummy.position.set(
            tile.x * TILE_SIZE + TILE_SIZE / 2 + (this._rng(tile.x, tile.z, 17) - 0.5) * 0.15,
            hVariation / 2,
            tile.z * TILE_SIZE + TILE_SIZE / 2 + (this._rng(tile.x, tile.z, 18) - 0.5) * 0.15,
          );
          dummy.scale.set(widthVar, hVariation / 1.5, widthVar);
          dummy.rotation.set(tiltX, this._rng(tile.x, tile.z, 19) * 0.08, tiltZ);
          dummy.updateMatrix();
        } else {
          dummy.position.set(
            tile.x * TILE_SIZE + TILE_SIZE / 2,
            hVariation / 2,
            tile.z * TILE_SIZE + TILE_SIZE / 2,
          );
          dummy.scale.set(1, hVariation, 1);
          dummy.updateMatrix();
        }
        mesh.setMatrixAt(i, dummy.matrix);

        color.setHSL(h / 360, s / 100, Math.max(0.05, Math.min(0.95, lVariation / 100)));
        mesh.setColorAt(i, color);
      });

      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this._meshes.push(mesh);
    }

    this._buildVegetation(buckets);
    this._buildAnimals(buckets);
  }

  // Deterministic per-tile pseudo-random (no Math.random — stable across redraws)
  _rng(x, z, offset = 0) {
    return Math.sin(x * 127.1 + z * 311.7 + offset * 74.5) * 0.5 + 0.5;
  }

  // Smooth spatially-correlated noise for forest biome regions (~48-tile wavelength).
  // Returns a value in approximately [-1, 1].
  _forestBiomeNoise(x, z) {
    const s = this.world.seed * 0.137;
    return (
      Math.sin(x * 0.13 + s * 1.7)  * Math.cos(z * 0.11 + s * 0.83) * 0.60 +
      Math.cos(x * 0.20 + z * 0.16  + s * 2.3)                       * 0.40
    );
  }

  // ── Plant system helpers ────────────────────────────────────────────────

  /** Expand tiles → [{tile, sub}] placements. Each tile gets 1, 2, or 3 entries. */
  _expandPlacements(tiles, seed = 50, weights = [0.45, 0.80]) {
    const out = [];
    for (const tile of tiles) {
      const r = this._rng(tile.x, tile.z, seed);
      const count = r < weights[0] ? 1 : r < weights[1] ? 2 : 3;
      for (let sub = 0; sub < count; sub++) out.push({ tile, sub });
    }
    return out;
  }

  /** Create an InstancedMesh, register it, and return it. */
  _makeInstanced(geom, mat, count, castShadow = true, receiveShadow = true) {
    const mesh = new THREE.InstancedMesh(geom, mat, count);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    this.scene.add(mesh);
    this._meshes.push(mesh);
    return mesh;
  }

  /** Apply a transform function to every placement and upload all matrices. */
  _applyTransforms(placements, mesh, dummy, fn) {
    placements.forEach(({ tile, sub }, i) => {
      const rng = s => this._rng(tile.x, tile.z, s + sub * 13);
      const { pos, scale, rot = [0, 0, 0] } = fn({ tile, sub }, rng);
      dummy.position.set(...pos);
      dummy.scale.set(...scale);
      dummy.rotation.set(...rot);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ────────────────────────────────────────────────────────────────────────

  _buildVegetation(buckets) {
    const dummy = new THREE.Object3D();
    this._plantUpdaters = []; // { mesh, placements, updateFn } — driven by updateVegetation

    // ── Berry bushes on GRASS ─────────────────────────────────────────────
    {
      const SURF      = TerrainRenderer.surfaceY(TileType.GRASS);
      const bushTiles = buckets[TileType.GRASS].filter(t => this._rng(t.x, t.z) < 0.55);
      if (bushTiles.length > 0) {
        const placements = this._expandPlacements(bushTiles);
        const mesh = this._makeInstanced(
          new THREE.SphereGeometry(0.22, 6, 5),
          new THREE.MeshLambertMaterial({ color: 0x4ade80 }),
          placements.length,
        );
        this._applyTransforms(placements, mesh, dummy, ({ tile }, rng) => {
          const sz = 0.75 + rng(5) * 0.55;
          return {
            pos:   [tile.x * TILE_SIZE + TILE_SIZE/2 + (rng(1) - 0.5) * 2.8, SURF + 0.16 * sz, tile.z * TILE_SIZE + TILE_SIZE/2 + (rng(2) - 0.5) * 2.8],
            scale: [sz, 0.7 * sz, sz],
          };
        });
        const initC = new THREE.Color(0x4ade80);
        for (let i = 0; i < placements.length; i++) mesh.setColorAt(i, initC);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        const G = [0.29, 0.87, 0.50], B = [0.55, 0.45, 0.33];
        this._plantUpdaters.push({ mesh, placements, updateFn: ({ tile }, rng) => {
          const r  = tile.resource;
          const sz = 0.75 + rng(5) * 0.55;
          const sc = sz * (0.25 + r * 0.75);
          return {
            pos:   [tile.x * TILE_SIZE + TILE_SIZE/2 + (rng(1) - 0.5) * 2.8, SURF + 0.16 * sc, tile.z * TILE_SIZE + TILE_SIZE/2 + (rng(2) - 0.5) * 2.8],
            scale: [sc, 0.7 * sc, sc],
            color: [G[0]*r + B[0]*(1-r), G[1]*r + B[1]*(1-r), G[2]*r + B[2]*(1-r)],
          };
        }});
        this._grassFoodTiles = bushTiles;
      }
    }

    // ── Fruit berries on WOODLAND and FOREST bush tiles ───────────────────
    // ~30% of WOODLAND tiles get red berries; ~30% of FOREST get dark-blue berries.
    // Uses seeded RNG (offsets 200+) so placement is stable across redraws.
    {
      const addFruitBerries = (tileList, color, seedOffset, surfY) => {
        // Filter to ~30% of tiles with fruit, stable via RNG seed
        const fruitTiles = tileList.filter(t => this._rng(t.x, t.z, seedOffset) < 0.30);
        if (fruitTiles.length === 0) return;

        // Each tile gets 3-6 berry spheres; expand into individual berry placements
        const berryPlacements = [];
        for (const tile of fruitTiles) {
          const count = 3 + Math.floor(this._rng(tile.x, tile.z, seedOffset + 1) * 4); // 3–6
          for (let b = 0; b < count; b++) berryPlacements.push({ tile, b });
        }

        // Bush height estimate (matches bush radius ~0.22 at surface)
        const bushTopY = surfY + 0.22;

        const berryMesh = this._makeInstanced(
          new THREE.SphereGeometry(0.05, 5, 5),
          new THREE.MeshLambertMaterial({ color }),
          berryPlacements.length,
        );

        berryPlacements.forEach(({ tile, b }, i) => {
          // Stable position for this berry using per-berry seed offsets
          const s = seedOffset + 10 + b * 7;
          // Cluster within ±0.18 of bush centre, near the top
          const ox = (this._rng(tile.x, tile.z, s)     - 0.5) * 0.36;
          const oz = (this._rng(tile.x, tile.z, s + 1) - 0.5) * 0.36;
          const oy = this._rng(tile.x, tile.z, s + 2) * 0.12; // 0..0.12 above bush top

          // Bush offset within tile (matches GRASS bush placement spread)
          const bx = (this._rng(tile.x, tile.z, 201) - 0.5) * 1.4;
          const bz = (this._rng(tile.x, tile.z, 202) - 0.5) * 1.4;

          dummy.position.set(
            tile.x * TILE_SIZE + TILE_SIZE / 2 + bx + ox,
            bushTopY + oy,
            tile.z * TILE_SIZE + TILE_SIZE / 2 + bz + oz,
          );
          dummy.scale.setScalar(1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          berryMesh.setMatrixAt(i, dummy.matrix);
        });
        berryMesh.instanceMatrix.needsUpdate = true;
      };

      // Red berries on WOODLAND
      addFruitBerries(
        buckets[TileType.WOODLAND] ?? [],
        0xcc2200,
        200,
        TerrainRenderer.surfaceY(TileType.WOODLAND),
      );

      // Dark-blue berries on FOREST
      addFruitBerries(
        buckets[TileType.FOREST] ?? [],
        0x330066,
        210,
        TerrainRenderer.surfaceY(TileType.FOREST),
      );
    }

    // ── Trees on FOREST tiles ─────────────────────────────────────────────
    {
      const SURF        = TerrainRenderer.surfaceY(TileType.FOREST);
      const forestTiles = buckets[TileType.FOREST].filter(t => this._rng(t.x, t.z) < 0.82);
      if (forestTiles.length > 0) {
        const deadTiles   = forestTiles.filter(t => this._rng(t.x, t.z, 41) < 0.04);
        const livingTiles = forestTiles.filter(t => this._rng(t.x, t.z, 41) >= 0.04);

        // Sort living tiles into 6 biome-clustered types
        const typeBuckets = { pine: [], spruce: [], oak: [], birch: [], cherry: [], maple: [] };
        for (const t of livingTiles) {
          const sel = Math.max(0, Math.min(1,
            0.80 * (this._forestBiomeNoise(t.x, t.z) + 1) * 0.5 + 0.20 * this._rng(t.x, t.z, 40)));
          const key = sel < 0.17 ? 'pine' : sel < 0.34 ? 'spruce' : sel < 0.50 ? 'oak'
                    : sel < 0.67 ? 'birch' : sel < 0.83 ? 'cherry' : 'maple';
          typeBuckets[key].push(t);
        }

        // Data-driven tree type definitions
        // scaleMin/scaleRange: per-tree-type overall scale variation (seeded, stable)
        const TREE_TYPES = [
          { tiles: typeBuckets.pine,
            scaleMin: 0.75, scaleRange: 0.55,
            trunk: { color: 0x5c3d1a, radT: 0.055, radB: 0.095, h0: 0.90, hVar: 0.50, hScale: 1.0,  topFrac: 1.0  },
            fol:   { geom: new THREE.ConeGeometry(0.38, 0.65, 7),   color: 0x2d9e52, h0: 0.85, hVar: 0.40, sx0: 0.75, sxVar: 0.35, centerFrac: 0.45, roundCrown: false },
            lush: [0.08, 0.50, 0.24], sparse: [0.30, 0.40, 0.20] },
          { tiles: typeBuckets.spruce,
            scaleMin: 0.80, scaleRange: 0.40,
            trunk: { color: 0x3d2810, radT: 0.050, radB: 0.088, h0: 1.05, hVar: 0.50, hScale: 1.0,  topFrac: 1.0  },
            fol:   { geom: new THREE.ConeGeometry(0.32, 0.80, 8),   color: 0x1e7a3d, h0: 0.90, hVar: 0.45, sx0: 0.62, sxVar: 0.28, centerFrac: 0.50, roundCrown: false },
            lush: [0.08, 0.50, 0.24], sparse: [0.30, 0.40, 0.20] },
          { tiles: typeBuckets.oak,
            scaleMin: 0.70, scaleRange: 0.70,
            trunk: { color: 0x78350f, radT: 0.075, radB: 0.12,  h0: 0.65, hVar: 0.45, hScale: 0.85, topFrac: 0.75 },
            fol:   { geom: new THREE.SphereGeometry(0.38, 7, 5), color: 0x228b45, h0: 0.65, hVar: 0.45, sx0: 0.85, sxVar: 0.70, centerFrac: 0.36, roundCrown: true  },
            lush: [0.08, 0.50, 0.24], sparse: [0.30, 0.40, 0.20] },
          { tiles: typeBuckets.birch,
            scaleMin: 0.60, scaleRange: 0.70,
            trunk: { color: 0xc8c0b0, radT: 0.038, radB: 0.060, h0: 0.78, hVar: 0.40, hScale: 0.88, topFrac: 0.70 },
            fol:   { geom: new THREE.SphereGeometry(0.30, 6, 5), color: 0x8ab548, h0: 0.52, hVar: 0.38, sx0: 0.68, sxVar: 0.52, centerFrac: 0.33, roundCrown: true  },
            lush: [0.08, 0.50, 0.24], sparse: [0.30, 0.40, 0.20] },
          { tiles: typeBuckets.cherry,
            scaleMin: 0.60, scaleRange: 0.70,
            trunk: { color: 0x9c7b6e, radT: 0.050, radB: 0.080, h0: 0.70, hVar: 0.40, hScale: 0.90, topFrac: 0.78 },
            fol:   { geom: new THREE.SphereGeometry(0.40, 7, 5), color: 0xf9a8d4, h0: 0.60, hVar: 0.50, sx0: 0.90, sxVar: 0.65, centerFrac: 0.38, roundCrown: true  },
            lush: [0.98, 0.66, 0.83], sparse: [0.90, 0.80, 0.85] },
          { tiles: typeBuckets.maple,
            scaleMin: 0.60, scaleRange: 0.70,
            trunk: { color: 0x6b3d12, radT: 0.080, radB: 0.125, h0: 0.70, hVar: 0.45, hScale: 0.85, topFrac: 0.75 },
            fol:   { geom: new THREE.SphereGeometry(0.44, 7, 5), color: 0xdc6b2f, h0: 0.70, hVar: 0.45, sx0: 0.95, sxVar: 0.65, centerFrac: 0.38, roundCrown: true  },
            lush: [0.86, 0.42, 0.18], sparse: [0.55, 0.38, 0.22] },
        ];

        for (const { tiles, trunk, fol, lush, sparse, scaleMin, scaleRange } of TREE_TYPES) {
          if (tiles.length === 0) continue;
          const placements = this._expandPlacements(tiles);

          // Trunk — static, no resource update; per-tree scale and colour variation
          const trunkMesh = this._makeInstanced(new THREE.CylinderGeometry(trunk.radT, trunk.radB, 0.42, 5),
            new THREE.MeshLambertMaterial({ color: trunk.color }), placements.length);
          this._applyTransforms(placements, trunkMesh,
            dummy, ({ tile }, rng) => {
              const sz = scaleMin + rng(36) * scaleRange, tH = trunk.h0 + rng(30) * trunk.hVar, tW = 0.75 + rng(31) * 0.5;
              return {
                pos:   [tile.x * TILE_SIZE + TILE_SIZE/2 + (rng(3) - 0.5) * 2.8, SURF + 0.21 * tH * trunk.hScale * sz, tile.z * TILE_SIZE + TILE_SIZE/2 + (rng(4) - 0.5) * 2.8],
                scale: [tW * sz, tH * trunk.hScale * sz, tW * sz],
                rot:   [0, rng(32) * Math.PI * 2, 0],
              };
            });
          // Per-tree trunk colour: vary brightness ±10% using seeded rng
          {
            const baseC = new THREE.Color(trunk.color);
            const trunkC = new THREE.Color();
            placements.forEach(({ tile, sub }, i) => {
              const rng = s => this._rng(tile.x, tile.z, s + sub * 13);
              const bv = 0.90 + rng(38) * 0.20; // 0.90–1.10 brightness multiplier
              trunkC.setRGB(
                Math.min(1, baseC.r * bv),
                Math.min(1, baseC.g * bv),
                Math.min(1, baseC.b * bv),
              );
              trunkMesh.setColorAt(i, trunkC);
            });
            if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
          }

          // Foliage — resource-driven color + height
          const fMesh = this._makeInstanced(fol.geom, new THREE.MeshLambertMaterial({ color: fol.color }), placements.length);
          const initC = new THREE.Color(fol.color);
          for (let i = 0; i < placements.length; i++) fMesh.setColorAt(i, initC);
          if (fMesh.instanceColor) fMesh.instanceColor.needsUpdate = true;

          const foliageXform = ({ tile }, rng, resource) => {
            const sz   = scaleMin + rng(36) * scaleRange;
            const tH   = trunk.h0 + rng(30) * trunk.hVar;
            const tTop = SURF + 0.42 * tH * trunk.hScale * trunk.topFrac * sz;
            const rsc  = 0.5 + resource * 0.5;
            const fH   = (fol.h0 + rng(35) * fol.hVar) * rsc * sz;
            const fSx  = (fol.sx0 + rng(33) * fol.sxVar) * sz;
            const fSz  = fol.roundCrown ? (fol.sx0 + rng(34) * fol.sxVar) * sz : fSx;
            return {
              pos:   [tile.x * TILE_SIZE + TILE_SIZE/2 + (rng(3) - 0.5) * 2.8, tTop + fol.centerFrac * fH, tile.z * TILE_SIZE + TILE_SIZE/2 + (rng(4) - 0.5) * 2.8],
              scale: [fSx, fH, fSz],
              rot:   [0, rng(32) * Math.PI * 2, 0],
            };
          };
          this._applyTransforms(placements, fMesh, dummy, (p, rng) => foliageXform(p, rng, 1));
          this._plantUpdaters.push({ mesh: fMesh, placements, updateFn: ({ tile }, rng) => {
            const r = tile.resource;
            return { ...foliageXform({ tile }, rng, r),
              color: [lush[0]*r + sparse[0]*(1-r), lush[1]*r + sparse[1]*(1-r), lush[2]*r + sparse[2]*(1-r)] };
          }});
        }

        // Dead trees — static single trunk, no foliage
        if (deadTiles.length > 0) {
          this._applyTransforms(
            deadTiles.map(tile => ({ tile, sub: 0 })),
            this._makeInstanced(new THREE.CylinderGeometry(0.04, 0.08, 0.38, 4),
              new THREE.MeshLambertMaterial({ color: 0x4a3520 }), deadTiles.length),
            dummy, ({ tile }, rng) => {
              const sz = 0.60 + rng(36) * 0.70;
              return {
                pos:   [tile.x * TILE_SIZE + TILE_SIZE/2 + (rng(3) - 0.5) * 2.2, SURF + 0.19 * (0.55 + rng(30) * 0.55) * sz, tile.z * TILE_SIZE + TILE_SIZE/2 + (rng(4) - 0.5) * 2.2],
                scale: [(0.6 + rng(31) * 0.5) * sz, (0.55 + rng(30) * 0.55) * sz, (0.6 + rng(31) * 0.5) * sz],
                rot:   [0, rng(32) * Math.PI * 2, 0],
              };
            });
        }
        this._forestFoodTiles = forestTiles;
      }
    }

    // ── Rocks on STONE tiles ──────────────────────────────────────────────
    const stoneTiles = buckets[TileType.STONE].filter(t => this._rng(t.x, t.z, 5) < 0.50);
    if (stoneTiles.length > 0) {
      const rockGeom = new THREE.DodecahedronGeometry(0.18, 0);
      const rockMat  = new THREE.MeshLambertMaterial({ color: 0x8a9aaa });
      const rockMesh = new THREE.InstancedMesh(rockGeom, rockMat, stoneTiles.length);
      const surfY = TerrainRenderer.surfaceY(TileType.STONE);

      stoneTiles.forEach((tile, i) => {
        const ox    = (this._rng(tile.x, tile.z, 6) - 0.5) * 2.2;
        const oz    = (this._rng(tile.x, tile.z, 7) - 0.5) * 2.2;
        const scale = 0.55 + this._rng(tile.x, tile.z, 8) * 0.9;
        dummy.position.set(
          tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
          surfY + 0.12,
          tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
        );
        dummy.scale.setScalar(scale);
        dummy.rotation.y = this._rng(tile.x, tile.z, 9) * Math.PI * 2;
        dummy.updateMatrix();
        rockMesh.setMatrixAt(i, dummy.matrix);
      });

      rockMesh.castShadow = true;
      rockMesh.receiveShadow = true;
      rockMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(rockMesh);
      this._meshes.push(rockMesh);
    }

    // ── Cacti on DESERT tiles (saguaro-style: trunk + elbow arms) ────────────
    const desertTiles = buckets[TileType.DESERT].filter(t => this._rng(t.x, t.z, 70) < 0.30);
    if (desertTiles.length > 0) {
      const cactusMat   = new THREE.MeshLambertMaterial({ color: 0x4a7c35 });
      const desertSurfY = TerrainRenderer.surfaceY(TileType.DESERT);
      // Two-segment arm: a short outward piece then a taller upward piece
      const ARM_OUT_TILT = Math.PI * 0.44; // ~79° from vertical — nearly horizontal
      const ARM_UP_TILT  = Math.PI * 0.05; // ~9° from vertical  — nearly straight up
      const ARM_OUT_LEN  = 0.18;
      const ARM_UP_LEN   = 0.26;

      // Expand desert tiles to placements first (1-2 cacti per tile)
      const cactPlacements = [];
      for (const tile of desertTiles) {
        const count = this._rng(tile.x, tile.z, 50) < 0.60 ? 1 : 2;
        for (let sub = 0; sub < count; sub++) cactPlacements.push({ tile, sub });
      }

      // Trunk sized to total placements
      const trunkGeom    = new THREE.CylinderGeometry(0.058, 0.095, 0.55, 7);
      const trunkMesh    = new THREE.InstancedMesh(trunkGeom, cactusMat, cactPlacements.length);

      // Arm subsets — each placement gets its own arm probability via sub-shifted seed
      const armLPlacements = cactPlacements.filter(p => this._rng(p.tile.x, p.tile.z, 74 + p.sub * 13) < 0.65);
      const armRPlacements = cactPlacements.filter(p => this._rng(p.tile.x, p.tile.z, 76 + p.sub * 13) < 0.55);
      const armOutGeom   = new THREE.CylinderGeometry(0.036, 0.046, ARM_OUT_LEN, 6);
      const armUpGeom    = new THREE.CylinderGeometry(0.030, 0.038, ARM_UP_LEN,  6);
      const armLOutMesh  = armLPlacements.length > 0 ? new THREE.InstancedMesh(armOutGeom, cactusMat, armLPlacements.length) : null;
      const armLUpMesh   = armLPlacements.length > 0 ? new THREE.InstancedMesh(armUpGeom,  cactusMat, armLPlacements.length) : null;
      const armROutMesh  = armRPlacements.length > 0 ? new THREE.InstancedMesh(armOutGeom, cactusMat, armRPlacements.length) : null;
      const armRUpMesh   = armRPlacements.length > 0 ? new THREE.InstancedMesh(armUpGeom,  cactusMat, armRPlacements.length) : null;

      cactPlacements.forEach(({ tile, sub }, i) => {
        const s  = sub * 13;
        const ox = (this._rng(tile.x, tile.z, 71 + s) - 0.5) * 1.0;
        const oz = (this._rng(tile.x, tile.z, 72 + s) - 0.5) * 1.0;
        const h  = 0.7 + this._rng(tile.x, tile.z, 73 + s) * 0.7;
        dummy.position.set(
          tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
          desertSurfY + 0.275 * h,
          tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
        );
        dummy.scale.set(1, h, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunkMesh.setMatrixAt(i, dummy.matrix);
      });

      // Helper: position a two-segment elbow arm (outward + upward)
      const setArm = (outMesh, upMesh, placement, idx, attachSeed, tiltSign) => {
        const { tile, sub } = placement;
        const s  = sub * 13;
        const ox = (this._rng(tile.x, tile.z, 71 + s) - 0.5) * 1.0;
        const oz = (this._rng(tile.x, tile.z, 72 + s) - 0.5) * 1.0;
        const h  = 0.7 + this._rng(tile.x, tile.z, 73 + s) * 0.7;
        const cx = tile.x * TILE_SIZE + TILE_SIZE / 2 + ox;
        const cz = tile.z * TILE_SIZE + TILE_SIZE / 2 + oz;
        const attachFrac = 0.50 + this._rng(tile.x, tile.z, attachSeed + s) * 0.25;
        const attachH    = desertSurfY + 0.55 * h * attachFrac;

        const outCX = cx + tiltSign * Math.sin(ARM_OUT_TILT) * ARM_OUT_LEN * 0.5;
        const outCY = attachH + Math.cos(ARM_OUT_TILT) * ARM_OUT_LEN * 0.5;
        dummy.position.set(outCX, outCY, cz);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, tiltSign * ARM_OUT_TILT);
        dummy.updateMatrix();
        outMesh.setMatrixAt(idx, dummy.matrix);

        const elbowX = cx + tiltSign * Math.sin(ARM_OUT_TILT) * ARM_OUT_LEN;
        const elbowY = attachH + Math.cos(ARM_OUT_TILT) * ARM_OUT_LEN;
        const upCX   = elbowX + tiltSign * Math.sin(ARM_UP_TILT) * ARM_UP_LEN * 0.5;
        const upCY   = elbowY + Math.cos(ARM_UP_TILT) * ARM_UP_LEN * 0.5;
        dummy.position.set(upCX, upCY, cz);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, tiltSign * ARM_UP_TILT);
        dummy.updateMatrix();
        upMesh.setMatrixAt(idx, dummy.matrix);
      };

      armLPlacements.forEach((p, i) => setArm(armLOutMesh, armLUpMesh, p, i, 78, -1));
      armRPlacements.forEach((p, i) => setArm(armROutMesh, armRUpMesh, p, i, 79, +1));

      [trunkMesh, armLOutMesh, armLUpMesh, armROutMesh, armRUpMesh].forEach(m => {
        if (!m) return;
        m.castShadow = true; m.receiveShadow = true;
        m.instanceMatrix.needsUpdate = true;
        this.scene.add(m); this._meshes.push(m);
      });
    }

    // ── Shells on BEACH tiles ────────────────────────────────────────────
    const beachShellTiles = buckets[TileType.BEACH].filter(t => this._rng(t.x, t.z, 75) < 0.35);
    if (beachShellTiles.length > 0) {
      const shellGeom = new THREE.SphereGeometry(0.06, 4, 3);
      const shellMat  = new THREE.MeshLambertMaterial({ color: 0xf5e6d0 });
      const shellMesh = new THREE.InstancedMesh(shellGeom, shellMat, beachShellTiles.length);
      const beachSurfY = TerrainRenderer.surfaceY(TileType.BEACH);

      beachShellTiles.forEach((tile, i) => {
        const ox = (this._rng(tile.x, tile.z, 76) - 0.5) * 0.9;
        const oz = (this._rng(tile.x, tile.z, 77) - 0.5) * 0.9;
        dummy.position.set(
          tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
          beachSurfY + 0.03,
          tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
        );
        dummy.scale.set(1.2, 0.4, 1);
        dummy.rotation.y = this._rng(tile.x, tile.z, 78) * Math.PI * 2;
        dummy.updateMatrix();
        shellMesh.setMatrixAt(i, dummy.matrix);
      });

      shellMesh.receiveShadow = true;
      shellMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(shellMesh);
      this._meshes.push(shellMesh);
    }

    // ── Snow caps on MOUNTAIN tiles ───────────────────────────────────────
    const mountainTiles = buckets[TileType.MOUNTAIN];
    if (mountainTiles.length > 0) {
      const snowGeom = new THREE.SphereGeometry(0.4, 5, 4);
      const snowMat  = new THREE.MeshStandardMaterial({ color: 0xedf2f7, roughness: 0.92 });
      const snowMesh = new THREE.InstancedMesh(snowGeom, snowMat, mountainTiles.length);

      mountainTiles.forEach((tile, i) => {
        const hVar = 1.5 + tile.elevation * 0.08;
        const widthVar = 0.85 + this._rng(tile.x, tile.z, 14) * 0.25;
        const ox = (this._rng(tile.x, tile.z, 10) - 0.5) * 0.2;
        const oz = (this._rng(tile.x, tile.z, 11) - 0.5) * 0.2;
        dummy.position.set(
          tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
          hVar - 0.18,
          tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
        );
        const snowScale = 0.35 + this._rng(tile.x, tile.z, 12) * 0.15;
        dummy.scale.set(snowScale * widthVar, snowScale, snowScale * widthVar);
        dummy.updateMatrix();
        snowMesh.setMatrixAt(i, dummy.matrix);
      });

      snowMesh.castShadow = true;
      snowMesh.receiveShadow = true;
      snowMesh.instanceMatrix.needsUpdate = true;
      this.scene.add(snowMesh);
      this._meshes.push(snowMesh);

      // Boulder clusters at mountain bases for a more rugged look
      const mountainRocks = mountainTiles.filter(t => this._rng(t.x, t.z, 20) < 0.6);
      if (mountainRocks.length > 0) {
        const mRockGeom = new THREE.DodecahedronGeometry(0.12, 0);
        const mRockMat  = new THREE.MeshLambertMaterial({ color: 0x6b7c8d });
        const mRockMesh = new THREE.InstancedMesh(mRockGeom, mRockMat, mountainRocks.length);
        mountainRocks.forEach((tile, i) => {
          const ox = (this._rng(tile.x, tile.z, 21) - 0.5) * 1.2;
          const oz = (this._rng(tile.x, tile.z, 22) - 0.5) * 1.2;
          const scale = 0.4 + this._rng(tile.x, tile.z, 23) * 0.8;
          dummy.position.set(
            tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
            0.2 + this._rng(tile.x, tile.z, 24) * 0.2,
            tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
          );
          dummy.scale.setScalar(scale);
          dummy.rotation.set(
            (this._rng(tile.x, tile.z, 25) - 0.5) * 0.4,
            this._rng(tile.x, tile.z, 26) * Math.PI * 2,
            (this._rng(tile.x, tile.z, 27) - 0.5) * 0.4,
          );
          dummy.updateMatrix();
          mRockMesh.setMatrixAt(i, dummy.matrix);
        });
        mRockMesh.castShadow = true;
        mRockMesh.receiveShadow = true;
        mRockMesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mRockMesh);
        this._meshes.push(mRockMesh);
      }
    }
  }

  _buildAnimals(buckets) {
    const dummy = new THREE.Object3D();
    const surfY = (type) => TerrainRenderer.surfaceY(type);

    const addAnimated = (mesh, instances, config, parts = []) => {
      this.scene.add(mesh);
      this._meshes.push(mesh);
      for (const p of parts) {
        this.scene.add(p.mesh);
        this._meshes.push(p.mesh);
      }
      this._animatedAnimals.push({ mesh, parts, instances, config });
    };

    // ── Fish (2 types) in WATER tiles ─────────────────────────────────────
    // Fish type 1 = shallow-water (orange): small, fast, stays near shore (radius 3)
    // Fish type 1 = shallow-water (orange): small, fast, hugs the shoreline
    const waterTiles = buckets[TileType.WATER] ?? [];
    const deepWaterTiles = buckets[TileType.DEEP_WATER] ?? [];
    // Shallow fish spawn on WATER tiles adjacent to land
    const shallowTiles = waterTiles.filter(t =>
      this._rng(t.x, t.z, 20) < 0.44 &&
      (this.world.hasAdjacentType(t.x, t.z, TileType.GRASS) ||
       this.world.hasAdjacentType(t.x, t.z, TileType.FOREST))
    );
    // Deep fish spawn on DEEP_WATER tiles
    const deepTiles = deepWaterTiles.filter(t => this._rng(t.x, t.z, 21) < 0.30);
    const fish1Tiles = shallowTiles.length > 0
      ? shallowTiles
      : waterTiles.filter(t => this._rng(t.x, t.z, 20) < 0.36);
    const fish2Tiles = deepTiles.length > 0
      ? deepTiles
      : [...waterTiles, ...deepWaterTiles].filter(t => this._rng(t.x, t.z, 21) < 0.24);

    // Shared fish geometry; type 1 slightly smaller, type 2 slightly larger
    const fish1Geom = new THREE.SphereGeometry(0.10, 4, 3);
    const fish2Geom = new THREE.SphereGeometry(0.14, 5, 3);
    // Fins shared
    const fishFinGeom = new THREE.ConeGeometry(0.06, 0.10, 3);

    // Shallow fish: orange, quick, small wander radius, bobby
    const shallowFishConfig = {
      label: 'Shallow Fish', icon: '🐟',
      description: 'A small fish that hugs the shoreline.',
      driftRadius: 0.18, driftSpeed: 1.2, bobAmount: 0.025, bobSpeed: 4,
      mobile: true, moveSpeed: 0.55, tileType: TileType.WATER, wanderRadius: 3,
    };
    // Deep fish: blue-grey, slow, large wander radius, prefers deep water
    const deepFishConfig = {
      label: 'Deep Fish', icon: '🐠',
      description: 'A large fish that roams the open ocean.',
      driftRadius: 0.12, driftSpeed: 0.4, bobAmount: 0.008, bobSpeed: 1.5,
      mobile: true, moveSpeed: 0.22, tileTypes: [TileType.DEEP_WATER, TileType.WATER], wanderRadius: 9,
    };

    if (fish1Tiles.length > 0) {
      const fish1Mat = new THREE.MeshLambertMaterial({ color: 0xd4682a });
      const finMat1  = new THREE.MeshLambertMaterial({ color: 0xb84e1a });
      const fish1Mesh = new THREE.InstancedMesh(fish1Geom, fish1Mat, fish1Tiles.length);
      const fin1Mesh  = new THREE.InstancedMesh(fishFinGeom, finMat1, fish1Tiles.length);
      const instances1 = fish1Tiles.map((tile) => {
        const ox = (this._rng(tile.x, tile.z, 22) - 0.5) * 0.8;
        const oz = (this._rng(tile.x, tile.z, 23) - 0.5) * 0.8;
        const seed = this._rng(tile.x, tile.z, 24) * Math.PI * 2;
        const tx = tile.x + 0.5 + ox * 0.5;
        const tz = tile.z + 0.5 + oz * 0.5;
        return {
          x: tx, z: tz, targetX: tx, targetZ: tz,
          homeX: tile.x, homeZ: tile.z,
          baseY: surfY(TileType.WATER) + 0.02,
          scale: [1.3, 0.45, 0.55],
          headScale: [0.6, 0.5, 0.4],
          rotY: seed, seed,
        };
      });
      addAnimated(fish1Mesh, instances1, shallowFishConfig, [{ mesh: fin1Mesh, offset: 0.0, fin: true }]);
    }
    if (fish2Tiles.length > 0) {
      const fish2Mat = new THREE.MeshLambertMaterial({ color: 0x4a7a8e });
      const finMat2  = new THREE.MeshLambertMaterial({ color: 0x3a6a7e });
      const fish2Mesh = new THREE.InstancedMesh(fish2Geom, fish2Mat, fish2Tiles.length);
      const fin2Mesh  = new THREE.InstancedMesh(fishFinGeom, finMat2, fish2Tiles.length);
      const instances2 = fish2Tiles.map((tile) => {
        const ox = (this._rng(tile.x, tile.z, 25) - 0.5) * 0.6;
        const oz = (this._rng(tile.x, tile.z, 26) - 0.5) * 0.6;
        const seed = this._rng(tile.x, tile.z, 27) * Math.PI * 2;
        const tx = tile.x + 0.5 + ox * 0.5;
        const tz = tile.z + 0.5 + oz * 0.5;
        return {
          x: tx, z: tz, targetX: tx, targetZ: tz,
          homeX: tile.x, homeZ: tile.z,
          baseY: surfY(TileType.WATER) - 0.01,
          scale: [1.2, 0.5, 0.65],
          headScale: [0.7, 0.55, 0.5],
          rotY: seed, seed,
        };
      });
      addAnimated(fish2Mesh, instances2, deepFishConfig, [{ mesh: fin2Mesh, offset: 0.0, fin: true }]);
    }

    // ── Sheep on GRASS tiles ─────────────────────────────────────────────
    const grassTiles = buckets[TileType.GRASS] ?? [];
    const sheepTiles = grassTiles.filter(t => this._rng(t.x, t.z, 30) < 0.025);
    const mobileGrazeConfig = {
      label: 'Sheep', icon: '🐑',
      description: 'A woolly sheep grazing on the grasslands.',
      driftRadius: 0.12, driftSpeed: 0.3, bobAmount: 0.015, bobSpeed: 2.5,
      mobile: true, moveSpeed: 0.30, tileType: TileType.GRASS, wanderRadius: 5,
    };

    if (sheepTiles.length > 0) {
      // Woolly body: cylinder + head sphere + small fluffy tail
      const sheepBodyGeom = new THREE.CylinderGeometry(0.22, 0.24, 0.18, 8);
      const sheepMat      = new THREE.MeshLambertMaterial({ color: 0xfaf8f5 });
      const sheepMesh     = new THREE.InstancedMesh(sheepBodyGeom, sheepMat, sheepTiles.length);
      const sheepHeadGeom = new THREE.SphereGeometry(0.12, 6, 4);
      const sheepHeadMat  = new THREE.MeshLambertMaterial({ color: 0xf0ebe0 });
      const sheepHeadMesh = new THREE.InstancedMesh(sheepHeadGeom, sheepHeadMat, sheepTiles.length);
      const sheepTailGeom = new THREE.SphereGeometry(0.065, 4, 3);
      const sheepTailMat  = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const sheepTailMesh = new THREE.InstancedMesh(sheepTailGeom, sheepTailMat, sheepTiles.length);
      const sheepEyeGeom  = new THREE.SphereGeometry(0.025, 5, 4);
      const sheepEyeMat   = new THREE.MeshLambertMaterial({ color: 0x111122 });
      const sheepEyeLMesh = new THREE.InstancedMesh(sheepEyeGeom, sheepEyeMat, sheepTiles.length);
      const sheepEyeRMesh = new THREE.InstancedMesh(sheepEyeGeom, sheepEyeMat, sheepTiles.length);
      const instances = sheepTiles.map((tile) => {
        const ox = (this._rng(tile.x, tile.z, 31) - 0.5) * 0.9;
        const oz = (this._rng(tile.x, tile.z, 32) - 0.5) * 0.9;
        const seed = this._rng(tile.x, tile.z, 33) * Math.PI * 2;
        const tx = tile.x + 0.5 + ox * 0.5;
        const tz = tile.z + 0.5 + oz * 0.5;
        return {
          x: tx, z: tz, targetX: tx, targetZ: tz,
          homeX: tile.x, homeZ: tile.z,
          baseY: surfY(TileType.GRASS) + 0.2,
          scale: [1, 1, 1],
          headScale: [0.9, 1, 0.85],
          rotY: seed, seed,
        };
      });
      sheepMesh.castShadow = true;
      sheepHeadMesh.castShadow = true;
      addAnimated(sheepMesh, instances, mobileGrazeConfig, [
        { mesh: sheepHeadMesh, offset: 0.28 },
        { mesh: sheepTailMesh, offset: -0.24, tail: true },
        { mesh: sheepEyeLMesh, eyeL: true, fwd: 0.33, spread: 0.08, yOffset: 0.09 },
        { mesh: sheepEyeRMesh, eyeR: true, fwd: 0.33, spread: 0.08, yOffset: 0.09 },
      ]);
    }

    // ── Crabs on BEACH tiles ─────────────────────────────────────────────
    const beachTiles = buckets[TileType.BEACH] ?? [];
    const crabTiles = beachTiles.filter(t => this._rng(t.x, t.z, 60) < 0.18);
    const crabConfig = {
      label: 'Crab', icon: '🦀',
      description: 'A small crab scuttling across the sand.',
      driftRadius: 0.06, driftSpeed: 2.5, bobAmount: 0.005, bobSpeed: 3,
      mobile: true, moveSpeed: 0.35, tileType: TileType.BEACH, wanderRadius: 3,
    };
    if (crabTiles.length > 0) {
      // Body: wide flat oval shell
      const crabBodyGeom = new THREE.SphereGeometry(0.090, 8, 5);
      const crabBodyMat  = new THREE.MeshLambertMaterial({ color: 0xc0421f });
      const crabMesh     = new THREE.InstancedMesh(crabBodyGeom, crabBodyMat, crabTiles.length);
      // Claws: tapered cylinders that extend sideways
      const clawGeom  = new THREE.CylinderGeometry(0.016, 0.032, 0.13, 4);
      const clawMat   = new THREE.MeshLambertMaterial({ color: 0xd44e28 });
      const clawLMesh = new THREE.InstancedMesh(clawGeom, clawMat, crabTiles.length);
      const clawRMesh = new THREE.InstancedMesh(clawGeom, clawMat, crabTiles.length);
      // Eyes: two tiny spheres on top
      const eyeGeom  = new THREE.SphereGeometry(0.018, 4, 3);
      const eyeMat   = new THREE.MeshLambertMaterial({ color: 0x1a0a00 });
      const eyeLMesh = new THREE.InstancedMesh(eyeGeom, eyeMat, crabTiles.length);
      const eyeRMesh = new THREE.InstancedMesh(eyeGeom, eyeMat, crabTiles.length);

      const crabSurfY = surfY(TileType.BEACH);
      const instances = crabTiles.map((tile) => {
        const ox   = (this._rng(tile.x, tile.z, 61) - 0.5) * 0.9;
        const oz   = (this._rng(tile.x, tile.z, 62) - 0.5) * 0.9;
        const seed = this._rng(tile.x, tile.z, 63) * Math.PI * 2;
        const tx   = tile.x + 0.5 + ox * 0.5;
        const tz   = tile.z + 0.5 + oz * 0.5;
        return {
          x: tx, z: tz, targetX: tx, targetZ: tz,
          homeX: tile.x, homeZ: tile.z,
          baseY: crabSurfY + 0.05,
          scale:     [1.5, 0.32, 1.10],
          headScale: [1, 1, 1],
          rotY: seed, seed,
        };
      });
      crabMesh.castShadow = true;
      addAnimated(crabMesh, instances, crabConfig, [
        { mesh: clawLMesh, clawL: true },
        { mesh: clawRMesh, clawR: true },
        { mesh: eyeLMesh, eyeL: true },
        { mesh: eyeRMesh, eyeR: true },
      ]);
    }

    // ── Birds on FOREST and GRASS tiles (mobile, improved sprites) ──────────
    const forestTiles = buckets[TileType.FOREST] ?? [];
    const birdForestTiles = forestTiles.filter(t => this._rng(t.x, t.z, 50) < 0.055);
    const birdGrassTiles = grassTiles.filter(t => this._rng(t.x, t.z, 51) < 0.045);
    const birdMobileConfig = {
      label: 'Bird', icon: '🐦',
      description: 'A small bird flitting between forest and field.',
      driftRadius: 0.12, driftSpeed: 1.5, bobAmount: 0.04, bobSpeed: 5,
      mobile: true, moveSpeed: 0.55, tileTypes: [TileType.GRASS, TileType.FOREST],
    };

    // Improved bird: rounded body + head + beak
    const birdBodyGeom = new THREE.SphereGeometry(0.065, 6, 4);
    const birdHeadGeom = new THREE.SphereGeometry(0.04, 4, 3);
    const birdBeakGeom = new THREE.ConeGeometry(0.012, 0.055, 4);

    const addBirds = (tiles, tileType, offset) => {
      if (tiles.length === 0) return;
      const bodyColor = tileType === TileType.FOREST ? 0x4a5568 : 0x718096;
      const birdBodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
      const birdHeadMat = new THREE.MeshLambertMaterial({ color: bodyColor });
      const birdBeakMat = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
      const birdBodyMesh = new THREE.InstancedMesh(birdBodyGeom, birdBodyMat, tiles.length);
      const birdHeadMesh = new THREE.InstancedMesh(birdHeadGeom, birdHeadMat, tiles.length);
      const birdBeakMesh = new THREE.InstancedMesh(birdBeakGeom, birdBeakMat, tiles.length);
      const flyY = surfY(TileType.GRASS) + 0.5;
      const instances = tiles.map((tile) => {
        const ox = (this._rng(tile.x, tile.z, offset) - 0.5) * 0.8;
        const oz = (this._rng(tile.x, tile.z, offset + 1) - 0.5) * 0.8;
        const seed = this._rng(tile.x, tile.z, offset + 2) * Math.PI * 2;
        const tx = tile.x + 0.5 + ox * 0.5;
        const tz = tile.z + 0.5 + oz * 0.5;
        return {
          x: tx, z: tz, targetX: tx, targetZ: tz,
          baseY: flyY,
          scale: [1, 1.1, 0.75],
          headScale: [0.85, 1, 0.9],
          rotY: seed,
          seed,
        };
      });
      addAnimated(birdBodyMesh, instances, birdMobileConfig, [
        { mesh: birdHeadMesh, offset: 0.07 },
        { mesh: birdBeakMesh, offset: 0.12, beak: true },
      ]);
    };
    addBirds(birdForestTiles, TileType.FOREST, 52);
    addBirds(birdGrassTiles, TileType.GRASS, 55);

    // ── Single hummingbird (one per world) ─────────────────────────────────
    const allBirdTiles = [...birdForestTiles, ...birdGrassTiles];
    if (allBirdTiles.length > 0) {
      const idx = Math.floor(allBirdTiles.length * 0.37) % allBirdTiles.length;
      const tile = allBirdTiles[idx];
      // Body: tapered cylinder (wider at chest, narrow at tail)
      const humBodyGeom = new THREE.CylinderGeometry(0.018, 0.032, 0.12, 6);
      const humBodyMat = new THREE.MeshStandardMaterial({ color: 0x0e6b30, metalness: 0.45, roughness: 0.35 });
      const humBodyMesh = new THREE.InstancedMesh(humBodyGeom, humBodyMat, 1);

      // Head: slightly larger sphere
      const humHeadGeom = new THREE.SphereGeometry(0.034, 6, 5);
      const humHeadMat = new THREE.MeshStandardMaterial({ color: 0x127a38, metalness: 0.5, roughness: 0.3 });
      const humHeadMesh = new THREE.InstancedMesh(humHeadGeom, humHeadMat, 1);

      // Gorget (iridescent throat patch): flattened sphere under the head
      const gorgetGeom = new THREE.SphereGeometry(0.026, 5, 4);
      const gorgetMat = new THREE.MeshStandardMaterial({ color: 0xff1a5e, metalness: 0.7, roughness: 0.2 });
      const gorgetMesh = new THREE.InstancedMesh(gorgetGeom, gorgetMat, 1);

      // Beak: long thin needle
      const humBeakGeom = new THREE.ConeGeometry(0.006, 0.10, 4);
      const humBeakMat = new THREE.MeshLambertMaterial({ color: 0x1a1008 });
      const humBeakMesh = new THREE.InstancedMesh(humBeakGeom, humBeakMat, 1);

      // Wings: two flat planes that will flutter in updateAnimals
      const wingGeom = new THREE.PlaneGeometry(0.07, 0.03);
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0x1a6b40, metalness: 0.3, roughness: 0.4,
        transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      });
      const wingLMesh = new THREE.InstancedMesh(wingGeom, wingMat, 1);
      const wingRMesh = new THREE.InstancedMesh(wingGeom, wingMat, 1);

      // Fan tail: small flattened cone
      const tailGeom = new THREE.ConeGeometry(0.022, 0.05, 4);
      const tailMat = new THREE.MeshStandardMaterial({ color: 0x0a4a20, metalness: 0.35, roughness: 0.4 });
      const tailMesh = new THREE.InstancedMesh(tailGeom, tailMat, 1);

      const ox = (this._rng(tile.x, tile.z, 88) - 0.5) * 0.6;
      const oz = (this._rng(tile.x, tile.z, 89) - 0.5) * 0.6;
      const seed = this._rng(tile.x, tile.z, 90) * Math.PI * 2;
      const tx = tile.x + 0.5 + ox * 0.5;
      const tz = tile.z + 0.5 + oz * 0.5;
      const humInstances = [{
        x: tx, z: tz, targetX: tx, targetZ: tz,
        baseY: surfY(TileType.GRASS) + 0.55,
        scale: [0.9, 1.1, 0.9],
        headScale: [0.95, 1, 1],
        rotY: seed,
        seed,
      }];
      // Sparkle: 8 bright points that orbit the hummingbird
      const sparkleCount = 8;
      const sparklePosArr = new Float32Array(sparkleCount * 3);
      const sparkleGeom = new THREE.BufferGeometry();
      sparkleGeom.setAttribute('position', new THREE.BufferAttribute(sparklePosArr, 3));
      const sparkleMat = new THREE.PointsMaterial({
        color: 0x88ffdd, size: 0.05, transparent: true, opacity: 0.75, depthWrite: false,
      });
      const sparklePoints = new THREE.Points(sparkleGeom, sparkleMat);
      this.scene.add(sparklePoints);
      this._meshes.push(sparklePoints);

      const humConfig = {
        label: 'Hummingbird', icon: '🦜',
        description: 'A tiny jewel-green hummingbird — the only one in the world.',
        driftRadius: 0.08, driftSpeed: 3, bobAmount: 0.03, bobSpeed: 8,
        mobile: true, moveSpeed: 0.7, tileTypes: [TileType.GRASS, TileType.FOREST],
        sparkle: sparklePoints,
        hummingbird: true,
      };
      addAnimated(humBodyMesh, humInstances, humConfig, [
        { mesh: humHeadMesh, offset: 0.07 },
        { mesh: gorgetMesh, offset: 0.055, gorget: true },
        { mesh: humBeakMesh, offset: 0.13, beak: true },
        { mesh: wingLMesh, offset: 0.0, wingL: true },
        { mesh: wingRMesh, offset: 0.0, wingR: true },
        { mesh: tailMesh, offset: -0.07, tail: true },
      ]);
    }

    // ── Single Whale in DEEP_WATER ──────────────────────────────────────────
    const whaleDeepTiles = buckets[TileType.DEEP_WATER] ?? [];
    if (whaleDeepTiles.length > 0) {
      const wIdx  = Math.floor(whaleDeepTiles.length * 0.5) % whaleDeepTiles.length;
      const wTile = whaleDeepTiles[wIdx];

      const whaleMat     = new THREE.MeshLambertMaterial({ color: 0x1e3a5f });
      const whaleDarkMat = new THREE.MeshLambertMaterial({ color: 0x122030 });
      const whaleBellyMat= new THREE.MeshLambertMaterial({ color: 0x4a6080 });

      // Body: elongated sphere — wide at head, tapers to tail
      const whaleBodyGeom = new THREE.SphereGeometry(0.30, 10, 7);
      const whaleMesh     = new THREE.InstancedMesh(whaleBodyGeom, whaleMat, 1);

      // Belly patch: slightly lighter flattened sphere on the underside
      const bellyGeom  = new THREE.SphereGeometry(0.22, 8, 5);
      const bellyMesh  = new THREE.InstancedMesh(bellyGeom, whaleBellyMat, 1);

      // Dorsal fin: upward-pointing cone, sits behind midpoint
      const dorsalGeom  = new THREE.ConeGeometry(0.06, 0.28, 5);
      const dorsalMesh  = new THREE.InstancedMesh(dorsalGeom, whaleDarkMat, 1);

      // Pectoral fins: long flat shapes on each side
      const pectGeom  = new THREE.BoxGeometry(0.32, 0.04, 0.10);
      const pectLMesh = new THREE.InstancedMesh(pectGeom, whaleMat, 1);
      const pectRMesh = new THREE.InstancedMesh(pectGeom, whaleMat, 1);

      // Tail flukes: flat horizontal lobes
      const flukeGeom  = new THREE.BoxGeometry(0.30, 0.04, 0.14);
      const flukeLMesh = new THREE.InstancedMesh(flukeGeom, whaleDarkMat, 1);
      const flukeRMesh = new THREE.InstancedMesh(flukeGeom, whaleDarkMat, 1);

      // Blowhole spray: particle Points system
      const SPRAY_COUNT  = 28;
      const sprayPtsGeom = new THREE.BufferGeometry();
      const sprayPosArr  = new Float32Array(SPRAY_COUNT * 3);
      sprayPtsGeom.setAttribute('position', new THREE.BufferAttribute(sprayPosArr, 3));
      const sprayPtsMat  = new THREE.PointsMaterial({
        color: 0xd8f4ff, size: 0.09, transparent: true, opacity: 0.0, sizeAttenuation: true,
      });
      const sprayPoints  = new THREE.Points(sprayPtsGeom, sprayPtsMat);
      this.scene.add(sprayPoints);
      this._meshes.push(sprayPoints);

      const ox    = (this._rng(wTile.x, wTile.z, 91) - 0.5) * 0.5;
      const oz    = (this._rng(wTile.x, wTile.z, 92) - 0.5) * 0.5;
      const wSeed = this._rng(wTile.x, wTile.z, 93) * Math.PI * 2;
      const wx = wTile.x + 0.5 + ox;
      const wz = wTile.z + 0.5 + oz;

      const whaleInstances = [{
        x: wx, z: wz, targetX: wx, targetZ: wz,
        homeX: wTile.x, homeZ: wTile.z,
        baseY: surfY(TileType.DEEP_WATER) + 0.05,
        scale: [0.72, 0.50, 2.40],  // narrow width, flat height, long in facing direction (Z)
        rotY: wSeed, seed: wSeed,
      }];
      const whaleConfig = {
        label: 'Whale', icon: '🐋',
        description: 'A great whale, sole sovereign of the deep — ancient and unhurried.',
        driftRadius: 0.04, driftSpeed: 0.07, bobAmount: 0.05, bobSpeed: 0.5,
        mobile: true, moveSpeed: 0.08, tileTypes: [TileType.DEEP_WATER], wanderRadius: 12,
      };
      whaleConfig.spray = { points: sprayPoints, geom: sprayPtsGeom, mat: sprayPtsMat, count: SPRAY_COUNT };
      whaleMesh.castShadow = true;
      addAnimated(whaleMesh, whaleInstances, whaleConfig, [
        { mesh: bellyMesh,  offset:  0.0,  yOffset: -0.12 },  // belly below centre
        { mesh: dorsalMesh, dorsalFin: true },
        { mesh: pectLMesh,  pectL: true },
        { mesh: pectRMesh,  pectR: true },
        { mesh: flukeLMesh, flukeL: true },
        { mesh: flukeRMesh, flukeR: true },
      ]);
    }
  }

  /** Update animal instance positions. Call each frame with real-time delta. */
  updateAnimals(realDelta) {
    this._animTime += realDelta;
    const t = this._animTime;
    const ARRIVAL_DIST = 0.08;

    for (const { mesh, parts, instances, config } of this._animatedAnimals) {
      const { driftRadius, driftSpeed, bobAmount, bobSpeed, mobile, moveSpeed, tileType, tileTypes } = config;
      const types = tileTypes ?? (tileType ? [tileType] : null);
      const dummy = new THREE.Object3D();

      instances.forEach((inst, i) => {
        if (mobile && moveSpeed && types) {
          const dx = inst.targetX - inst.x;
          const dz = inst.targetZ - inst.z;
          const dist = Math.hypot(dx, dz);
          if (dist < ARRIVAL_DIST) {
            // Home-anchored wander: pick a random tile near the animal's home position.
            // This prevents corner-clustering by bounding the search around the spawn area.
            const homeX = inst.homeX ?? Math.round(inst.x);
            const homeZ = inst.homeZ ?? Math.round(inst.z);
            if (inst.homeX === undefined) { inst.homeX = homeX; inst.homeZ = homeZ; }
            const wr = config.wanderRadius ?? 6;
            let picked = false;
            for (let attempt = 0; attempt < 20; attempt++) {
              const ox = Math.round((Math.random() - 0.5) * wr * 2);
              const oz = Math.round((Math.random() - 0.5) * wr * 2);
              const cTile = this.world.getTile(homeX + ox, homeZ + oz);
              if (cTile && types.includes(cTile.type)) {
                inst.targetX = cTile.x + 0.5;
                inst.targetZ = cTile.z + 0.5;
                picked = true;
                break;
              }
            }
            if (!picked) {
              // Fallback: return to home
              inst.targetX = homeX + 0.5;
              inst.targetZ = homeZ + 0.5;
            }
          } else if (dist > 0.01) {
            const move = Math.min(moveSpeed * realDelta, dist);
            const newX = inst.x + (dx / dist) * move;
            const newZ = inst.z + (dz / dist) * move;
            // Prevent walking onto invalid tile types (e.g. land animals entering water)
            const newTile = this.world.getTile(Math.round(newX), Math.round(newZ));
            if (!newTile || !types.includes(newTile.type)) {
              // Blocked — return to home position
              inst.targetX = (inst.homeX ?? Math.round(inst.x)) + 0.5;
              inst.targetZ = (inst.homeZ ?? Math.round(inst.z)) + 0.5;
            } else {
              inst.x = newX;
              inst.z = newZ;
              inst.rotY = Math.atan2(inst.targetX - inst.x, inst.targetZ - inst.z);
            }
          }
        }

        const phase = inst.seed;
        const driftX = driftRadius * Math.sin(t * driftSpeed + phase);
        const driftZ = driftRadius * Math.cos(t * driftSpeed + phase * 1.3);
        const bob = bobAmount * Math.sin(t * bobSpeed + phase * 0.7);
        const px = (inst.x !== undefined ? inst.x * TILE_SIZE : inst.baseX) + driftX;
        const py = (inst.baseY ?? 0) + bob;
        const pz = (inst.z !== undefined ? inst.z * TILE_SIZE : inst.baseZ) + driftZ;

        // Store world-space position for sparkle (hummingbird) use
        if (config.sparkle && i === 0) {
          inst._sparkleX = px; inst._sparkleY = py; inst._sparkleZ = pz;
        }
        const ry = inst.rotY;
        // Store blowhole position for spray particles
        if (config.spray && i === 0) {
          const noseReach = inst.scale[2] * 0.30 - 0.06;
          inst._blowholeX = px + Math.sin(ry) * noseReach;
          inst._blowholeY = py + inst.scale[1] * 0.44;
          inst._blowholeZ = pz + Math.cos(ry) * noseReach;
          inst._blowholeRY = ry;
        }

        dummy.position.set(px, py, pz);
        dummy.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
        dummy.rotation.y = ry;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        for (const part of parts) {
          const hs = part.useHeadScale && inst.headScale ? inst.headScale
            : part.useSnoutScale && inst.snoutScale ? inst.snoutScale
            : inst.scale;
          if (part.wingL || part.wingR) {
            // Hummingbird wings: flutter rapidly, offset to the sides
            const side = part.wingL ? -1 : 1;
            const flutter = Math.sin(t * 45 + (part.wingR ? Math.PI : 0)) * 1.2;
            const perpX = Math.cos(ry) * side * 0.04;
            const perpZ = -Math.sin(ry) * side * 0.04;
            dummy.position.set(px + perpX, py + 0.01, pz + perpZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'ZYX';
            dummy.rotation.y = ry;
            dummy.rotation.z = flutter * side;
            dummy.rotation.x = 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.gorget) {
            // Throat patch: just below and in front of head
            const gx = px + Math.sin(ry) * part.offset;
            const gz = pz + Math.cos(ry) * part.offset;
            dummy.position.set(gx, py - 0.012, gz);
            dummy.scale.set(0.9, 0.5, 0.7);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry;
            dummy.rotation.x = 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.fin) {
            // Dorsal fin: sits on top of body, perpendicular to travel direction
            dummy.position.set(px, py + inst.scale[1] * 0.08, pz);
            dummy.scale.set(0.7, 1.0, 0.5);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry;
            dummy.rotation.x = -Math.PI / 2;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.tail) {
            // Tail: placed behind the body (negative offset along facing)
            const tailX = px - Math.sin(ry) * Math.abs(part.offset);
            const tailZ = pz - Math.cos(ry) * Math.abs(part.offset);
            dummy.position.set(tailX, py + 0.05, tailZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry + Math.PI / 4;
            dummy.rotation.x = 0.3;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.dorsalFin) {
            // Whale/dolphin dorsal fin: upward-pointing cone behind the midpoint
            const dorsalBack = inst.scale[2] * 0.30 * 0.40; // 40% of body half-length back
            const dorsalX = px - Math.sin(ry) * dorsalBack;
            const dorsalZ = pz - Math.cos(ry) * dorsalBack;
            dummy.position.set(dorsalX, py + inst.scale[1] * 0.40, dorsalZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.set(0, ry, 0);
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.flukeL || part.flukeR) {
            // Whale tail flukes: flat horizontal lobes at the tail end
            const side     = part.flukeR ? 1 : -1;
            const bob      = Math.sin(t * 0.55 + inst.seed) * 0.06;
            const tailReach = inst.scale[2] * 0.30 + 0.12; // body half-length + small overhang
            const tailX = px - Math.sin(ry) * tailReach;
            const tailZ = pz - Math.cos(ry) * tailReach;
            const perpX = Math.cos(ry) * side * 0.16;
            const perpZ = -Math.sin(ry) * side * 0.16;
            dummy.position.set(tailX + perpX, py - 0.04 + bob, tailZ + perpZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry + side * 0.22;
            dummy.rotation.x = side * 0.12 + bob * 0.4;
            dummy.rotation.z = 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.pectL || part.pectR) {
            // Whale pectoral fins: long flat fins on the sides
            const side  = part.pectR ? 1 : -1;
            // Use body half-width (scale[0] * sphere radius 0.30) for correct offset
            const bodyHalfW = inst.scale[0] * 0.30 + 0.04;
            const perpX = Math.cos(ry) * side * bodyHalfW;
            const perpZ = -Math.sin(ry) * side * bodyHalfW;
            const fwdX  = Math.sin(ry) * 0.18;
            const fwdZ  = Math.cos(ry) * 0.18;
            dummy.position.set(px + perpX + fwdX, py - 0.10, pz + perpZ + fwdZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry + side * 0.2;
            dummy.rotation.x = side * 0.45;
            dummy.rotation.z = 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.eyeL || part.eyeR) {
            // Small eyes on the front sides of the body (or head)
            const side   = part.eyeR ? 1 : -1;
            const fwd    = part.fwd    ?? 0.08;
            const spread = part.spread ?? 0.05;
            const perpX  = Math.cos(ry) * side * spread;
            const perpZ  = -Math.sin(ry) * side * spread;
            const fwdX   = Math.sin(ry) * fwd;
            const fwdZ   = Math.cos(ry) * fwd;
            dummy.position.set(px + perpX + fwdX, py + (part.yOffset ?? 0.06), pz + perpZ + fwdZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry;
            dummy.rotation.x = 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else if (part.clawL || part.clawR) {
            // Crab claw: extends sideways from body, slight wave animation
            const side   = part.clawR ? 1 : -1;
            const perpX  = Math.cos(ry) * side * 0.11;
            const perpZ  = -Math.sin(ry) * side * 0.11;
            const fwdX   = Math.sin(ry) * 0.06;
            const fwdZ   = Math.cos(ry) * 0.06;
            const wave   = Math.sin(t * 1.8 + inst.seed + (part.clawR ? 1.1 : 0)) * 0.18;
            dummy.position.set(px + perpX + fwdX, py + 0.03, pz + perpZ + fwdZ);
            dummy.scale.set(1, 1, 1);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry + side * Math.PI * 0.5;
            dummy.rotation.x = -0.25 + wave;
            dummy.rotation.z = side * 0.25;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          } else {
            const hx = px + Math.sin(ry) * part.offset;
            const hz = pz + Math.cos(ry) * part.offset;
            dummy.position.set(hx, py + (part.yOffset ?? 0.03), hz);
            dummy.scale.set(hs[0], hs[1], hs[2]);
            dummy.rotation.order = 'YXZ';
            dummy.rotation.y = ry;
            dummy.rotation.x = part.snout ? -Math.PI / 2 : part.beak ? -Math.PI / 2 : part.ears ? -0.4 : 0;
            dummy.updateMatrix();
            part.mesh.setMatrixAt(i, dummy.matrix);
          }
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      for (const part of parts) part.mesh.instanceMatrix.needsUpdate = true;

      // Hummingbird sparkle: orbit 8 points around hummingbird's current position
      if (config.sparkle && instances[0]?._sparkleX !== undefined) {
        const cx = instances[0]._sparkleX;
        const cy = instances[0]._sparkleY;
        const cz = instances[0]._sparkleZ;
        const posArr = config.sparkle.geometry.attributes.position.array;
        const count = posArr.length / 3;
        for (let si = 0; si < count; si++) {
          const angle = (si / count) * Math.PI * 2 + t * 2.5;
          const r = 0.10 + Math.sin(t * 1.8 + si * 0.9) * 0.025;
          posArr[si * 3 + 0] = cx + Math.cos(angle) * r;
          posArr[si * 3 + 1] = cy + 0.04 + Math.sin(t * 4 + si * 1.2) * 0.03;
          posArr[si * 3 + 2] = cz + Math.sin(angle) * r;
        }
        config.sparkle.geometry.attributes.position.needsUpdate = true;
        config.sparkle.material.opacity = 0.45 + Math.sin(t * 3.1) * 0.35;
      }

      // Whale blowhole spray particles
      if (config.spray && instances[0]?._blowholeX !== undefined) {
        const { geom, mat, count } = config.spray;
        const inst = instances[0];
        const SPRAY_PERIOD = 9.0;
        const SPRAY_DUR    = 1.3;
        const phase = (t * 0.7 + inst.seed * 3.0) % SPRAY_PERIOD;
        const posArr = geom.attributes.position.array;
        if (phase < SPRAY_DUR) {
          const progress = phase / SPRAY_DUR;
          mat.opacity = Math.sin(progress * Math.PI) * 0.90;
          const bx = inst._blowholeX;
          const by = inst._blowholeY;
          const bz = inst._blowholeZ;
          const ry = inst._blowholeRY;
          for (let si = 0; si < count; si++) {
            // Fan of particles: spread in a cone above the blowhole, staggered by index
            const spread = ((si / count) - 0.5) * 1.2;   // ±0.6 rad sideways cone
            const speed  = 0.05 + (si % 5) * 0.030;      // varied outward distance
            const rise   = 0.20 + (si % 4) * 0.075;      // varied upward arc
            const age    = (progress + si * 0.038) % 1.0; // each particle slightly offset
            posArr[si * 3 + 0] = bx + Math.sin(ry + spread) * speed * age;
            posArr[si * 3 + 1] = by + rise * age - 0.28 * age * age; // parabolic arc
            posArr[si * 3 + 2] = bz + Math.cos(ry + spread) * speed * age;
          }
        } else {
          mat.opacity = 0.0;
          for (let si = 0; si < count; si++) posArr[si * 3 + 1] = -100;
        }
        geom.attributes.position.needsUpdate = true;
      }
    }
  }

  /**
   * Find the nearest animal instance within worldRadius of (worldX, worldZ).
   * Returns { label, icon, description } or null.
   */
  hitTestAnimals(worldX, worldZ, worldRadius = 1.2) {
    let best = null;
    let bestDist = worldRadius;
    for (const { instances, config } of this._animatedAnimals) {
      if (!config.label) continue;
      for (const inst of instances) {
        const dist = Math.hypot(inst.x * TILE_SIZE - worldX, inst.z * TILE_SIZE - worldZ);
        if (dist < bestDist) {
          bestDist = dist;
          best = { label: config.label, icon: config.icon, description: config.description };
        }
      }
    }
    return best;
  }

  /**
   * Update vegetation visuals based on tile resource levels.
   * Berry bushes shrink & brown out, tree foliage thins & desaturates.
   */
  updateVegetation(world) {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // ── Berry bushes on GRASS ──────────────────────────────────────────
    if (this._bushMesh && this._bushPlacements) {
      const surfY = TerrainRenderer.surfaceY(TileType.GRASS);
      const GREEN = { r: 0.29, g: 0.87, b: 0.50 }; // 0x4ade80
      const BROWN = { r: 0.55, g: 0.45, b: 0.33 }; // 0x8B7355

      this._bushPlacements.forEach(({ tile, sub }, i) => {
        const r  = tile.resource; // 0..1
        const s  = sub * 13;
        const sz = 0.75 + this._rng(tile.x, tile.z, 5 + s) * 0.55;
        const scale = sz * (0.25 + r * 0.75); // shrink when depleted
        const ox = (this._rng(tile.x, tile.z, 1 + s) - 0.5) * 1.1;
        const oz = (this._rng(tile.x, tile.z, 2 + s) - 0.5) * 1.1;

        dummy.position.set(
          tile.x * TILE_SIZE + TILE_SIZE / 2 + ox,
          surfY + 0.16 * scale,
          tile.z * TILE_SIZE + TILE_SIZE / 2 + oz,
        );
        dummy.scale.set(scale, 0.7 * scale, scale);
        dummy.updateMatrix();
        this._bushMesh.setMatrixAt(i, dummy.matrix);

        // Lerp color: green → brown
        color.setRGB(
          GREEN.r * r + BROWN.r * (1 - r),
          GREEN.g * r + BROWN.g * (1 - r),
          GREEN.b * r + BROWN.b * (1 - r),
        );
        this._bushMesh.setColorAt(i, color);
      });
      this._bushMesh.instanceMatrix.needsUpdate = true;
      if (this._bushMesh.instanceColor) this._bushMesh.instanceColor.needsUpdate = true;
    }

    // ── Tree foliage on FOREST ─────────────────────────────────────────
    if (this._foliageMeshes && this._foliageMeshes.length > 0) {
      const surfY  = TerrainRenderer.surfaceY(TileType.FOREST);
      const LUSH   = { r: 0.08, g: 0.50, b: 0.24 };
      const SPARSE = { r: 0.30, g: 0.40, b: 0.20 };
      const CHERRY_LUSH   = { r: 0.98, g: 0.66, b: 0.83 };
      const CHERRY_SPARSE = { r: 0.90, g: 0.80, b: 0.85 };
      const MAPLE_LUSH    = { r: 0.86, g: 0.42, b: 0.18 };
      const MAPLE_SPARSE  = { r: 0.55, g: 0.38, b: 0.22 };

      for (const entry of this._foliageMeshes) {
        const { mesh: foliageMesh, placements,
                trunkH0, trunkHVar, trunkHScale, trunkTopFrac,
                folH0, folHVar, folSx0, folSxVar, folCenterFrac,
                isOak, isCherry, isMaple } = entry;
        placements.forEach(({ tile, sub }, i) => {
          const r             = tile.resource;
          const resourceScaleY = 0.5 + r * 0.5;
          const s   = sub * 13;
          const ox  = (this._rng(tile.x, tile.z, 3 + s) - 0.5) * 1.1;
          const oz  = (this._rng(tile.x, tile.z, 4 + s) - 0.5) * 1.1;
          const cx  = tile.x * TILE_SIZE + TILE_SIZE / 2 + ox;
          const cz  = tile.z * TILE_SIZE + TILE_SIZE / 2 + oz;
          const treeSize = 0.60 + this._rng(tile.x, tile.z, 36 + s) * 0.70;
          const tH  = trunkH0 + this._rng(tile.x, tile.z, 30 + s) * trunkHVar;
          const rotY = this._rng(tile.x, tile.z, 32 + s) * Math.PI * 2;
          const tTop = surfY + 0.42 * tH * trunkHScale * trunkTopFrac * treeSize;
          const fH   = (folH0 + this._rng(tile.x, tile.z, 35 + s) * folHVar) * resourceScaleY * treeSize;
          const fSx  = (folSx0 + this._rng(tile.x, tile.z, 33 + s) * folSxVar) * treeSize;
          const fSz  = isOak
            ? (folSx0 + this._rng(tile.x, tile.z, 34 + s) * folSxVar) * treeSize
            : fSx;
          dummy.position.set(cx, tTop + folCenterFrac * fH, cz);
          dummy.scale.set(fSx, fH, fSz);
          dummy.rotation.set(0, rotY, 0);
          dummy.updateMatrix();
          foliageMesh.setMatrixAt(i, dummy.matrix);
          const lush   = isCherry ? CHERRY_LUSH   : isMaple ? MAPLE_LUSH   : LUSH;
          const sparse = isCherry ? CHERRY_SPARSE : isMaple ? MAPLE_SPARSE : SPARSE;
          color.setRGB(
            lush.r * r + sparse.r * (1 - r),
            lush.g * r + sparse.g * (1 - r),
            lush.b * r + sparse.b * (1 - r),
          );
          foliageMesh.setColorAt(i, color);
        });
        foliageMesh.instanceMatrix.needsUpdate = true;
        if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Returns the approximate top-surface Y for a given tile type */
  static surfaceY(type) {
    return TILE_HEIGHT[type] ?? 0.14;
  }
}

