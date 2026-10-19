#!/usr/bin/env node
// End-to-end smoke test of the built site (dist/ with the library mirror) in Chromium.
//
//   node test/e2e/smoke.mjs [dist] [--no-ranges] [--screenshots dir]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readZipDirectory } from '../../src/core/zip.mjs';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const noRanges = args.includes('--no-ranges');
const shotsAt = args.indexOf('--screenshots');
const shots = shotsAt >= 0 ? args.splice(shotsAt, 2)[1] : null;
const dist = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'dist'));
const port = 18000 + Math.floor(Math.random() * 2000);

const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), dist, String(port), ...(noRanges ? ['--no-ranges'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve) => server.stdout.once('data', resolve));

const unzip = (buf) => {
  const bytes = new Uint8Array(buf);
  const out = new Map();
  for (const [name, e] of readZipDirectory(bytes)) {
    const data = bytes.subarray(e.dataStart, e.dataStart + e.csize);
    out.set(name, e.method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
  }
  return out;
};

const browser = await chromium.launch();
const failures = [];
const steps = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); steps.push(`ok   ${name} (${Date.now() - t0} ms)`); }
  catch (err) { failures.push(name); steps.push(`FAIL ${name}: ${err.message.split('\n')[0]}`); }
};

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1360, height: 860 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const dims = () => page.locator('#dims').textContent();
  const waitDims = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#dims').textContent), re.source, { timeout: 30000 });
  const grab = async (selector) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
    return { name: dl.suggestedFilename(), bytes: fs.readFileSync(await dl.path()) };
  };

  await step('library loads', async () => {
    await page.goto(`http://localhost:${port}/`);
    await page.waitForFunction(() => /parts/.test(document.querySelector('#lib-status').textContent), null, { timeout: 30000 });
  });
  await step('default part 3001 converts at 1:1', async () => {
    await waitDims(/32\.0 × 16\.0 × 11\.2 mm/);
    assert.match(await page.locator('#status').textContent(), /1\/1 parts closed/);
  });
  await step('search autocompletes and loads a part', async () => {
    await page.fill('#search', 'hair tousled side parting');
    await page.waitForSelector('#results li[data-part="62810"]');
    await page.click('#results li[data-part="62810"]');
    await waitDims(/11\.8 × 13\.3 × 10\.4 mm/);
  });
  await step('STL + credits download', async () => {
    const { name, bytes } = await grab('#downloads [data-kind=stl]');
    assert.equal(name, '62810.zip');
    const files = unzip(bytes);
    const stl = files.get('62810.stl');
    assert.ok(stl && stl.length === 84 + 50 * stl.readUInt32LE(80), 'valid binary STL');
    assert.match(files.get('62810.credits.txt').toString(), /CC BY 4\.0[\s\S]*parts\/62810\.dat/);
  });
  await step('minifig builder', async () => {
    await page.click('[role=tab][data-tab=minifig]');
    await waitDims(/24\.9 × 16\.1 × 41\.9 mm/);
    assert.match(await page.locator('#status').textContent(), /10\/10 parts closed/);
    await page.click('#slot-headwear');
    await page.fill('#slot-headwear', 'hair male');
    await page.waitForSelector('#slot-headwear-list li');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /3901/.test(location.hash), null, { timeout: 10000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'minifig.png') });
  });
  await step('3MF download carries colours and credits', async () => {
    const { name, bytes } = await grab('#downloads [data-kind="3mf"]');
    assert.equal(name, 'minifig.3mf');
    const files = unzip(bytes);
    const model = files.get('3D/3dmodel.model').toString();
    assert.match(model, /<basematerials id="1">/);
    assert.match(model, /name="LicenseTerms"/);
    assert.match(files.get('Metadata/credits.txt').toString(), /3626cp01\.dat/);
  });
  await step('LDraw model download', async () => {
    const { bytes } = await grab('#dl-ldr');
    assert.match(bytes.toString(), /^1 \d+ 0 -24 0 1 0 0 0 1 0 0 0 1 3901\.dat$/m);
  });
  await step('open an LDraw file', async () => {
    await page.click('[role=tab][data-tab=file]');
    await page.setInputFiles('#file-input', path.join(root, 'examples/minifig-plain.ldr'));
    await waitDims(/24\.9 × 14\.8 × 40\.0 mm/);
  });
  await step('open an STL, get an LDraw part', async () => {
    await page.click('[role=tab][data-tab=part]');
    await page.fill('#search', '3001');
    await page.click('#results li[data-part="3001"]');
    await waitDims(/32\.0 × 16\.0 × 11\.2 mm/);
    const { bytes } = await grab('#downloads [data-kind=stl-only]');
    const tmp = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'smoke-')), '3001.stl');
    fs.writeFileSync(tmp, bytes);
    await page.click('[role=tab][data-tab=file]');
    await page.setInputFiles('#file-input', tmp);
    await page.waitForSelector('#dl-dat:not([hidden])');
    const dat = await grab('#dl-dat');
    assert.match(dat.bytes.toString(), /^0 BFC CERTIFY CCW/m);
    assert.doesNotMatch(dat.bytes.toString(), /!LICENSE/, 'no licence is invented for a user file');
  });
  await step('About dialog and offline licence texts', async () => {
    await page.click('#about-btn');
    const text = await page.locator('dialog.about').textContent();
    for (const s of ['Mozilla Public License 2.0', 'three.js', 'CC BY 4.0', 'Impressum', 'LDraw™']) assert.ok(text.includes(s), `About mentions ${s}`);
    const hrefs = await page.locator('dialog.about a[href^="licenses/"], dialog.about a[href^="library/"], dialog.about a[href="THIRD-PARTY-NOTICES.txt"]').evaluateAll((as) => as.map((a) => a.href));
    assert.ok(hrefs.length >= 6);
    for (const href of hrefs) assert.equal((await page.request.get(href)).status(), 200, href);
    if (shots) await page.screenshot({ path: path.join(shots, 'about.png') });
    await page.keyboard.press('Escape');
  });
  await step('German interface', async () => {
    await page.selectOption('#lang', 'de');
    assert.equal(await page.locator('[data-tab=minifig]').textContent(), 'Minifigur');
    await page.selectOption('#lang', 'en');
  });
  await step('installable: manifest, icons, service worker', async () => {
    const manifest = await (await page.request.get(`http://localhost:${port}/manifest.webmanifest`)).json();
    for (const k of ['name', 'short_name', 'start_url', 'display', 'icons']) assert.ok(manifest[k], `manifest.${k}`);
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    for (const icon of manifest.icons) assert.equal((await page.request.get(`http://localhost:${port}/${icon.src}`)).status(), 200, icon.src);
    assert.ok(await page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active)));
  });
  await step('works offline with the models already used', async () => {
    await page.click('[role=tab][data-tab=minifig]');
    await waitDims(/41\.\d mm/);
    const hash = await page.evaluate(() => location.hash);
    await context.setOffline(true);
    try {
      await page.goto(`http://localhost:${port}/${hash}`);
      await waitDims(/41\.\d mm/);
      assert.match(await page.locator('#status').textContent(), /parts closed/);
    } finally { await context.setOffline(false); }
  });
  await step('whole library stored for offline use', async () => {
    await page.click('#offline summary');
    await page.click('#offline-get');
    await page.waitForFunction(() => /whole library/i.test(document.querySelector('#offline-status').textContent), null, { timeout: 180000 });
    await context.setOffline(true);
    try {
      await page.goto(`http://localhost:${port}/#part=3005`); // never viewed in this session
      await page.reload();
      await waitDims(/8\.0 × 8\.0 × 11\.2 mm/);
    } finally { await context.setOffline(false); }
    await page.click('#offline summary');
    await page.click('#offline-drop');
    await page.waitForFunction(() => !/whole library/i.test(document.querySelector('#offline-status').textContent));
  });
  await step('phone width has no horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[role=tab][data-tab=part]');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page is ${overflow}px wider than the screen`);
    if (shots) await page.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });
  });
  await step('no page errors', async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  server.kill();
}

console.log(`${noRanges ? '[no ranges] ' : ''}${steps.join('\n')}`);
if (failures.length) { console.error(`${failures.length} step(s) failed`); process.exit(1); }
