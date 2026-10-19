#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Render the PNG app icons from web/icon.svg (run after changing the SVG; outputs are committed).
//
//   node scripts/make-icons.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'web/icon.svg'), 'utf8');
const out = path.join(root, 'web/icons');
fs.mkdirSync(out, { recursive: true });
// [file, size, inner scale, background]; maskable icons keep the motif inside the 80% safe zone
const ICONS = [
  ['icon-192.png', 192, 0.9, null],
  ['icon-512.png', 512, 0.9, null],
  ['maskable-512.png', 512, 0.62, '#f6f7f9'],
  ['apple-touch-icon.png', 180, 0.72, '#f6f7f9'],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, scale, bg] of ICONS) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg ?? 'transparent'}">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: !bg });
  console.log(file);
}
await browser.close();
