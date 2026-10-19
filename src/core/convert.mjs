// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// High-level conversion shared by the CLI and the web app.

import { Resolver, flatten, splitMpd, parseColours } from './ldraw.mjs';
import { toPrintSpace, placeOnPlate, buildShells, summarise } from './mesh.mjs';
import { collectCredits, creditsText, stlLabel } from './credits.mjs';
import { encodeStl, shellTriangles } from './stl.mjs';
import { build3mf } from './threemf.mjs';
import { colourInfo } from './ldraw.mjs';

export const VERSION = '0.1.0';
export const REPO_URL = 'https://github.com/CrispStrobe/ldraw-stl';

let colourCache = new WeakMap();
export async function libraryColours(library) {
  if (!colourCache.has(library)) {
    colourCache.set(library, library.has('ldconfig.ldr') ? parseColours(await library.read('ldconfig.ldr')) : new Map());
  }
  return colourCache.get(library);
}

// input: { part: '3001.dat' } for a library part, or { text, name } for a model file
// (.ldr/.mpd/.dat). local: extra files by name (e.g. uploaded sub-models); loadLocal:
// async (ref) -> text | null for files next to a model on disk.
export async function convert(library, input, {
  colour = '16', scale = 1, hires = false, repair = true, weldMm = 0.015, local = new Map(), loadLocal = null, libraryDate = '',
} = {}) {
  let rootLines;
  let base;
  const files = new Map(local);
  if (input.part) {
    base = input.part.replace(/\.dat$/i, '');
    rootLines = [`1 ${colour} 0 0 0 1 0 0 0 1 0 0 0 1 ${input.part}`];
  } else {
    base = (input.name ?? 'model').replace(/\.(ldr|mpd|dat)$/i, '');
    const mpd = /^\s*0\s+FILE\s/m.test(input.text) ? splitMpd(input.text) : null;
    if (mpd) for (const [k, v] of mpd.files) files.set(k, v);
    const body = mpd ? mpd.files.get(mpd.main) : input.text;
    files.set('__root__', body);
    rootLines = [`1 ${colour} 0 0 0 1 0 0 0 1 0 0 0 1 __root__`];
  }
  const resolver = new Resolver(library, { hires, local: files, loadLocal });
  await resolver.prefetch(rootLines);
  const stats = { uncertified: 0 };
  const missing = new Set();
  const names = new Map([[0, base]]);
  const ldu = flatten(resolver, rootLines, { stats, missing, names });
  if (!ldu.length) {
    throw new Error(missing.size ? `not found in the library: ${[...missing].join(', ')}` : 'the model has no surfaces');
  }
  const tris = placeOnPlate(toPrintSpace(ldu, scale));
  const shells = buildShells(tris, { names, base, scale, weldMm, repair });
  const colours = await libraryColours(library);
  const used = resolver.usedFiles().filter((f) => f.name !== '__root__');
  const credits = collectCredits(used);
  const meta = { title: base, toolUrl: REPO_URL, tool: `ldraw-stl ${VERSION}`, libraryDate };
  return {
    base,
    shells,
    colours,
    credits,
    creditsText: creditsText(credits, meta),
    summary: summarise(shells),
    uncertifiedFaces: stats.uncertified,
    missing: [...missing],
  };
}

export function toStl(result) {
  return encodeStl(shellTriangles(result.shells), stlLabel(result.credits));
}

// One STL per colour (each part goes whole to its dominant colour).
export function toStlPerColour(result) {
  const groups = new Map();
  for (const s of result.shells) { if (!groups.has(s.colour)) groups.set(s.colour, []); groups.get(s.colour).push(s); }
  return [...groups].map(([code, shells]) => {
    const info = colourInfo(result.colours, code);
    return {
      code,
      colour: info,
      name: `${result.base}-${info.name.replace(/[^\w-]+/g, '_')}.stl`,
      bytes: encodeStl(shellTriangles(shells), stlLabel(result.credits)),
      summary: summarise(shells),
    };
  });
}

export function to3mfEntries(result, { pure = false } = {}) {
  return build3mf(result.shells, result.colours, { title: result.base, pure, credits: result.credits, creditsText: result.creditsText });
}
