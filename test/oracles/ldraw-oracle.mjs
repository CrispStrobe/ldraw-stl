// ldraw-oracle.mjs <ldraw lib dir> <part.dat> <out.json> : three.js LDrawLoader -> world-space triangles (LDU)
import fs from 'node:fs'; import path from 'node:path';
import * as THREE from 'three';
import { LDrawLoader } from 'three/examples/jsm/loaders/LDrawLoader.js';
const [lib, part, out] = process.argv.slice(2);
globalThis.ProgressEvent ??= class extends Event { constructor(t, o = {}) { super(t); Object.assign(this, o); } };
const BASE = 'http://ldraw.local/';
globalThis.fetch = async (req) => {
  const url = typeof req === 'string' ? req : req.url;
  if (process.env.TRACE) console.error('fetch', url);
  const rel = decodeURIComponent(url.slice(BASE.length));
  const f = path.join(lib, rel);
  const ok = fs.existsSync(f) && fs.statSync(f).isFile();
  const text = ok ? fs.readFileSync(f, 'utf8') : '';
  // no body stream: FileLoader then skips its progress-reporting stream wrapper
  return { ok, status: ok ? 200 : 404, statusText: ok ? 'OK' : 'Not Found', url, headers: new Headers(), body: undefined, text: async () => text };
};
const loader = new LDrawLoader();
loader.setConditionalLineMaterial(THREE.LineBasicMaterial);
loader.smoothNormals = false; // normals are recomputed by the comparison anyway
loader.setPartsLibraryPath(BASE);
await loader.preloadMaterials(BASE + 'LDConfig.ldr');
const group = await loader.loadAsync(BASE + 'parts/' + part);
group.updateMatrixWorld(true);
const tris = []; let doubleSided = 0; let mirroredMeshes = 0;
const v = new THREE.Vector3();
group.traverse((o) => {
  if (!o.isMesh) return;
  // WebGLRenderer flips the front face for mirrored world matrices; do the same here
  const mirrored = o.matrixWorld.determinant() < 0;
  if (mirrored) mirroredMeshes++;
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
  for (const g of groups) {
    const ds = mats[g.materialIndex]?.side === THREE.DoubleSide;
    const end = Math.min(g.start + g.count, idx ? idx.count : pos.count); // group counts may be Infinity
    for (let i = g.start; i < end; i += 3) {
      const t = [];
      for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); t.push(v.x, v.y, v.z); }
      if (mirrored) t.push(...t.splice(3, 3)); // swap v2/v3
      tris.push(t); if (ds) doubleSided++;
    }
  }
});
fs.writeFileSync(out, JSON.stringify({ frame: 'ldu', tris, doubleSided, mirroredMeshes }));
