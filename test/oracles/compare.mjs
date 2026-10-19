// compare.mjs <cmp dir> <part...> : compare ldraw-stl output with oracle outputs per part
import fs from 'node:fs'; import path from 'node:path';
const [dir, ...parts] = process.argv.slice(2);
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
// LDraw frame (Y down) in `scale` units -> STL frame mm, then recentre like ldraw-stl
function normalise(tris, scale, ldrawFrame) {
  const out = tris.map((v) => { const o = []; for (let i = 0; i < 3; i++) {
    const x = v[i * 3] * scale, y = v[i * 3 + 1] * scale, z = v[i * 3 + 2] * scale;
    o.push(...(ldrawFrame ? [x, z, -y] : [x, y, z])); } return o; });
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of out) for (let i = 0; i < 9; i++) { mn[i % 3] = Math.min(mn[i % 3], v[i]); mx[i % 3] = Math.max(mx[i % 3], v[i]); }
  const sh = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]];
  for (const v of out) for (let i = 0; i < 9; i++) v[i] += sh[i % 3];
  return { tris: out, ext: mx.map((x, i) => x - mn[i]) };
}
const nrm = (v) => { const u = [v[3] - v[0], v[4] - v[1], v[5] - v[2]], w = [v[6] - v[0], v[7] - v[1], v[8] - v[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n); return [n.map((x) => x / (l || 1)), l / 2]; };
const key = (v, q) => [0, 1, 2].map((k) => Math.round((v[k] + v[k + 3] + v[k + 6]) / 3 / q)).join(',');
function stats(t) { let a = 0, deg = 0; for (const v of t) { const [, ar] = nrm(v); a += ar; if (ar < 1e-9) deg++; } return { n: t.length, area: a, deg }; }
// For each oracle triangle, find the triangle of `mine` that contains its centroid (coplanar
// within 2 microns) and compare normals; robust against different quad diagonals.
function orient(mine, other) {
  const cell = 0.5, grid = new Map();
  const info = mine.map((v) => nrm(v));
  mine.forEach((v, i) => {
    if (info[i][1] <= 1e-9) return;
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(v[k], v[k + 3], v[k + 6]) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(v[k], v[k + 3], v[k + 6]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = `${x},${y},${z}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
    }
  });
  const inside = (v, n, p) => {
    for (let e = 0; e < 3; e++) {
      const a = [v[e * 3], v[e * 3 + 1], v[e * 3 + 2]], b = [v[(e + 1) % 3 * 3], v[(e + 1) % 3 * 3 + 1], v[(e + 1) % 3 * 3 + 2]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const c = [ab[1] * ap[2] - ab[2] * ap[1], ab[2] * ap[0] - ab[0] * ap[2], ab[0] * ap[1] - ab[1] * ap[0]];
      if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] < -1e-7) return false;
    }
    return true;
  };
  let agree = 0, flip = 0, miss = 0;
  for (const v of other) {
    const [n, a] = nrm(v); if (a <= 1e-6) continue;
    const p = [0, 1, 2].map((k) => (v[k] + v[k + 3] + v[k + 6]) / 3);
    const cand = grid.get(p.map((x) => Math.floor(x / cell)).join(',')) ?? [];
    let verdict = 0;
    for (const i of cand) {
      const [mn] = info[i], m = mine[i];
      const d = (p[0] - m[0]) * mn[0] + (p[1] - m[1]) * mn[1] + (p[2] - m[2]) * mn[2];
      if (Math.abs(d) > 0.002 || Math.abs(n[0] * mn[0] + n[1] * mn[1] + n[2] * mn[2]) < 0.99 || !inside(m, mn, p)) continue;
      const dot = n[0] * mn[0] + n[1] * mn[1] + n[2] * mn[2];
      verdict = dot > 0 ? 1 : -1; if (verdict === 1) break; // coincident double faces: any agreeing one counts
    }
    if (verdict === 1) agree++; else if (verdict === -1) flip++; else miss++;
  }
  return { agree, flip, miss };
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : '-') + '%';
const rows = [];
for (const part of parts) {
  const d = path.join(dir, part);
  const load = (f, scale, ld) => fs.existsSync(path.join(d, f)) ? normalise(f.endsWith('.json') ? JSON.parse(fs.readFileSync(path.join(d, f))).tris : readStl(path.join(d, f)), scale, ld) : null;
  const mineLo = load('mine-lo.stl', 1, false), mineHi = load('mine-hi.stl', 1, false);
  const oracles = [['three', load('three.json', 0.4, true), mineLo], ['kristov', load('kristov.stl', 1, true), mineHi], ['lego2stl', load('lego2stl.json', 1, true), null]];
  const ml = stats(mineLo.tris), mh = stats(mineHi.tris);
  const r = { part, mineLo: `${ml.n} / ${ml.area.toFixed(1)}mm2`, mineHi: `${mh.n} / ${mh.area.toFixed(1)}mm2`, ext: mineLo.ext.map((x) => x.toFixed(2)).join('x') };
  for (const [name, o, ref] of oracles) {
    if (!o) { r[name] = 'n/a'; continue; }
    const s = stats(o.tris);
    // lego2stl: compare against whichever resolution matches its area best
    const base = ref ?? (Math.abs(stats(mineLo.tris).area - s.area) < Math.abs(stats(mineHi.tris).area - s.area) ? mineLo : mineHi);
    const bs = stats(base.tris); const or = orient(base.tris, o.tris);
    const extOk = o.ext.every((x, i) => Math.abs(x - base.ext[i]) < 0.01);
    r[name] = `${s.n} tris (${s.deg} degen), area ${pct(s.area, bs.area)}, bbox ${extOk ? 'same' : o.ext.map((x) => x.toFixed(2)).join('x')}, orient agree ${or.agree} flip ${or.flip} unmatched ${or.miss}`;
  }
  rows.push(r);
}
for (const r of rows) { console.log(`\n${r.part}  mine lores ${r.mineLo}, hires ${r.mineHi}, ${r.ext} mm`); for (const k of ['three', 'kristov', 'lego2stl']) console.log(`  ${k.padEnd(9)} ${r[k]}`); }
