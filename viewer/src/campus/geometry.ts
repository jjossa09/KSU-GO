// Small geometry helpers for the campus builder. Pure: no DOM, no WebGL.
// Coordinates follow CONTRACTS.md §3: x east, z south, y up, meters.

import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3 } from "three";

export type XZ = [number, number];
export type V3 = [number, number, number];
export type RGB = [number, number, number];

export const UP: V3 = [0, 1, 0];

/** A palette hex as a linear RGB triple, ready for a vertex color. */
export function rgb(hex: number): RGB {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scale(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function lift(c: RGB, s: number): RGB {
  return [Math.min(1, c[0] * s), Math.min(1, c[1] * s), Math.min(1, c[2] * s)];
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Seeded random numbers in [0, 1), so the same campus always gets the same trees. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- flat-shaded triangle soup with per-vertex colors -----------------------

export type Builder = {
  /** Adds a triangle. If `want` is given, the winding is flipped so the normal points along it. */
  tri(a: V3, b: V3, c: V3, ca: RGB, cb?: RGB, cc?: RGB, want?: V3): void;
  quad(a: V3, b: V3, c: V3, d: V3, ca: RGB, cb: RGB, cc: RGB, cd: RGB, want?: V3): void;
  /** Vertices written so far. */
  readonly count: number;
  toGeometry(): BufferGeometry;
};

export function makeBuilder(): Builder {
  let pos = new Float32Array(1 << 14);
  let nor = new Float32Array(1 << 14);
  let col = new Float32Array(1 << 14);
  let n = 0; // floats written

  function ensure(k: number) {
    if (n + k <= pos.length) return;
    const grow = (a: Float32Array) => {
      const b = new Float32Array(a.length * 2);
      b.set(a);
      return b;
    };
    pos = grow(pos);
    nor = grow(nor);
    col = grow(col);
  }

  function push(p: V3, nx: number, ny: number, nz: number, c: RGB) {
    pos[n] = p[0]; pos[n + 1] = p[1]; pos[n + 2] = p[2];
    nor[n] = nx; nor[n + 1] = ny; nor[n + 2] = nz;
    col[n] = c[0]; col[n + 1] = c[1]; col[n + 2] = c[2];
    n += 3;
  }

  function tri(a: V3, b: V3, c: V3, ca: RGB, cb: RGB = ca, cc: RGB = ca, want?: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    ensure(9);
    if (want && nx * want[0] + ny * want[1] + nz * want[2] < 0) {
      push(a, -nx, -ny, -nz, ca); push(c, -nx, -ny, -nz, cc); push(b, -nx, -ny, -nz, cb);
    } else {
      push(a, nx, ny, nz, ca); push(b, nx, ny, nz, cb); push(c, nx, ny, nz, cc);
    }
  }

  return {
    tri,
    quad(a, b, c, d, ca, cb, cc, cd, want) {
      tri(a, b, c, ca, cb, cc, want);
      tri(a, c, d, ca, cc, cd, want);
    },
    get count() {
      return n / 3;
    },
    toGeometry() {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos.slice(0, n), 3));
      g.setAttribute("normal", new BufferAttribute(nor.slice(0, n), 3));
      g.setAttribute("color", new BufferAttribute(col.slice(0, n), 3));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    },
  };
}

/** Appends a three.js geometry, transformed, as flat-shaded triangles colored per face. */
export function addGeometry(
  builder: Builder,
  geometry: BufferGeometry,
  matrix: Matrix4,
  colorAt: (faceCenter: Vector3) => RGB,
) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.applyMatrix4(matrix);
  const p = g.getAttribute("position");
  const c = new Vector3();
  for (let i = 0; i < p.count; i += 3) {
    const a: V3 = [p.getX(i), p.getY(i), p.getZ(i)];
    const b: V3 = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const d: V3 = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    c.set((a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3);
    builder.tri(a, b, d, colorAt(c));
  }
  g.dispose();
  geometry.dispose();
}

/** Flat disc of `seg` triangles at height `y`. */
export function disc(b: Builder, cx: number, cz: number, r: number, y: number, color: RGB, seg: number) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    b.tri(
      [cx, y, cz],
      [cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r],
      [cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r],
      color, color, color, UP,
    );
  }
}

/** Flat annulus from radius `r0` to `r1` at height `y`. */
export function annulus(b: Builder, cx: number, cz: number, r0: number, r1: number, y: number, color: RGB, seg: number) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const p = (a: number, r: number): V3 => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    b.quad(p(a0, r0), p(a1, r0), p(a1, r1), p(a0, r1), color, color, color, color, UP);
  }
}

/** Box of size w × h × d standing on y0, rotated `angle` around y. */
export function box(b: Builder, cx: number, cz: number, y0: number, w: number, d: number, h: number, angle: number, top: RGB, side: RGB) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const corner = (u: number, v: number, y: number): V3 => [cx + c * u - s * v, y, cz + s * u + c * v];
  const hw = w / 2, hd = d / 2, y1 = y0 + h;
  const pts: XZ[] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  b.quad(corner(-hw, -hd, y1), corner(hw, -hd, y1), corner(hw, hd, y1), corner(-hw, hd, y1), top, top, top, top, UP);
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    const want: V3 = [c * mx - s * mz, 0, s * mx + c * mz];
    b.quad(corner(p[0], p[1], y0), corner(q[0], q[1], y0), corner(q[0], q[1], y1), corner(p[0], p[1], y1), side, side, side, side, want);
  }
}

// ---- 2D rings and polylines (x/z plane) -------------------------------------

export function signedArea(ring: readonly XZ[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/** Copy of `ring` with positive signed area, so each edge's outward normal is (dz, -dx). */
export function normalizeRing(ring: readonly XZ[]): XZ[] {
  const out = ring.map(([x, z]): XZ => [x, z]);
  if (signedArea(out) < 0) out.reverse();
  return out;
}

/**
 * Mitered offset of a positive-area ring; `d` > 0 grows it, `d` < 0 shrinks it.
 * A corner moves at most `d / minCos`, so a larger `minCos` cuts sharp spikes.
 */
export function offsetRing(ring: readonly XZ[], d: number, minCos = 0.4): XZ[] {
  const n = ring.length;
  const out: XZ[] = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], c = ring[i], q = ring[(i + 1) % n];
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const l2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const n1: XZ = [(c[1] - p[1]) / l1, -(c[0] - p[0]) / l1];
    const n2: XZ = [(q[1] - c[1]) / l2, -(q[0] - c[0]) / l2];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    const cos = Math.max(mx * n1[0] + mz * n1[1], minCos);
    out.push([c[0] + (mx * d) / cos, c[1] + (mz * d) / cos]);
  }
  return out;
}

export function pointInRing(x: number, z: number, ring: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

export function distToRing(x: number, z: number, ring: readonly XZ[]): number {
  let d = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    d = Math.min(d, distToSeg(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

export function ringBounds(ring: readonly XZ[]): Bounds {
  const b: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const [x, z] of ring) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
}

/** Direction (radians, in x/z) of the ring's longest edge. */
export function longestEdgeAngle(ring: readonly XZ[]): number {
  let best = 0, angle = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) {
      best = L;
      angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }
  }
  return angle;
}

/**
 * Rounds polyline corners with short quadratic arcs. Endpoints stay fixed, so
 * entrances and junctions keep their exact positions; interior corners move
 * less than the walkway half-width.
 */
export function fillet(path: readonly XZ[], maxCut: number, steps: number): XZ[] {
  const first = path[0], last = path[path.length - 1];
  const closed = path.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01;
  const pts = closed ? path.slice(0, -1) : path;
  const n = pts.length;
  if (n < 3) return path.map(([x, z]): XZ => [x, z]);
  const out: XZ[] = [];
  const corner = (i: number) => {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    const l1 = Math.hypot(p[0] - c[0], p[1] - c[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const cut = Math.min(maxCut, 0.4 * l1, 0.4 * l2);
    if (cut < 0.2) {
      out.push([c[0], c[1]]);
      return;
    }
    const a: XZ = [c[0] + ((p[0] - c[0]) / l1) * cut, c[1] + ((p[1] - c[1]) / l1) * cut];
    const b: XZ = [c[0] + ((q[0] - c[0]) / l2) * cut, c[1] + ((q[1] - c[1]) / l2) * cut];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  };
  if (closed) {
    for (let i = 0; i < n; i++) corner(i);
    out.push([out[0][0], out[0][1]]);
    return out;
  }
  out.push([pts[0][0], pts[0][1]]);
  for (let i = 1; i < n - 1; i++) corner(i);
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
