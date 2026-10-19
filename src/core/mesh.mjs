// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Mesh processing: LDraw space -> printable mm, welding, T-junction repair, hole capping, checks.

import { MM_PER_LDU } from './ldraw.mjs';

// LDraw is -Y up; STL/3MF are Z-up mm. (x, y, z)_ldraw -> (x, z, -y)_stl is a proper
// rotation, so triangle winding (and with it outward normals) is preserved.
export function toPrintSpace(tris, scale = 1) {
  const k = MM_PER_LDU * scale;
  return tris.map(({ c, v, p }) => {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) {
      o[i * 3] = v[i * 3] * k;
      o[i * 3 + 1] = v[i * 3 + 2] * k;
      o[i * 3 + 2] = -v[i * 3 + 1] * k;
    }
    return { c, v: o, p };
  });
}

export function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { v } of tris) for (let i = 0; i < 9; i++) { min[i % 3] = Math.min(min[i % 3], v[i]); max[i % 3] = Math.max(max[i % 3], v[i]); }
  return { min, max, size: max.map((x, i) => x - min[i]) };
}

// Drop onto the build plate (min Z = 0) and centre in XY.
export function placeOnPlate(tris) {
  const { min, max } = bounds(tris);
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
  for (const { v } of tris) for (let i = 0; i < 9; i++) v[i] += shift[i % 3];
  return tris;
}

export function normal(v) {
  const ux = v[3] - v[0], uy = v[4] - v[1], uz = v[5] - v[2];
  const wx = v[6] - v[0], wy = v[7] - v[1], wz = v[8] - v[2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz);
  return len === 0 ? null : [nx / len, ny / len, nz / len, len / 2];
}

// Weld vertices closer than `eps` and return indexed triangles (degenerates dropped).
// Points are bucketed on an eps grid and matched against the 27 neighbouring cells, so
// float noise straddling a cell border still welds.
export function weld(tris, eps) {
  const grid = new Map();
  const verts = [];
  const faces = [];
  const id = (x, y, z) => {
    const gx = Math.round(x / eps), gy = Math.round(y / eps), gz = Math.round(z / eps);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const cell = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (!cell) continue;
      for (const i of cell) {
        const v = verts[i];
        if (Math.abs(v[0] - x) <= eps && Math.abs(v[1] - y) <= eps && Math.abs(v[2] - z) <= eps) return i;
      }
    }
    const i = verts.length;
    verts.push([x, y, z]);
    const key = `${gx},${gy},${gz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
    return i;
  };
  for (const t of tris) {
    const a = id(t.v[0], t.v[1], t.v[2]), b = id(t.v[3], t.v[4], t.v[5]), c = id(t.v[6], t.v[7], t.v[8]);
    if (a === b || b === c || a === c) continue;
    faces.push([a, b, c, t.c]);
  }
  return { verts, faces };
}

const edgeKey = (p, q) => (p < q ? `${p},${q}` : `${q},${p}`);

function edgeCounts(faces) {
  const count = new Map();
  for (const [a, b, c] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(p, q);
      count.set(k, (count.get(k) || 0) + 1);
    }
  }
  return count;
}

// LDraw meshes are full of T-junctions: a vertex of one primitive lies on the edge of a
// neighbouring triangle, leaving open edges. Split each boundary edge at every boundary
// vertex lying on it (fan from the opposite corner) until nothing changes.
export function repairTJunctions(mesh, eps) {
  const { verts } = mesh;
  let faces = mesh.faces;
  for (let pass = 0; pass < 8; pass++) {
    const count = edgeCounts(faces);
    const open = (p, q) => count.get(edgeKey(p, q)) === 1;
    const boundaryVerts = new Set();
    for (const [k, n] of count) if (n === 1) for (const i of k.split(',')) boundaryVerts.add(+i);
    // boundary vertices on a coarse grid, so each edge only looks at vertices near it
    const cell = 2;
    const grid = new Map();
    for (const i of boundaryVerts) {
      const k = verts[i].map((x) => Math.floor(x / cell)).join(',');
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const near = (P, Q) => {
      const lo = [0, 1, 2].map((k) => Math.floor((Math.min(P[k], Q[k]) - eps) / cell));
      const hi = [0, 1, 2].map((k) => Math.floor((Math.max(P[k], Q[k]) + eps) / cell));
      if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > grid.size) return boundaryVerts;
      const out = [];
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
        const c = grid.get(`${x},${y},${z}`);
        if (c) out.push(...c);
      }
      return out;
    };
    const onEdge = (p, q) => {
      const P = verts[p], Q = verts[q];
      const d = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
      const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const hits = [];
      for (const i of near(P, Q)) {
        if (i === p || i === q) continue;
        const V = verts[i];
        const w = [V[0] - P[0], V[1] - P[1], V[2] - P[2]];
        const t = (w[0] * d[0] + w[1] * d[1] + w[2] * d[2]) / len2;
        if (t <= 1e-6 || t >= 1 - 1e-6) continue;
        const e = [w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]];
        if (e[0] * e[0] + e[1] * e[1] + e[2] * e[2] < eps * eps) hits.push([t, i]);
      }
      return hits.sort((x, y) => x[0] - y[0]).map((h) => h[1]);
    };
    let changed = 0;
    const next = [];
    for (const f of faces) {
      const [a, b, c, col] = f;
      let split = null;
      for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
        if (!open(p, q)) continue;
        const mids = onEdge(p, q);
        if (mids.length) { split = [p, q, r, mids]; break; }
      }
      if (!split) { next.push(f); continue; }
      const [p, q, r, mids] = split;
      const chain = [p, ...mids, q];
      for (let i = 0; i + 1 < chain.length; i++) next.push([chain[i], chain[i + 1], r, col]);
      changed++;
    }
    faces = next;
    if (!changed) break;
  }
  return { verts, faces };
}

// What remains after T-junction repair is mostly studs, tubes and pins standing on a face
// that is not cut out underneath: closed, planar boundary loops. Cap every loop that is
// planar and star-shaped from its centroid; the cap is wound opposite to the rim so the
// shell closes. Overlapping coplanar caps are fine for slicers (they union the shells).
export function capPlanarLoops(mesh, tol) {
  const { verts, faces } = mesh;
  const count = edgeCounts(faces);
  const next = new Map();
  const ambiguous = new Set();
  for (const [a, b, c, col] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (count.get(edgeKey(p, q)) !== 1) continue;
      if (next.has(p)) ambiguous.add(p);
      next.set(p, { q, col });
    }
  }
  const seen = new Set();
  let capped = 0, skipped = 0;
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let v = start;
    let ok = true;
    while (v !== undefined && !seen.has(v)) {
      if (ambiguous.has(v)) ok = false;
      seen.add(v);
      loop.push(v);
      v = next.get(v)?.q;
    }
    if (v !== start || loop.length < 3 || !ok) { skipped++; continue; }
    const P = loop.map((i) => verts[i]);
    const cen = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
    const n = [0, 0, 0]; // Newell normal of the rim
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const len = Math.hypot(...n);
    if (len === 0) { skipped++; continue; }
    const u = n.map((x) => x / len);
    // planar loops need a clean fan; small non-planar gaps in authored geometry get a looser one
    const planar = P.every((p) => Math.abs((p[0] - cen[0]) * u[0] + (p[1] - cen[1]) * u[1] + (p[2] - cen[2]) * u[2]) < tol);
    const star = P.every((a, i) => {
      const b = P[(i + 1) % P.length];
      const cr = normal([...cen, ...a, ...b]);
      return cr && cr[0] * u[0] + cr[1] * u[1] + cr[2] * u[2] > (planar ? 0.5 : 0.05);
    });
    const col = next.get(start).col;
    if (star) {
      const c = verts.length;
      verts.push(cen);
      for (let i = 0; i < loop.length; i++) faces.push([c, loop[(i + 1) % loop.length], loop[i], col]);
      capped++;
      continue;
    }
    // not star-shaped (an L-shaped cut-out, an angled tile end): ear-clip the flattened loop
    const flat = P.every((p) => Math.abs((p[0] - cen[0]) * u[0] + (p[1] - cen[1]) * u[1] + (p[2] - cen[2]) * u[2]) < tol * 5);
    const ears = flat ? earClip(P, u) : null;
    if (!ears) { skipped++; continue; }
    for (const [a, b, d] of ears) faces.push([loop[a], loop[d], loop[b], col]); // wound against the rim
    capped++;
  }
  return { verts, faces, capped, skipped };
}

// Triangulate a simple polygon (points in order, counter-clockwise about normal u) by ear
// clipping. Returns index triples, or null if the polygon is not simple enough to clip.
function earClip(P, u) {
  // a basis (e1, e2) of the plane with e1 x e2 = u, so the polygon is counter-clockwise in 2D
  const a = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let e1 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
  const l = Math.hypot(...e1);
  e1 = e1.map((x) => x / l);
  const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  const pts = P.map((p) => [p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2]]);
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const idx = pts.map((_, i) => i);
  const out = [];
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const [p0, p1, p2] = [pts[i0], pts[i1], pts[i2]];
      if (cross(p0, p1, p2) <= 1e-12) continue; // reflex or degenerate corner
      const inside = idx.some((j) => {
        if (j === i0 || j === i1 || j === i2) return false;
        const q = pts[j];
        return cross(p0, p1, q) >= 0 && cross(p1, p2, q) >= 0 && cross(p2, p0, q) >= 0;
      });
      if (inside) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) return null;
  }
  if (idx.length === 3) {
    if (cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) <= 1e-12) return null;
    out.push([idx[0], idx[1], idx[2]]);
  }
  return out.length === P.length - 2 ? out : null;
}

export function meshReport({ verts, faces }) {
  const undirected = edgeCounts(faces);
  const directed = new Map();
  for (const [a, b, c] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const d = `${p},${q}`;
      directed.set(d, (directed.get(d) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0, flipped = 0;
  for (const n of undirected.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  for (const n of directed.values()) if (n > 1) flipped++;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
  // signed volume: positive for a closed shell whose normals point outwards
  let volume = 0;
  for (const [a, b, c] of faces) {
    const [p, q, r] = [verts[a], verts[b], verts[c]];
    volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
  }
  return {
    volume,
    triangles: faces.length, vertices: verts.length, edges: undirected.size,
    boundaryEdges: boundary, nonManifoldEdges: nonManifold, inconsistentlyOrientedEdges: flipped,
    watertight: boundary === 0 && nonManifold === 0 && flipped === 0 && volume > 0,
    sizeMm: max.map((x, i) => +(x - min[i]).toFixed(2)),
  };
}

// Each LDraw part instance is welded, repaired and checked as its own shell; parts that
// touch or interpenetrate (head on neck stud) are left for the slicer to union.
export function buildShells(tris, { names = new Map(), base = 'model', scale = 1, weldMm = 0.015, repair = true } = {}) {
  const groups = new Map();
  for (const t of tris) { if (!groups.has(t.p)) groups.set(t.p, []); groups.get(t.p).push(t); }
  return [...groups].map(([inst, group]) => {
    let mesh = weld(group, weldMm * scale);
    let holes = { capped: 0, leftOpen: 0 };
    if (repair) {
      mesh = repairTJunctions(mesh, 5e-3 * scale);
      const capped = capPlanarLoops(mesh, 0.02 * scale);
      holes = { capped: capped.capped, leftOpen: capped.skipped };
    }
    // dominant colour by area: the shell's colour for --split-colors and the 3MF object
    const area = new Map();
    for (const [a, b, c, col] of mesh.faces) {
      const n = normal([...mesh.verts[a], ...mesh.verts[b], ...mesh.verts[c]]);
      area.set(col, (area.get(col) || 0) + (n ? n[3] : 0));
    }
    const colour = [...area].sort((x, y) => y[1] - x[1])[0]?.[0] ?? '16';
    return { mesh, holes, colour, name: names.get(inst) ?? base, report: meshReport(mesh) };
  });
}

export function summarise(shells) {
  const tris = [];
  for (const { mesh } of shells) for (const [a, b, c] of mesh.faces) tris.push({ v: [...mesh.verts[a], ...mesh.verts[b], ...mesh.verts[c]] });
  const { size } = bounds(tris);
  return {
    triangles: tris.length,
    sizeMm: size.map((x) => +x.toFixed(2)),
    shells: shells.length,
    closedShells: shells.filter((s) => s.report.watertight).length,
    holesCapped: shells.reduce((n, s) => n + s.holes.capped, 0),
    openShells: shells.filter((s) => !s.report.watertight).map((s) => ({ name: s.name, colour: s.colour, ...s.report })),
    volumeMm3: +shells.reduce((n, s) => n + s.report.volume, 0).toFixed(1),
  };
}
