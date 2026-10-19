// cmp2.mjs <ref.stl> <other> [ldu|mm-ldraw|stl] : compare a mesh with a reference STL (ldraw-stl frame)
import fs from 'node:fs';
const [refFile, otherFile, frame = 'stl'] = process.argv.slice(2);
function readStl(f) {
  const b = fs.readFileSync(f);
  if (b.length >= 84 && 84 + 50 * b.readUInt32LE(80) === b.length) {
    const n = b.readUInt32LE(80), t = [];
    for (let i = 0, o = 84; i < n; i++, o += 50) { const v = []; for (let j = 0; j < 9; j++) v.push(b.readFloatLE(o + 12 + j * 4)); t.push(v); }
    return t;
  }
  const nums = [...b.toString().matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
  const t = []; for (let i = 0; i < nums.length; i += 9) t.push(nums.slice(i, i + 9)); return t;
}
const load = (f) => f.endsWith('.json') ? JSON.parse(fs.readFileSync(f)).tris : readStl(f);
function normalise(tris, frame) {
  const s = frame === 'ldu' ? 0.4 : 1;
  const out = tris.map((v) => { const o = []; for (let i = 0; i < 3; i++) { const x = v[i * 3] * s, y = v[i * 3 + 1] * s, z = v[i * 3 + 2] * s; o.push(...(frame === 'stl' ? [x, y, z] : [x, z, -y])); } return o; });
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of out) for (let i = 0; i < 9; i++) { mn[i % 3] = Math.min(mn[i % 3], v[i]); mx[i % 3] = Math.max(mx[i % 3], v[i]); }
  const sh = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]];
  for (const v of out) for (let i = 0; i < 9; i++) v[i] += sh[i % 3];
  return { tris: out, ext: mx.map((x, i) => x - mn[i]) };
}
const nrm = (v) => { const u = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], w = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n); return [n.map((x) => x / (l || 1)), l / 2]; };
const stats = (t) => { let a = 0, vol = 0; for (const v of t) { a += nrm(v)[1];
  vol += (v[0] * (v[4] * v[8] - v[5] * v[7]) - v[1] * (v[3] * v[8] - v[5] * v[6]) + v[2] * (v[3] * v[7] - v[4] * v[6])) / 6; } return { n: t.length, area: a, vol }; };
function orient(mine, other) {
  const cell = 0.5, grid = new Map(), info = mine.map(nrm);
  mine.forEach((v, i) => { if (info[i][1] <= 1e-9) return;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(v[k], v[k + 3], v[k + 6]) / cell)), hi = [0, 1, 2].map((k) => Math.floor(Math.max(v[k], v[k + 3], v[k + 6]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
  const inside = (v, n, p) => { for (let e = 0; e < 3; e++) { const a = v.slice(e * 3, e * 3 + 3), b = v.slice((e + 1) % 3 * 3, (e + 1) % 3 * 3 + 3);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const c = [ab[1] * ap[2] - ab[2] * ap[1], ab[2] * ap[0] - ab[0] * ap[2], ab[0] * ap[1] - ab[1] * ap[0]]; if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] < -1e-6) return false; } return true; };
  let agree = 0, flip = 0, miss = 0;
  for (const v of other) { const [n, a] = nrm(v); if (a <= 1e-6) continue; const p = [0, 1, 2].map((k) => (v[k] + v[k + 3] + v[k + 6]) / 3);
    let verdict = 0;
    for (const i of grid.get(p.map((x) => Math.floor(x / cell)).join(',')) ?? []) { const [mn] = info[i], m = mine[i];
      const d = (p[0] - m[0]) * mn[0] + (p[1] - m[1]) * mn[1] + (p[2] - m[2]) * mn[2], dot = n[0] * mn[0] + n[1] * mn[1] + n[2] * mn[2];
      if (Math.abs(d) > 0.02 || Math.abs(dot) < 0.98 || !inside(m, mn, p)) continue; verdict = dot > 0 ? 1 : -1; if (verdict === 1) break; }
    if (verdict === 1) agree++; else if (verdict === -1) flip++; else miss++; }
  return { agree, flip, miss };
}
const ref = normalise(load(refFile), 'stl'), oth = normalise(load(otherFile), frame);
const a = stats(ref.tris), b = stats(oth.tris), o = orient(ref.tris, oth.tris);
const ext = oth.ext.every((x, i) => Math.abs(x - ref.ext[i]) < 0.02) ? 'bbox same' : `bbox ${oth.ext.map((x) => x.toFixed(2)).join('x')} vs ${ref.ext.map((x) => x.toFixed(2)).join('x')}`;
console.log(`tris ${b.n}/${a.n}, area ${(100 * b.area / a.area).toFixed(2)}%, volume ${b.vol.toFixed(1)}/${a.vol.toFixed(1)} mm3, ${ext}, orient agree ${o.agree} flip ${o.flip} unmatched ${o.miss}`);
