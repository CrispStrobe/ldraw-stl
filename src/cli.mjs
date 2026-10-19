#!/usr/bin/env node
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// ldraw-stl: LDraw <-> STL/3MF converter.
//
//   ldraw-stl dat2stl <model.ldr|model.mpd|part.dat|library part> [-o out.stl|out.3mf] [options]
//   ldraw-stl stl2dat <in.stl> [-o out.dat] [options]
//   ldraw-stl find <regex>
//
// The library is the official complete.zip (read in place) or an extracted LDraw directory.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { openLibrary } from './node/library.mjs';
import { convert, toStl, toStlPerColour, to3mfEntries, VERSION } from './core/convert.mjs';
import { createZip } from './core/zip.mjs';
import { decodeStl } from './core/stl.mjs';
import { stlToDat } from './core/dat.mjs';

const FLAGS = new Set(['pure-3mf', 'split-colors', 'hires', 'no-repair', 'no-credits', 'condlines', 'json', 'help', 'h', 'version']);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) { opts._.push(a); continue; }
    const key = a.replace(/^-+/, '');
    if (FLAGS.has(key)) opts[key] = true;
    else opts[key] = argv[++i];
  }
  return opts;
}

const write = (file, bytes) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, bytes);
};

async function dat2stl(opts) {
  const input = opts._[0];
  if (!input) throw new Error('dat2stl: missing input file or part name');
  const lib = openLibrary(opts.lib);
  const options = {
    colour: opts.color ?? '16',
    scale: Number(opts.scale ?? 1),
    hires: !!opts.hires,
    repair: !opts['no-repair'],
    weldMm: Number(opts.weld ?? 0.015),
  };
  let result;
  if (fs.existsSync(input)) {
    const dir = path.dirname(path.resolve(input));
    const loadLocal = async (ref) => {
      const f = path.join(dir, ref.replace(/\\/g, '/'));
      return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.readFileSync(f, 'utf8') : null;
    };
    result = await convert(lib, { text: fs.readFileSync(input, 'utf8'), name: path.basename(input) }, { ...options, loadLocal });
  } else {
    result = await convert(lib, { part: input }, options);
  }
  const out = opts.o ?? opts.out ?? `${result.base}.stl`;
  const report = { input, library: lib.describe(), scale: options.scale, outputs: [], uncertifiedFaces: result.uncertifiedFaces, missing: result.missing };
  if (/\.3mf$/i.test(out)) {
    const { entries, filaments } = to3mfEntries(result, { pure: !!opts['pure-3mf'] });
    write(out, await createZip(entries, (d) => zlib.deflateRawSync(d, { level: 9 })));
    report.outputs.push({ file: out, ...result.summary, filaments });
  } else if (opts['split-colors']) {
    for (const part of toStlPerColour(result)) {
      const file = path.join(path.dirname(out), part.name.replace(result.base, path.basename(out).replace(/\.stl$/i, '')));
      write(file, part.bytes);
      report.outputs.push({ file, ...part.summary });
    }
  } else {
    write(out, toStl(result));
    report.outputs.push({ file: out, ...result.summary });
  }
  // CC BY: the credits travel with every mesh made from library files (a 3MF carries them inside)
  if (!opts['no-credits'] && result.credits.library.length && !/\.3mf$/i.test(out)) {
    const creditsFile = out.replace(/\.stl$/i, '') + '.credits.txt';
    write(creditsFile, result.creditsText);
    report.credits = creditsFile;
  }
  return report;
}

function stl2dat(opts) {
  const input = opts._[0];
  if (!input) throw new Error('stl2dat: missing input .stl');
  const out = opts.o ?? opts.out ?? `${path.basename(input).replace(/\.stl$/i, '')}.dat`;
  const { text, report } = stlToDat(decodeStl(new Uint8Array(fs.readFileSync(input))), {
    scale: Number(opts.scale ?? 1),
    colour: opts.color ?? '16',
    edgeAngle: Number(opts['edge-angle'] ?? 30),
    condlines: !!opts.condlines,
    origin: opts.origin ?? 'bottom-center',
    title: opts.title ?? path.basename(input).replace(/\.stl$/i, ''),
    name: path.basename(out),
    author: opts.author ?? 'ldraw-stl',
    license: opts.license ?? null,
    source: path.basename(input),
  });
  write(out, text);
  return { input, output: out, ...report };
}

function find(opts) {
  const re = new RegExp(opts._[0] ?? '.', 'i');
  const lib = openLibrary(opts.lib);
  const hits = [];
  for (const rel of lib.list()) {
    if (!/^parts\/[^/]+\.dat$/.test(rel)) continue;
    const title = lib.read(rel).split(/\r?\n/, 1)[0].replace(/^0\s*/, '');
    const name = rel.slice(6);
    if (re.test(title) || re.test(name)) hits.push(`${name.padEnd(22)} ${title}`);
  }
  return hits.sort().join('\n');
}

const USAGE = `ldraw-stl ${VERSION}
usage:
  ldraw-stl dat2stl <model.ldr|model.mpd|part.dat|library part> [-o out.stl|out.3mf] [--scale N]
            [--color CODE] [--split-colors] [--pure-3mf] [--hires] [--no-repair] [--weld MM]
            [--no-credits] [--lib dir|complete.zip] [--json]
  ldraw-stl stl2dat <in.stl> [-o out.dat] [--scale N] [--color CODE] [--title T] [--author A]
            [--license "Licensed under CC BY 4.0 : see CAreadme.txt"] [--edge-angle DEG]
            [--condlines] [--origin bottom-center|keep] [--json]
  ldraw-stl find <regex> [--lib ...]

Meshes are in millimetres at 1:1 (1 LDU = 0.4 mm), Z up, standing on the plate.
Library parts are CC BY: dat2stl writes <out>.credits.txt next to every STL (a 3MF carries
the credits inside); keep it with the mesh when you share it.`;

function formatReport(r) {
  const lines = [];
  for (const o of r.outputs ?? []) {
    lines.push(`${o.file}: ${o.triangles} triangles, ${o.sizeMm.join(' x ')} mm, ` +
      `${o.closedShells}/${o.shells} part shells watertight, ${o.holesCapped} holes capped`);
    if (o.filaments) lines.push(`  filaments: ${o.filaments.map((x) => `${x.filament}=${x.name} #${x.hex}`).join(', ')}`);
    for (const s of o.openShells) {
      lines.push(`  open shell ${s.name} (colour ${s.colour}${s.volume <= 0 ? ', INSIDE OUT' : ''}): boundary ${s.boundaryEdges}, non-manifold ${s.nonManifoldEdges}, mis-oriented ${s.inconsistentlyOrientedEdges}`);
    }
  }
  if (r.credits) lines.push(`credits: ${r.credits}`);
  if (r.output) {
    lines.push(`${r.output}: ${r.triangles} triangles, ${r.sizeMm.join(' x ')} mm, ` +
      (r.watertight ? 'watertight' : `NOT watertight (boundary ${r.boundaryEdges}, non-manifold ${r.nonManifoldEdges}, mis-oriented ${r.inconsistentlyOrientedEdges})`) +
      `, ${r.edgeLines} edge lines, ${r.conditionalLines} conditional lines`);
  }
  if (r.uncertifiedFaces) lines.push(`note: ${r.uncertifiedFaces} faces came from non-BFC-certified files (winding as authored)`);
  if (r.missing?.length) lines.push(`MISSING subfiles: ${r.missing.join(', ')}`);
  return lines.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (cmd === '--version' || opts.version) { console.log(VERSION); return; }
  if (!cmd || cmd === '--help' || opts.help || opts.h) { console.log(USAGE); return; }
  if (cmd === 'find') { console.log(find(opts)); return; }
  const result = cmd === 'dat2stl' ? await dat2stl(opts) : cmd === 'stl2dat' ? stl2dat(opts) : null;
  if (!result) { console.error(USAGE); process.exit(2); }
  console.log(opts.json ? JSON.stringify(result, null, 2) : formatReport(result));
  if (result.missing?.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`ldraw-stl: ${err.message}`);
  process.exit(2);
});
