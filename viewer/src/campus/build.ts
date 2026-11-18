// Procedural low-poly campus built from campus.json (the MAP-1 "Path A" look).
//
// Pure: imports only three, never touches the DOM, so it runs in Node tests.
// Draw calls: one ground mesh (lawn, contact shadows, walkways, plaza, Globe),
// one mesh per building (tagged with its id), two instanced tree meshes and the
// sky dome. Every color comes from ../palette.

import {
  BackSide, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, IcosahedronGeometry, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, Quaternion, ShapeUtils, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from "three";
import type { Campus } from "../../../shared/types";
import { palette } from "../palette";
import {
  UP, addGeometry, annulus, box, disc, distToRing, distToSeg, fillet, lift, longestEdgeAngle, makeBuilder,
  mix, mulberry32, normalizeRing, offsetRing, pointInRing, rgb, ringBounds, scale, smoothstep,
  type Bounds, type Builder, type RGB, type V3, type XZ,
} from "./geometry";

/** The demo building: warmer colors and an outline. */
export const DEMO_BUILDING_ID = "b-mathematics";
/** Buildings at the edge of the section, tinted toward the haze so they read as scenery. */
const BACKGROUND_IDS = new Set(["b-crawford", "b-norton"]);
const BACKGROUND_MIX = 0.3;

// Flat ground decals share one mesh, so they are stacked by height instead of
// drawn in order. Every border sits below every fill, so walkway borders vanish
// under crossing walkways and never show as lines across a junction. The plaza
// fill sits above the walkway fill: walkways cut through the curb and end at
// one clean paved disc.
const LAYER = {
  shadowOut: 0.04,
  shadowIn: 0.1,
  outline: 0.14,
  walkwayEdge: 0.2,
  plazaEdge: 0.26,
  walkwayFill: 0.32,
  plazaFill: 0.38,
  plazaInlay: 0.43,
  plazaDecor: 0.48,
  step: 0.5,
};
const PATH_HALF = 2.5; // 5 m walkways
const EDGE = 0.55; // walkway and plaza border width
const WALL_BOOST = 1.2; // vertical faces get less light; brighten their albedo
const FLOOR_M = 4; // one floor per 4 m of height
const ROOF_OVERHANG = 0.45;
const PARAPET_TOP = 1.0; // parapet height above the wall top
const DECK_DROP = 0.35; // roof deck height above the wall top, below the parapet
const OUTLINE_WIDTH = 1.0;

export type BuildingData = {
  buildingId: string;
  name: string;
  heightM: number;
  entrance: XZ;
  /** Where the scene drew the entrance door, and the direction it faces. */
  door: { x: number; z: number; nx: number; nz: number } | null;
};

export type CampusInfo = {
  bounds: Bounds;
  center: XZ;
  plaza: { x: number; z: number; r: number };
  /** Points the default camera view must keep on screen: the demo building and the plaza. */
  focusPoints: V3[];
  attribution: string | null;
  stats: { trees: number; triangles: number };
};

export type CampusBuild = {
  group: Group;
  /** One mesh per building id. Each mesh sits at its footprint's bounding-box center. */
  buildings: Map<string, Mesh>;
  info: CampusInfo;
};

type Door = { edge: number; s: number; w: number; ux: number; uz: number; nx: number; nz: number; x: number; z: number };

const P = {
  groundNear: rgb(palette.ground.near),
  groundFar: rgb(palette.ground.far),
  groundPatch: rgb(palette.ground.patch),
  walkway: rgb(palette.walkway.fill),
  walkwayEdge: rgb(palette.walkway.edge),
  plaza: rgb(palette.plaza.fill),
  plazaEdge: rgb(palette.plaza.edge),
  plazaRing: rgb(palette.plaza.ring),
  plazaLawn: rgb(palette.plaza.lawn),
  glass: rgb(palette.window.glass),
  glassLit: rgb(palette.window.lit),
  door: rgb(palette.door.panel),
  doorFrame: rgb(palette.door.frame),
  trim: rgb(palette.roof.trim),
  roofUnit: rgb(palette.roof.unit),
  demoAccent: rgb(palette.demo.accent),
  demoTrim: rgb(palette.demo.trim),
  trunk: rgb(palette.trees.trunk),
  leafy: rgb(palette.trees.leafy),
  conifer: rgb(palette.trees.conifer),
  pedestal: rgb(palette.landmark.pedestal),
  ocean: rgb(palette.landmark.ocean),
  land: rgb(palette.landmark.land),
  globeRing: rgb(palette.landmark.ring),
  skyTop: rgb(palette.sky.top),
  horizon: rgb(palette.sky.horizon),
};

export function buildCampus(campus: Campus, seed = 20261117): CampusBuild {
  const rng = mulberry32(seed);
  const group = new Group();
  group.name = "campus";
  const material = new MeshLambertMaterial({ vertexColors: true });

  // ---- section bounds and plaza ---------------------------------------------
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const grow = ([x, z]: XZ) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  };
  campus.buildings.forEach((b) => b.footprint.forEach(grow));
  campus.paths.forEach((p) => p.forEach(grow));
  const center: XZ = [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2];

  // The closed walkway loop around the Globe defines the plaza.
  let plaza = { x: 0, z: 0, r: 20 };
  for (const p of campus.paths) {
    const a = p[0], b = p[p.length - 1];
    if (p.length > 6 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) {
      const pts = p.slice(0, -1);
      const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
      const cz = pts.reduce((s, q) => s + q[1], 0) / pts.length;
      const r = pts.reduce((s, q) => s + Math.hypot(q[0] - cx, q[1] - cz), 0) / pts.length;
      if (Math.hypot(cx, cz) < 15) plaza = { x: cx, z: cz, r: r + PATH_HALF + 1 };
    }
  }

  // Soft radial gradient plus very low-frequency lighter patches.
  function groundColor(x: number, z: number): RGB {
    const t = smoothstep(90, 560, Math.hypot(x - center[0], z - center[1]));
    const c = mix(P.groundNear, P.groundFar, t);
    const n = 0.5 + 0.5 * (0.6 * Math.sin(x * 0.019 + 1.3) * Math.sin(z * 0.016 - 0.4) + 0.4 * Math.sin((x + z) * 0.0085 + 2.1));
    return mix(c, P.groundPatch, 0.22 * smoothstep(0.55, 1.0, n) * (1 - t));
  }

  const ground = makeBuilder();

  // ---- lawn: fine grid in the section, coarse out in the fog -----------------
  const axis = (c0: number) => {
    const out: number[] = [];
    for (let v = c0 - 1100; v < c0 - 260; v += 70) out.push(v);
    for (let v = c0 - 260; v < c0 + 260; v += 10) out.push(v);
    for (let v = c0 + 260; v <= c0 + 1100; v += 70) out.push(v);
    return out;
  };
  const gx = axis(center[0]), gz = axis(center[1]);
  for (let i = 0; i < gx.length - 1; i++) {
    for (let j = 0; j < gz.length - 1; j++) {
      const x0 = gx[i], x1 = gx[i + 1], z0 = gz[j], z1 = gz[j + 1];
      ground.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],
        groundColor(x0, z0), groundColor(x1, z0), groundColor(x1, z1), groundColor(x0, z1), UP);
    }
  }

  // ---- contact shadows: footprint to a 4 m offset ring, dark to lawn ---------
  const rings = campus.buildings.map((b) => normalizeRing(b.footprint));
  const shadowColor = ([x, z]: XZ) => mix(scale(groundColor(x, z), 0.55), [0.02, 0.05, 0.06], 0.15);
  for (const ring of rings) {
    const out = offsetRing(ring, 4);
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = ring[i], b = ring[j], c = out[j], d = out[i];
      ground.quad([a[0], LAYER.shadowIn, a[1]], [b[0], LAYER.shadowIn, b[1]], [c[0], LAYER.shadowOut, c[1]], [d[0], LAYER.shadowOut, d[1]],
        shadowColor(a), shadowColor(b), groundColor(c[0], c[1]), groundColor(d[0], d[1]), UP);
    }
  }

  // ---- plaza: pale disc with a crisp curb, a paved ring where the loop walk
  // runs, and a lawn with a stone ring around the Globe ----------------------
  disc(ground, plaza.x, plaza.z, plaza.r, LAYER.plazaFill, P.plaza, 72);
  annulus(ground, plaza.x, plaza.z, plaza.r - 0.05, plaza.r + EDGE + 0.25, LAYER.plazaEdge, P.plazaEdge, 72);
  const loopR = plaza.r - PATH_HALF - 1;
  annulus(ground, plaza.x, plaza.z, loopR - PATH_HALF, loopR - PATH_HALF + EDGE, LAYER.plazaInlay, P.walkwayEdge, 72);
  annulus(ground, plaza.x, plaza.z, loopR - PATH_HALF + EDGE, loopR + PATH_HALF - EDGE, LAYER.plazaInlay, P.walkway, 72);
  annulus(ground, plaza.x, plaza.z, loopR + PATH_HALF - EDGE, loopR + PATH_HALF, LAYER.plazaInlay, P.walkwayEdge, 72);
  disc(ground, 0, 0, 7.5, LAYER.plazaDecor, P.plazaLawn, 32);
  annulus(ground, 0, 0, 7.5, 9.3, LAYER.plazaDecor, P.plazaRing, 32);

  // ---- walkways: filleted polylines, a wider border ribbon under the fill ----
  const segments: [number, number, number, number][] = [];
  for (const path of campus.paths.map((p) => fillet(p, 3.5, 3))) {
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      segments.push([ax, az, bx, bz]);
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (const [h, y, c] of [[PATH_HALF + EDGE, LAYER.walkwayEdge, P.walkwayEdge], [PATH_HALF, LAYER.walkwayFill, P.walkway]] as const) {
        ground.quad([ax + nx * h, y, az + nz * h], [bx + nx * h, y, bz + nz * h], [bx - nx * h, y, bz - nz * h], [ax - nx * h, y, az - nz * h], c, c, c, c, UP);
      }
    }
    for (const [x, z] of path) {
      disc(ground, x, z, PATH_HALF + EDGE, LAYER.walkwayEdge, P.walkwayEdge, 12);
      disc(ground, x, z, PATH_HALF, LAYER.walkwayFill, P.walkway, 12);
    }
  }

  // ---- Globe sculpture at the origin -----------------------------------------
  const m4 = new Matrix4();
  addGeometry(ground, new CylinderGeometry(2.8, 3.1, 1.0, 8), m4.makeTranslation(0, LAYER.plazaDecor + 0.5, 0), () => P.pedestal);
  addGeometry(ground, new CylinderGeometry(0.65, 0.95, 2.0, 6), m4.makeTranslation(0, LAYER.plazaDecor + 2.0, 0), () => P.pedestal);
  const globeY = LAYER.plazaDecor + 3.0 + 2.8;
  addGeometry(ground, new IcosahedronGeometry(2.8, 1), m4.makeTranslation(0, globeY, 0), (c) => {
    const land = Math.sin(c.x * 1.07 + 0.4) + Math.sin(c.z * 0.9 - 0.8) * Math.cos((c.y - globeY) * 1.0) > 0.5;
    return land ? P.land : P.ocean;
  });
  const ringMatrix = new Matrix4().makeRotationX(Math.PI / 2 - 0.41).premultiply(new Matrix4().makeTranslation(0, globeY, 0));
  addGeometry(ground, new TorusGeometry(3.7, 0.2, 4, 32), ringMatrix, () => P.globeRing);

  const groundMesh = new Mesh(ground.toGeometry(), material);
  groundMesh.name = "campus-ground";
  groundMesh.matrixAutoUpdate = false;
  group.add(groundMesh);
  let triangles = ground.count / 3;

  // ---- buildings: one mesh each ----------------------------------------------
  const buildings = new Map<string, Mesh>();
  campus.buildings.forEach((b, bi) => {
    const builder = makeBuilder();
    const ring = rings[bi];
    const door = buildBuilding(builder, b, bi, ring, rng);
    const geometry = builder.toGeometry();
    const bb = ringBounds(b.footprint);
    const cx = (bb.minX + bb.maxX) / 2, cz = (bb.minZ + bb.maxZ) / 2;
    geometry.translate(-cx, 0, -cz);
    const mesh = new Mesh(geometry, material);
    mesh.name = b.id;
    mesh.position.set(cx, 0, cz);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    const data: BuildingData = {
      buildingId: b.id,
      name: b.name,
      heightM: b.heightM,
      entrance: [b.entrance[0], b.entrance[1]],
      door: door ? { x: door.x, z: door.z, nx: door.nx, nz: door.nz } : null,
    };
    mesh.userData = data;
    group.add(mesh);
    buildings.set(b.id, mesh);
    triangles += builder.count / 3;
  });

  // ---- trees: seeded scatter on open ground, two instanced meshes ------------
  const CROWN = 2.6, MAX_SCALE = 1.3;
  const clearance = (x: number, z: number) => {
    for (const ring of rings) if (pointInRing(x, z, ring) || distToRing(x, z, ring) < CROWN * MAX_SCALE + 1.5) return false;
    for (const s of segments) if (distToSeg(x, z, s[0], s[1], s[2], s[3]) < PATH_HALF + EDGE + CROWN * MAX_SCALE) return false;
    return Math.hypot(x - plaza.x, z - plaza.z) >= plaza.r + 3 + CROWN * MAX_SCALE;
  };
  const cell = 6, occupied = new Map<number, XZ>();
  const key = (i: number, j: number) => i * 100003 + j;
  type Tree = { x: number; z: number; s: number; rot: number; kind: 0 | 1; tint: number };
  const trees: Tree[] = [];
  const ext = { minX: bounds.minX - 230, maxX: bounds.maxX + 230, minZ: bounds.minZ - 230, maxZ: bounds.maxZ + 230 };
  for (let t = 0; t < 12000; t++) {
    const x = ext.minX + rng() * (ext.maxX - ext.minX), z = ext.minZ + rng() * (ext.maxZ - ext.minZ);
    const grove = 0.5 + 0.5 * (Math.sin(x * 0.031 + 0.7) * Math.cos(z * 0.027 - 1.1) * 0.7 + Math.sin((x - z) * 0.013) * 0.3);
    const outside = x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ;
    if (rng() > (outside ? 0.04 + 0.3 * grove * grove : 0.04 + 0.8 * grove * grove)) continue;
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    let near = false;
    for (let di = -1; di <= 1 && !near; di++) {
      for (let dj = -1; dj <= 1 && !near; dj++) {
        const q = occupied.get(key(ci + di, cj + dj));
        if (q && Math.hypot(q[0] - x, q[1] - z) < 7) near = true;
      }
    }
    if (near || !clearance(x, z)) continue;
    occupied.set(key(ci, cj), [x, z]);
    trees.push({ x, z, s: 0.75 + rng() * (MAX_SCALE - 0.75), rot: rng() * Math.PI * 2, kind: rng() < 0.62 ? 0 : 1, tint: rng() });
  }
  const treeGeometries = [leafyTree(), coniferTree()];
  const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), c = new Color(), yAxis = new Vector3(0, 1, 0);
  for (const kind of [0, 1] as const) {
    const list = trees.filter((t) => t.kind === kind);
    const mesh = new InstancedMesh(treeGeometries[kind], material, list.length);
    mesh.name = kind ? "trees-conifer" : "trees-leafy";
    list.forEach((t, i) => {
      p.set(t.x, 0, t.z);
      q.setFromAxisAngle(yAxis, t.rot);
      s.set(t.s, t.s * (0.9 + t.tint * 0.25), t.s);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      c.setRGB(0.88 + t.tint * 0.2, 0.92 + t.tint * 0.12, 0.85 + (1 - t.tint) * 0.15);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    triangles += (treeGeometries[kind].getAttribute("position").count / 3) * list.length;
  }

  // ---- sky dome and lights ----------------------------------------------------
  const skyGeometry = new SphereGeometry(2600, 24, 12);
  const sp = skyGeometry.getAttribute("position");
  const skyColors = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) skyColors.set(mix(P.horizon, P.skyTop, smoothstep(0, 0.55, sp.getY(i) / 2600)), i * 3);
  skyGeometry.setAttribute("color", new BufferAttribute(skyColors, 3));
  const sky = new Mesh(skyGeometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  sky.name = "sky";
  sky.position.set(center[0], 0, center[1]);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.updateMatrix();
  sky.matrixAutoUpdate = false;
  group.add(sky);

  const hemi = new HemisphereLight(palette.light.sky, palette.light.ground, 1.75);
  const sun = new DirectionalLight(palette.light.sun, 1.75);
  sun.position.set(center[0] + 230, 260, center[1] + 40); // from the east: lights the walls the opening view faces
  sun.target.position.set(center[0], 0, center[1]);
  group.add(hemi, sun, sun.target);

  // ---- what the default camera view must frame -------------------------------
  const demo = campus.buildings.find((b) => b.id === DEMO_BUILDING_ID) ?? campus.buildings[0];
  const focusPoints: V3[] = [];
  if (demo) for (const [x, z] of demo.footprint) focusPoints.push([x, 0, z], [x, demo.heightM, z]);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    focusPoints.push([plaza.x + Math.cos(a) * plaza.r, 0, plaza.z + Math.sin(a) * plaza.r]);
  }
  focusPoints.push([0, globeY + 2.8, 0]);

  return {
    group,
    buildings,
    info: { bounds, center, plaza, focusPoints, attribution: campus.attribution, stats: { trees: trees.length, triangles } },
  };
}

/** Disposes every geometry and material under `root` and detaches its children. */
export function disposeTree(root: Object3D) {
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const list: Material[] = Array.isArray(object.material) ? object.material : [object.material];
      list.forEach((mat) => materials.add(mat));
      if (object instanceof InstancedMesh) object.dispose();
    }
  });
  materials.forEach((mat) => mat.dispose());
  root.clear();
}

/**
 * Owns the campus content for one viewer: buildings are built once, on the
 * first load. The flags layer is an empty group for MAP-4's flags; their
 * handle (./flagsSeam) clears it on each load, so this never touches it.
 */
export function createCampusWorld() {
  const root = new Group();
  root.name = "campus-root";
  const flagsLayer = new Group();
  flagsLayer.name = "flags";
  root.add(flagsLayer);
  let built: CampusBuild | undefined;

  return {
    root,
    flagsLayer,
    get built() {
      return built;
    },
    /** Builds the campus on the first call only; later calls return the same build. */
    load(campus: Campus): CampusBuild {
      if (!built) {
        built = buildCampus(campus);
        root.add(built.group);
      }
      return built;
    },
    dispose() {
      disposeTree(root);
      built = undefined;
    },
  };
}

// ---- one building -------------------------------------------------------------

function buildBuilding(world: Builder, b: Campus["buildings"][number], bi: number, ring: XZ[], rng: () => number): Door | null {
  const demo = b.id === DEMO_BUILDING_ID;
  const background = BACKGROUND_IDS.has(b.id);
  const haze = new Color(palette.sky.horizon);
  const wallColor = new Color(demo ? palette.demo.wall : palette.walls[bi % palette.walls.length]);
  const { hue, saturation, lightness } = palette.roof.tint;
  const roofColor = demo ? new Color(palette.demo.roof) : wallColor.clone().offsetHSL(hue, saturation, lightness);
  if (background) {
    wallColor.lerp(haze, BACKGROUND_MIX);
    roofColor.lerp(haze, BACKGROUND_MIX);
  }
  const roof: RGB = [roofColor.r, roofColor.g, roofColor.b];
  const wall = scale([wallColor.r, wallColor.g, wallColor.b], WALL_BOOST);
  const accent = demo ? P.demoAccent : rgb(palette.door.awnings[bi % palette.door.awnings.length]);
  const plinth = scale(wall, 0.8);
  const trim = scale(demo ? P.demoTrim : P.trim, 1.08);
  const h = b.heightM;
  const floors = Math.max(1, Math.round(h / FLOOR_M));
  const fh = h / floors;

  const door = placeDoor(ring, b.entrance);
  const doors = door ? [door, ...extraDoors(ring, door.edge)] : extraDoors(ring, -1);

  // ---- walls, plinth and window bands ----
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) continue;
    const ux = dx / L, uz = dz / L, nx = uz, nz = -ux;
    const n: V3 = [nx, 0, nz];
    const at = (s: number, y: number, off = 0): V3 => [a[0] + ux * s + nx * off, y, a[1] + uz * s + nz * off];
    world.quad(at(0, 0), at(L, 0), at(L, 0.6), at(0, 0.6), plinth, plinth, plinth, plinth, n);
    world.quad(at(0, 0.6), at(L, 0.6), at(L, h), at(0, h), wall, wall, wall, wall, n);
    const pitch = 3.3, ww = 2.2;
    const count = Math.floor((L - 1.2) / pitch);
    if (count < 1) continue;
    const s0 = (L - count * pitch) / 2 + (pitch - ww) / 2;
    const edgeDoors = doors.filter((d) => d.edge === i);
    for (let f = 0; f < floors; f++) {
      const y0 = f * fh + 1.15, y1 = f * fh + fh - 0.85;
      for (let k = 0; k < count; k++) {
        const s = s0 + k * pitch;
        if (f === 0 && edgeDoors.some((d) => s + ww > d.s - d.w / 2 - 0.6 && s < d.s + d.w / 2 + 0.6)) continue;
        const glass = scale(!background && (k + f + bi) % 4 === 0 ? P.glassLit : P.glass, WALL_BOOST);
        world.quad(at(s, y0, 0.06), at(s + ww, y0, 0.06), at(s + ww, y1, 0.06), at(s, y1, 0.06), glass, glass, glass, glass, n);
      }
    }
  }

  // ---- roof: overhanging parapet around a sunken deck ----
  // The demo building's parapet is in its accent color: a crisp outline seen from above.
  const outer = offsetRing(ring, ROOF_OVERHANG);
  const inner = offsetRing(ring, -0.3);
  const yTop = h + PARAPET_TOP, yDeck = h + DECK_DROP;
  const cap = demo ? P.demoAccent : trim;
  const face = demo ? scale(P.demoAccent, 0.92) : trim;
  const innerFace = scale(trim, 0.86);
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j], r0 = ring[i], r1 = ring[j];
    const L = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
    if (L < 1e-3) continue;
    const out: V3 = [(o1[1] - o0[1]) / L, 0, -(o1[0] - o0[0]) / L];
    const inward: V3 = [-out[0], 0, -out[2]];
    world.quad([o0[0], h, o0[1]], [o1[0], h, o1[1]], [o1[0], yTop, o1[1]], [o0[0], yTop, o0[1]], face, face, face, face, out);
    world.quad([o0[0], h, o0[1]], [o1[0], h, o1[1]], [r1[0], h, r1[1]], [r0[0], h, r0[1]], trim, trim, trim, trim, [0, -1, 0]);
    world.quad([o0[0], yTop, o0[1]], [o1[0], yTop, o1[1]], [i1[0], yTop, i1[1]], [i0[0], yTop, i0[1]], cap, cap, cap, cap, UP);
    world.quad([i0[0], yDeck, i0[1]], [i1[0], yDeck, i1[1]], [i1[0], yTop, i1[1]], [i0[0], yTop, i0[1]], innerFace, innerFace, innerFace, innerFace, inward);
  }
  const contour = inner.map(([x, z]) => new Vector2(x, z));
  for (const [k0, k1, k2] of ShapeUtils.triangulateShape(contour, [])) {
    const v = (k: number): V3 => [inner[k][0], yDeck, inner[k][1]];
    world.tri(v(k0), v(k1), v(k2), roof, roof, roof, UP);
  }

  // a few rooftop units for silhouette
  const angle = longestEdgeAngle(ring);
  const units = 2 + Math.floor(rng() * 3);
  const bb = ringBounds(ring);
  for (let k = 0, tries = 0; k < units && tries < 60; tries++) {
    const x = bb.minX + rng() * (bb.maxX - bb.minX), z = bb.minZ + rng() * (bb.maxZ - bb.minZ);
    if (!pointInRing(x, z, ring) || distToRing(x, z, ring) < 4.5) continue;
    const w = 2.5 + rng() * 3, d = 2.2 + rng() * 2, uh = 0.9 + rng() * 0.9;
    box(world, x, z, yDeck, w, d, uh, angle, P.roofUnit, scale(P.roofUnit, 0.86));
    k++;
  }

  // ---- doors: the entrance gets an awning and a step; extra doors are decoration ----
  doors.forEach((d, index) => {
    const main = index === 0 && d === door;
    const { x, z, ux, uz, nx, nz, w } = d;
    const n: V3 = [nx, 0, nz];
    const pt = (s: number, y: number, off: number): V3 => [x + ux * s + nx * off, y, z + uz * s + nz * off];
    const dh = Math.min(main ? 2.8 : 2.4, fh - 0.8);
    const fw = w / 2 + (main ? 0.35 : 0.25);
    world.quad(pt(-fw, 0, 0.07), pt(fw, 0, 0.07), pt(fw, dh + 0.3, 0.07), pt(-fw, dh + 0.3, 0.07), P.doorFrame, P.doorFrame, P.doorFrame, P.doorFrame, n);
    world.quad(pt(-w / 2, 0, 0.1), pt(w / 2, 0, 0.1), pt(w / 2, dh, 0.1), pt(-w / 2, dh, 0.1), P.door, P.door, P.door, P.door, n);
    if (!main) return;
    // awning: sloped wedge sticking out 1.8 m
    const aw = w / 2 + 0.9, yA = dh + 0.45, reach = 1.8;
    const t0 = pt(-aw, yA + 0.7, 0), t1 = pt(aw, yA + 0.7, 0), f0 = pt(-aw, yA, reach), f1 = pt(aw, yA, reach);
    const b0 = pt(-aw, yA - 0.25, reach), b1 = pt(aw, yA - 0.25, reach), w0 = pt(-aw, yA + 0.45, 0), w1 = pt(aw, yA + 0.45, 0);
    const shade = scale(accent, 0.8);
    world.quad(t0, t1, f1, f0, accent, accent, accent, accent, [nx * 0.4, 1, nz * 0.4]);
    world.quad(f0, f1, b1, b0, trim, trim, trim, trim, n);
    world.quad(b0, b1, w1, w0, shade, shade, shade, shade, [nx * 0.3, -1, nz * 0.3]);
    world.tri(t0, f0, b0, shade, shade, shade, [-ux, 0, -uz]);
    world.tri(t0, b0, w0, shade, shade, shade, [-ux, 0, -uz]);
    world.tri(t1, f1, b1, shade, shade, shade, [ux, 0, uz]);
    world.tri(t1, b1, w1, shade, shade, shade, [ux, 0, uz]);
    const y = LAYER.step;
    world.quad(pt(-w / 2 - 1, y, 0), pt(w / 2 + 1, y, 0), pt(w / 2 + 1, y, 1.6), pt(-w / 2 - 1, y, 1.6), P.trim, P.trim, P.trim, P.trim, UP);
  });

  // ---- demo building: crisp accent band on the ground around its base ----
  if (demo) {
    const band = offsetRing(ring, OUTLINE_WIDTH, 0.9); // tight miter: no spikes at notches
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = ring[i], c = ring[j], e = band[j], f = band[i];
      const y = LAYER.outline;
      world.quad([a[0], y, a[1]], [c[0], y, c[1]], [e[0], y, e[1]], [f[0], y, f[1]], P.demoAccent, P.demoAccent, P.demoAccent, P.demoAccent, UP);
    }
  }

  return door;
}

/** Puts the entrance door on the wall nearest the campus.json entrance. */
function placeDoor(ring: XZ[], entrance: XZ): Door | null {
  if (ring.length < 3) return null;
  const [ex, ez] = entrance;
  const candidates = ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    return { i, d: distToSeg(ex, ez, a[0], a[1], b[0], b[1]), L: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const minD = Math.min(...candidates.map((c) => c.d));
  // On a corner: take the longest wall within 1 m and slide the door along it
  // until it fits. Off a corner: nearest wall, door centered on the entrance,
  // narrowed instead of slid if needed.
  const onCorner = ring.some(([x, z]) => Math.hypot(x - ex, z - ez) < 0.01);
  const pick = onCorner
    ? candidates.filter((c) => c.d < minD + 1).sort((p, q) => q.L - p.L)[0]
    : candidates.reduce((p, q) => (q.d < p.d ? q : p));
  const a = ring[pick.i], b = ring[(pick.i + 1) % ring.length];
  const ux = (b[0] - a[0]) / pick.L, uz = (b[1] - a[1]) / pick.L;
  const proj = (ex - a[0]) * ux + (ez - a[1]) * uz;
  let w: number, s: number;
  if (onCorner) {
    w = Math.min(2.6, pick.L - 1);
    s = Math.min(Math.max(proj, w / 2 + 0.5), pick.L - w / 2 - 0.5);
  } else {
    s = Math.min(Math.max(proj, 0), pick.L);
    w = Math.max(0.8, Math.min(2.6, pick.L - 1, 2 * (Math.min(s, pick.L - s) - 0.5)));
  }
  return { edge: pick.i, s, w, ux, uz, nx: uz, nz: -ux, x: a[0] + ux * s, z: a[1] + uz * s };
}

/** Decorative side doors centered on the longest other walls (scene only; campus.json keeps one entrance). */
function extraDoors(ring: XZ[], skipEdge: number): Door[] {
  const edges = ring
    .map((a, i) => {
      const b = ring[(i + 1) % ring.length];
      return { i, a, b, L: Math.hypot(b[0] - a[0], b[1] - a[1]) };
    })
    .filter((e) => e.i !== skipEdge && e.L >= 14)
    .sort((p, q) => q.L - p.L)
    .slice(0, ring.length > 8 ? 2 : 1);
  return edges.map(({ i, a, b, L }) => {
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, s = L / 2;
    return { edge: i, s, w: 1.8, ux, uz, nx: uz, nz: -ux, x: a[0] + ux * s, z: a[1] + uz * s };
  });
}

// ---- tree models (one geometry each, instanced) ---------------------------------

function leafyTree() {
  const b = makeBuilder(), m = new Matrix4();
  addGeometry(b, new CylinderGeometry(0.32, 0.45, 2.4, 5, 1, true), m.makeTranslation(0, 1.2, 0), () => P.trunk);
  const crown = new Matrix4().makeScale(1, 0.92, 1).premultiply(new Matrix4().makeTranslation(0, 4.3, 0));
  addGeometry(b, new IcosahedronGeometry(2.6, 0), crown, (c) => (c.y > 4.6 ? lift(P.leafy, 1.1) : P.leafy));
  return b.toGeometry();
}

function coniferTree() {
  const b = makeBuilder(), m = new Matrix4();
  addGeometry(b, new CylinderGeometry(0.28, 0.4, 1.6, 5, 1, true), m.makeTranslation(0, 0.8, 0), () => P.trunk);
  addGeometry(b, new ConeGeometry(2.4, 4.2, 7), m.makeTranslation(0, 3.4, 0), () => P.conifer);
  addGeometry(b, new ConeGeometry(1.75, 3.4, 7), m.makeTranslation(0, 5.6, 0), () => lift(P.conifer, 1.1));
  return b.toGeometry();
}
