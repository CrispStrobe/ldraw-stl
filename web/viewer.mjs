// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// three.js preview of the converted shells: the exact triangles that go into the download,
// coloured per triangle, standing on a millimetre grid (Z up, like the slicer).

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(1, -1.5, 2.5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-2, 1.5, 0.5);
    this.scene.add(fill);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.applyTheme();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  applyTheme() {
    const css = getComputedStyle(document.documentElement);
    this.scene.background = new THREE.Color(css.getPropertyValue('--viewer-bg').trim() || '#eef0f3');
    this.gridColours = [css.getPropertyValue('--grid-major').trim() || '#9aa3ad', css.getPropertyValue('--grid-minor').trim() || '#d3d8de'];
    if (this.lastSize) this.setPlate(this.lastSize);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPlate(size) {
    this.lastSize = size;
    if (this.plate) { this.scene.remove(this.plate); this.plate.traverse((o) => o.geometry?.dispose()); }
    const extent = Math.max(20, Math.ceil(Math.max(size[0], size[1]) * 1.6 / 10) * 10);
    const plate = new THREE.Group();
    const minor = new THREE.GridHelper(extent, extent, this.gridColours[1], this.gridColours[1]);
    const major = new THREE.GridHelper(extent, extent / 10, this.gridColours[0], this.gridColours[0]);
    for (const g of [minor, major]) { g.rotation.x = Math.PI / 2; plate.add(g); }
    major.position.z = 0.01;
    this.plate = plate;
    this.scene.add(plate);
  }

  // shells: [{ mesh: { verts, faces: [a, b, c, colourCode] } }], colourOf(code) -> '#rrggbb'
  show(shells, colourOf) {
    for (const child of [...this.group.children]) { this.group.remove(child); child.geometry.dispose(); }
    let count = 0;
    for (const { mesh } of shells) count += mesh.faces.length;
    const pos = new Float32Array(count * 9);
    const col = new Float32Array(count * 9);
    const c = new THREE.Color();
    const cache = new Map();
    let o = 0;
    for (const { mesh } of shells) {
      for (const [a, b, d, code] of mesh.faces) {
        if (!cache.has(code)) cache.set(code, c.set(colourOf(code)).toArray());
        const rgb = cache.get(code);
        for (const i of [a, b, d]) {
          pos.set(mesh.verts[i], o);
          col.set(rgb, o);
          o += 3;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.computeVertexNormals(); // non-indexed: flat face normals
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0 });
    this.group.add(new THREE.Mesh(geometry, material));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = box.getSize(new THREE.Vector3()).toArray();
    this.setPlate(size);
    this.frameBox(box);
    return size;
  }

  frameBox(box) {
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 10;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360) * 1.15;
    this.camera.position.copy(centre).add(new THREE.Vector3(0.9, -1.6, 0.9).normalize().multiplyScalar(dist));
    this.camera.near = dist / 100;
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(centre);
    this.controls.update();
  }

  clear() {
    for (const child of [...this.group.children]) { this.group.remove(child); child.geometry.dispose(); }
  }
}
