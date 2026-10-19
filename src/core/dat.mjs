// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// STL (mm, Z up) -> LDraw part file (LDU, -Y up) with edge and optional conditional lines.

import { MM_PER_LDU } from './ldraw.mjs';
import { weld, normal, meshReport } from './mesh.mjs';

function fmt(x) {
  const s = (Math.round(x * 10000) / 10000).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function stlToDat(tris, {
  scale = 1, colour = '16', edgeAngle = 30, condlines = false, origin = 'bottom-center',
  title = 'Converted part', name = 'part.dat', author = 'ldraw-stl', license = null, source = '',
} = {}) {
  const k = 1 / (MM_PER_LDU * scale);
  // (X, Y, Z) mm -> (X, -Z, Y) LDU: the inverse of the LDraw -> print rotation
  const conv = tris.map(({ v }) => {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) {
      o[i * 3] = v[i * 3] * k;
      o[i * 3 + 1] = -v[i * 3 + 2] * k;
      o[i * 3 + 2] = v[i * 3 + 1] * k;
    }
    return { c: colour, v: o };
  });
  if (origin === 'bottom-center') {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const { v } of conv) for (let i = 0; i < 9; i++) { min[i % 3] = Math.min(min[i % 3], v[i]); max[i % 3] = Math.max(max[i % 3], v[i]); }
    const shift = [-(min[0] + max[0]) / 2, -max[1], -(min[2] + max[2]) / 2]; // bottom (max y) at y = 0
    for (const { v } of conv) for (let i = 0; i < 9; i++) v[i] += shift[i % 3];
  }
  const mesh = weld(conv, 1e-3);
  const { verts, faces } = mesh;
  const lines = [
    `0 ${title}`,
    `0 Name: ${name}`,
    `0 Author: ${author}`,
    '0 !LDRAW_ORG Unofficial_Part',
  ];
  // The licence of a user's own mesh is theirs to state; never invent one.
  if (license) lines.push(`0 !LICENSE ${license}`);
  lines.push('', '0 BFC CERTIFY CCW', '');
  if (source) lines.push(`0 // converted from ${source} by ldraw-stl`);
  const P = (i) => verts[i].map(fmt).join(' ');
  for (const [a, b, c] of faces) lines.push(`3 ${colour} ${P(a)} ${P(b)} ${P(c)}`);

  // edge lines on boundaries and creases, optional conditional lines on smooth edges
  const fn = faces.map(([a, b, c]) => normal([...verts[a], ...verts[b], ...verts[c]]));
  const edges = new Map();
  faces.forEach(([a, b, c], f) => {
    for (const [p, q, r] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      if (!edges.has(key)) edges.set(key, { p, q, faces: [] });
      edges.get(key).faces.push({ f, opposite: r });
    }
  });
  const cosLimit = Math.cos((edgeAngle * Math.PI) / 180);
  let nEdge = 0, nCond = 0;
  const edgeLines = [];
  for (const e of edges.values()) {
    if (e.faces.length !== 2) { edgeLines.push(`2 24 ${P(e.p)} ${P(e.q)}`); nEdge++; continue; }
    const [n1, n2] = [fn[e.faces[0].f], fn[e.faces[1].f]];
    const dot = n1 && n2 ? n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] : 1;
    if (dot < cosLimit) { edgeLines.push(`2 24 ${P(e.p)} ${P(e.q)}`); nEdge++; }
    else if (condlines && dot < 0.99999) {
      edgeLines.push(`5 24 ${P(e.p)} ${P(e.q)} ${P(e.faces[0].opposite)} ${P(e.faces[1].opposite)}`);
      nCond++;
    }
  }
  if (edgeLines.length) lines.push('', ...edgeLines);
  const report = meshReport(mesh);
  // report sizes in print axes (X, Y, Z-up) and mm, like the STL it came from
  const [sx, sy, sz] = report.sizeMm;
  report.sizeLdu = [sx, sy, sz];
  report.sizeMm = [sx, sz, sy].map((x) => +(x * MM_PER_LDU * scale).toFixed(2));
  return { text: lines.join('\r\n') + '\r\n', report: { edgeLines: nEdge, conditionalLines: nCond, ...report } };
}
