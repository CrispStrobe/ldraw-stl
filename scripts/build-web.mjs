#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Assemble the static site in dist/: the app, the shared core, three.js and the licence texts.
// The library mirror is built separately (build-library.mjs) into dist/library/.
//
//   node scripts/build-web.mjs [dist]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const three = path.join(root, 'node_modules/three');
const threePkg = JSON.parse(fs.readFileSync(path.join(three, 'package.json'), 'utf8'));

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
};

for (const entry of fs.readdirSync(dist, { withFileTypes: true }).filter((e) => e.name !== 'library')) {
  fs.rmSync(path.join(dist, entry.name), { recursive: true, force: true });
}
fs.mkdirSync(dist, { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'web'))) copy(path.join(root, 'web', f), path.join(dist, f));
for (const f of fs.readdirSync(path.join(root, 'src/core'))) copy(path.join(root, 'src/core', f), path.join(dist, 'core', f));
copy(path.join(three, 'build/three.module.min.js'), path.join(dist, 'vendor/three/three.module.min.js'));
copy(path.join(three, 'examples/jsm/controls/OrbitControls.js'), path.join(dist, 'vendor/three/addons/controls/OrbitControls.js'));
copy(path.join(three, 'LICENSE'), path.join(dist, 'licenses/three.js.MIT.txt'));
copy(path.join(root, 'LICENSE'), path.join(dist, 'licenses/ldraw-stl.MPL-2.0.txt'));
copy(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(dist, 'THIRD-PARTY-NOTICES.txt'));
fs.writeFileSync(path.join(dist, 'version.json'), JSON.stringify({
  version: pkg.version,
  commit: process.env.GITHUB_SHA ?? 'dev',
  builtAt: new Date().toISOString(),
  three: threePkg.version,
}, null, 2));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// The page must only use relative URLs (it is served from /ldraw-stl/ on GitHub Pages).
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (/(src|href)="\//.test(html)) throw new Error('index.html contains a root-relative URL');
if (threePkg.version !== pkg.devDependencies.three) throw new Error(`three ${threePkg.version} installed, ${pkg.devDependencies.three} pinned`);
console.log(`web: ${dist} (three ${threePkg.version}, commit ${process.env.GITHUB_SHA ?? 'dev'})`);
