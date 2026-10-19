// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { openMirror, deflateRaw } from './library.mjs';
import { Catalog } from './catalog.mjs';
import { Viewer } from './viewer.mjs';
import { t, setLanguage, language, number } from './i18n.mjs';
import { openAbout } from './about.mjs';
import { convert, toStl, toStlPerColour, to3mfEntries, VERSION } from './core/convert.mjs';
import { createZip } from './core/zip.mjs';
import { decodeStl } from './core/stl.mjs';
import { stlToDat } from './core/dat.mjs';
import { colourInfo } from './core/ldraw.mjs';

const $ = (sel) => document.querySelector(sel);
const state = {
  library: null,
  catalog: null,
  colours: new Map(),
  tab: 'part',
  part: '3001',
  minifig: { headwear: '62810', head: '3626cp01', torso: '76382p07', legs: '73200b-f1' },
  minifigColours: { headwear: '0', head: '14', torso: '1', legs: '0' },
  file: null, // { name, text, local: Map }
  result: null,
  model: null, // { kind, base, ldr? }
  fetched: 0,
  run: 0,
};
const SLOTS = [
  { key: 'headwear', y: -24, filter: (p) => p.category === 'Minifig Headwear' },
  { key: 'head', y: -24, filter: (p) => /^Minifig Head\b/.test(p.title) },
  { key: 'torso', y: 0, filter: (p) => /^Minifig Torso with Arms/.test(p.title) },
  { key: 'legs', y: 32, filter: (p) => /^Minifig Hips and Legs/.test(p.title) },
];

let version = { version: VERSION, commit: 'dev', builtAt: '' };
let viewer;

// ------------------------------------------------------------------ text

function applyTexts() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-label]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nLabel)); });
  $('#lang').value = language();
  if (state.library) libraryStatus();
  if (state.catalog) { fillCategories(); renderResults(); }
  if (state.result) report(state.result);
}

function libraryStatus() {
  const m = state.library.manifest;
  $('#lib-status').textContent = t('library.ready', { date: m.source.date, parts: m.partCount.toLocaleString(language()) });
}

// ------------------------------------------------------------------ search

function fillCategories() {
  const sel = $('#category');
  const current = sel.value;
  sel.replaceChildren(new Option(t('search.all'), ''), ...state.catalog.categories.map((c) => new Option(c, c)));
  sel.value = current;
}

function renderResults() {
  const { total, results } = state.catalog.search($('#search').value, {
    category: $('#category').value,
    hidden: $('#hidden').checked,
    limit: 80,
  });
  const list = $('#results');
  list.replaceChildren(...results.map((p) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.dataset.part = p.name;
    li.setAttribute('aria-selected', String(p.name === state.part));
    li.innerHTML = '<span class="num"></span><span class="title"></span>';
    li.querySelector('.num').textContent = p.name;
    li.querySelector('.title').textContent = p.title;
    li.title = `${p.name}: ${p.title} (${p.category})`;
    return li;
  }));
  $('#result-count').textContent = results.length ? t('search.count', { shown: results.length, total }) : t('search.none');
}

function choosePart(name) {
  state.part = name;
  document.querySelectorAll('#results li').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.part === name)));
  setHash();
  schedule();
}

// A text field with a pop-up list of catalog matches (minifig slots).
function picker(input, list, filter, onPick) {
  let items = [];
  let active = -1;
  const render = () => {
    items = state.catalog.search(input.value, { filter, limit: 40 }).results;
    list.replaceChildren(...items.map((p, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `${list.id}-${i}`;
      li.setAttribute('aria-selected', String(i === active));
      li.innerHTML = '<span class="num"></span><span class="title"></span>';
      li.querySelector('.num').textContent = p.name;
      li.querySelector('.title').textContent = p.title;
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(i); });
      return li;
    }));
    list.hidden = !items.length;
    input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const pick = (i) => {
    const p = items[i];
    if (!p) return;
    input.value = `${p.name} ${p.title}`;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    onPick(p.name);
  };
  input.addEventListener('focus', () => { input.select(); active = -1; render(); });
  input.addEventListener('input', () => { active = -1; render(); });
  input.addEventListener('blur', () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) render();
      active = Math.max(0, Math.min(items.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      list.children[active]?.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    } else if (e.key === 'Enter') { e.preventDefault(); pick(Math.max(0, active)); }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
}

// ------------------------------------------------------------------ colours

function colourOptions(select, value, { none = false } = {}) {
  const solid = [...state.colours].filter(([, c]) => c.alpha === 255);
  const other = [...state.colours].filter(([, c]) => c.alpha !== 255);
  const opts = [...solid, ...other].map(([code, c]) => {
    const o = new Option(`${c.name.replace(/_/g, ' ')} (${code})`, code);
    o.style.setProperty('--swatch', `#${c.hex}`);
    return o;
  });
  if (none) opts.unshift(new Option(t('minifig.none'), ''));
  select.replaceChildren(...opts);
  select.value = value;
  const swatch = () => select.style.setProperty('--swatch', `#${state.colours.get(select.value)?.hex ?? 'A0A5A9'}`);
  select.addEventListener('change', swatch);
  swatch();
}

const hexOf = (code) => `#${colourInfo(state.colours, code).hex}`;

// ------------------------------------------------------------------ conversion

function minifigLdr() {
  const lines = ['0 Minifig', '0 Name: minifig.ldr', '0 Author: ldraw-stl web app', '0 BFC CERTIFY CCW'];
  for (const s of SLOTS) {
    const part = state.minifig[s.key];
    if (part) lines.push(`1 ${state.minifigColours[s.key]} 0 ${s.y} 0 1 0 0 0 1 0 0 0 1 ${part}.dat`);
  }
  return lines.join('\n') + '\n';
}

let timer = 0;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 60);
}

async function run() {
  if (!state.library) return;
  const id = ++state.run;
  const options = {
    colour: $('#colour').value || '16',
    scale: Number($('#scale').value) || 1,
    hires: $('#hires').checked,
    repair: $('#repair').checked,
    libraryDate: state.library.manifest.source.date,
  };
  let input;
  let model;
  if (state.tab === 'minifig') {
    const ldr = minifigLdr();
    input = { text: ldr, name: 'minifig.ldr' };
    model = { kind: 'minifig', base: 'minifig', ldr };
    options.colour = '16';
  } else if (state.tab === 'file') {
    if (!state.file || state.file.stl) return;
    input = { text: state.file.text, name: state.file.name };
    options.local = state.file.local;
    model = { kind: 'file', base: state.file.name.replace(/\.\w+$/, '') };
  } else {
    if (!state.part) return;
    input = { part: `${state.part}.dat` };
    model = { kind: 'part', base: state.part };
  }
  const before = state.fetched;
  const tick = setInterval(() => {
    if (state.fetched > before) setStatus(t('status.loading', { n: state.fetched - before }));
  }, 150);
  setStatus(t('status.converting'));
  setDownloads(false);
  try {
    const result = await convert(state.library, input, options);
    if (id !== state.run) return;
    state.result = result;
    state.model = model;
    viewer.show(result.shells, hexOf);
    report(result);
    setDownloads(true);
  } catch (err) {
    if (id !== state.run) return;
    state.result = null;
    viewer.clear();
    $('#dims').textContent = '';
    setStatus(err.message, true);
  } finally {
    clearInterval(tick);
  }
}

function setStatus(text, error = false) {
  const s = $('#status');
  s.textContent = text;
  s.classList.toggle('error', error);
}

function report(r) {
  const [x, y, z] = r.summary.sizeMm.map((v) => number(v, 1));
  $('#dims').textContent = t('status.size', { x, y, z });
  const lines = [t('status.report', {
    tri: r.summary.triangles.toLocaleString(language()),
    closed: r.summary.closedShells,
    shells: r.summary.shells,
    vol: number(r.summary.volumeMm3 / 1000, 2),
  })];
  if (r.summary.openShells.length) lines.push(t('status.open', { n: r.summary.openShells.length }));
  if (r.missing.length) lines.push(t('status.missing', { list: r.missing.join(', ') }));
  setStatus(lines.join(' · '), r.missing.length > 0);
  const title = state.model.kind === 'part'
    ? `${state.part}: ${state.catalog.get(state.part)?.title ?? ''}`
    : state.model.kind === 'minifig' ? t('tab.minifig') : state.file?.name ?? '';
  $('#model-title').textContent = title;
  $('#credits-heading').textContent = t('credits.heading', { n: r.credits.library.length, authors: r.credits.authors.length });
  $('#credits').textContent = r.creditsText;
}

function setDownloads(on) {
  document.querySelectorAll('#downloads button').forEach((b) => { b.disabled = !on; });
  $('#dl-ldr').hidden = state.tab !== 'minifig';
}

// ------------------------------------------------------------------ downloads

function save(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function download(kind) {
  const r = state.result;
  if (!r) return;
  const base = state.model.base;
  const credits = [`${base}.credits.txt`, r.creditsText];
  if (kind === 'stl') save(await createZip([[`${base}.stl`, toStl(r)], credits], deflateRaw), `${base}.zip`, 'application/zip');
  if (kind === 'stl-only') save(toStl(r), `${base}.stl`, 'model/stl');
  if (kind === '3mf') save(await createZip(to3mfEntries(r).entries, deflateRaw), `${base}.3mf`, 'model/3mf');
  if (kind === 'split') {
    const files = toStlPerColour(r).map((p) => [p.name, p.bytes]);
    save(await createZip([...files, credits], deflateRaw), `${base}-colours.zip`, 'application/zip');
  }
  if (kind === 'ldr' && state.model.ldr) save(state.model.ldr, `${base}.ldr`, 'text/plain');
}

// ------------------------------------------------------------------ files

async function openFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const main = files.find((f) => /\.(ldr|mpd|stl)$/i.test(f.name)) ?? files[0];
  if (/\.stl$/i.test(main.name)) {
    const tris = decodeStl(new Uint8Array(await main.arrayBuffer()));
    const name = main.name.replace(/\.stl$/i, '.dat');
    const { text, report: rep } = stlToDat(tris, { name, title: main.name.replace(/\.stl$/i, ''), condlines: true, source: main.name });
    state.file = { name: main.name, stl: true };
    state.result = null;
    setDownloads(false);
    viewer.show([{ mesh: { verts: tris.flatMap((tr) => [tr.v.slice(0, 3), tr.v.slice(3, 6), tr.v.slice(6, 9)]), faces: tris.map((_, i) => [i * 3, i * 3 + 1, i * 3 + 2, '71']) } }], hexOf);
    $('#model-title').textContent = main.name;
    $('#dims').textContent = t('status.size', Object.fromEntries(['x', 'y', 'z'].map((k, i) => [k, number(rep.sizeMm[i], 1)])));
    $('#file-report').textContent = t('file.stlDone', { name: main.name, triangles: rep.triangles, size: rep.sizeMm.map((v) => number(v, 1)).join(' × '), edges: rep.edgeLines });
    const btn = $('#dl-dat');
    btn.hidden = false;
    btn.onclick = () => save(text, name, 'text/plain');
    setStatus('');
    return;
  }
  const local = new Map();
  for (const f of files) if (f !== main) local.set(f.name.toLowerCase(), await f.text());
  state.file = { name: main.name, text: await main.text(), local };
  $('#dl-dat').hidden = true;
  $('#file-report').textContent = '';
  schedule();
}

// ------------------------------------------------------------------ tabs and URL

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  $('#colour-row').hidden = tab === 'minifig';
  setHash();
  schedule();
}

function setHash() {
  const h = state.tab === 'minifig'
    ? `minifig=${SLOTS.map((s) => `${state.minifig[s.key] || ''}:${state.minifigColours[s.key]}`).join(',')}`
    : state.tab === 'part' ? `part=${encodeURIComponent(state.part)}` : 'file';
  history.replaceState(null, '', `#${h}`);
}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('part')) { state.tab = 'part'; state.part = h.get('part'); }
  if (h.has('minifig')) {
    state.tab = 'minifig';
    h.get('minifig').split(',').forEach((v, i) => {
      const [part, colour] = v.split(':');
      if (!SLOTS[i]) return;
      state.minifig[SLOTS[i].key] = part;
      if (colour) state.minifigColours[SLOTS[i].key] = colour;
    });
  }
  if (h.has('file')) state.tab = 'file';
}

// ------------------------------------------------------------------ start

async function start() {
  setLanguage(language());
  readHash();
  viewer = new Viewer($('#viewer'));
  $('#lang').addEventListener('change', (e) => { setLanguage(e.target.value); applyTexts(); });
  $('#about-btn').addEventListener('click', () => openAbout({ version, library: state.library?.manifest }));
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  applyTexts();
  fetch('version.json').then((r) => (r.ok ? r.json() : null)).then((v) => { if (v) version = v; }).catch(() => {});
  $('#lib-status').textContent = t('library.loading');
  try {
    const [library, catalogData, colours] = await Promise.all([
      openMirror('./library/', { onFetch: () => { state.fetched++; } }),
      fetch('./library/catalog.json').then((r) => r.json()),
      fetch('./library/colours.json').then((r) => r.json()),
    ]);
    state.library = library;
    state.catalog = new Catalog(catalogData);
    state.colours = new Map(colours.map(([code, name, hex, alpha]) => [code, { name, hex, alpha }]));
  } catch (err) {
    $('#lib-status').textContent = t('library.failed', { error: err.message });
    $('#lib-status').classList.add('error');
    return;
  }
  libraryStatus();
  fillCategories();
  colourOptions($('#colour'), '4');
  $('#search').addEventListener('input', renderResults);
  $('#category').addEventListener('change', renderResults);
  $('#hidden').addEventListener('change', renderResults);
  $('#results').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) choosePart(li.dataset.part); });
  $('#results').addEventListener('keydown', (e) => {
    const items = [...$('#results').children];
    const i = items.findIndex((li) => li === document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    if (e.key === 'Enter' && i >= 0) choosePart(items[i].dataset.part);
  });
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const first = $('#results li'); if (first) choosePart(first.dataset.part); }
    if (e.key === 'ArrowDown') { e.preventDefault(); $('#results li')?.focus(); }
  });
  new MutationObserver(() => document.querySelectorAll('#results li').forEach((li) => { li.tabIndex = -1; })).observe($('#results'), { childList: true });
  for (const s of SLOTS) {
    const input = $(`#slot-${s.key}`);
    const p = state.catalog.get(state.minifig[s.key] || '');
    input.value = p ? `${p.name} ${p.title}` : '';
    picker(input, $(`#slot-${s.key}-list`), s.filter, (name) => { state.minifig[s.key] = name; setHash(); schedule(); });
    input.addEventListener('change', () => { if (!input.value.trim()) { state.minifig[s.key] = ''; setHash(); schedule(); } });
    const sel = $(`#slot-${s.key}-colour`);
    colourOptions(sel, state.minifigColours[s.key]);
    sel.addEventListener('change', () => { state.minifigColours[s.key] = sel.value; setHash(); schedule(); });
  }
  for (const id of ['#colour', '#scale', '#hires', '#repair']) $(id).addEventListener('change', schedule);
  $('#file-input').addEventListener('change', (e) => openFiles(e.target.files));
  const drop = $('#viewer');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); });
  drop.addEventListener('drop', (e) => { e.preventDefault(); setTab('file'); openFiles(e.dataTransfer.files); });
  document.querySelectorAll('#downloads button[data-kind]').forEach((b) => b.addEventListener('click', () => download(b.dataset.kind)));
  $('#search').value = '';
  renderResults();
  setTab(state.tab);
}

start();
