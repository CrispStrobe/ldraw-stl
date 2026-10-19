// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// 3MF package: one mesh object per part, grouped as components of one object.
// Colours are kept per triangle (prints survive) as core-spec basematerials, and as slicer
// filament painting (Bambu/Orca `paint_color`, PrusaSlicer `slic3rpe:mmu_segmentation`):
// filament 1 is the colour with the largest area, then descending.

import { colourInfo } from './ldraw.mjs';
import { normal } from './mesh.mjs';

const xmlEscape = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// Per-triangle filament state of a whole (unsplit) triangle, as PrusaSlicer serialises it:
// state 1 -> "4", 2 -> "8", n >= 3 -> hex(n - 3) followed by "C". State 0 = object default.
export function paintCode(state) {
  if (state <= 0) return '';
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  return `${(state - 3).toString(16).toUpperCase()}C`;
}

export function filamentOrder(shells) {
  const area = new Map();
  for (const { mesh } of shells) {
    for (const [a, b, c, col] of mesh.faces) {
      const n = normal([...mesh.verts[a], ...mesh.verts[b], ...mesh.verts[c]]);
      area.set(col, (area.get(col) || 0) + (n ? n[3] : 0));
    }
  }
  return [...area].sort((x, y) => y[1] - x[1]).map(([code]) => code);
}

// Returns zip entries; the caller packs them (createZip).
export function build3mf(shells, colours, { title = 'model', pure = false, credits = null, creditsText = '' } = {}) {
  const order = filamentOrder(shells);
  const index = new Map(order.map((code, i) => [code, i]));
  const f = (x) => (Math.round(x * 1e5) / 1e5).toString();
  const materials = order.map((code) => {
    const { name, hex } = colourInfo(colours, code);
    return `   <base name="${xmlEscape(name)}" displaycolor="#${hex}FF"/>`;
  });
  const objects = [];
  const components = [];
  let id = 2;
  for (const shell of shells) {
    const { mesh } = shell;
    const vs = mesh.verts.map((v) => `     <vertex x="${f(v[0])}" y="${f(v[1])}" z="${f(v[2])}"/>`);
    const ts = mesh.faces.map(([a, b, c, col]) => {
      const m = index.get(col);
      const paint = paintCode(m >= 16 ? 0 : m); // slicers stop at 16 filaments
      const extra = pure || !paint ? '' : ` paint_color="${paint}" slic3rpe:mmu_segmentation="${paint}"`;
      return `     <triangle v1="${a}" v2="${b}" v3="${c}" pid="1" p1="${m}"${extra}/>`;
    });
    const name = `${shell.name} (${colourInfo(colours, shell.colour).name})`;
    objects.push(`  <object id="${id}" type="model" name="${xmlEscape(name)}" pid="1" pindex="${index.get(shell.colour)}">\n   <mesh>\n    <vertices>\n${vs.join('\n')}\n    </vertices>\n    <triangles>\n${ts.join('\n')}\n    </triangles>\n   </mesh>\n  </object>`);
    components.push(`    <component objectid="${id}"/>`);
    id++;
  }
  objects.push(`  <object id="${id}" type="model" name="${xmlEscape(title)}">\n   <components>\n${components.join('\n')}\n   </components>\n  </object>`);
  const meta = [['Title', title], ['Application', 'ldraw-stl']];
  if (credits?.library.length) {
    meta.push(
      ['Designer', credits.authors.join(', ')],
      ['LicenseTerms', `Adapted from the LDraw.org Parts Library under ${credits.licenses.join(' and ')}; full credits in Metadata/credits.txt`],
      ['Copyright', `LDraw.org Parts Library authors: ${credits.authors.join(', ')}`],
    );
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
${meta.map(([k, v]) => ` <metadata name="${k}">${xmlEscape(v)}</metadata>`).join('\n')}
 <resources>
  <basematerials id="1">
${materials.join('\n')}
  </basematerials>
${objects.join('\n')}
 </resources>
 <build>
  <item objectid="${id}"/>
 </build>
</model>
`;
  const entries = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="txt" ContentType="text/plain"/>
</Types>
`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`],
    ['3D/3dmodel.model', model],
  ];
  if (creditsText) entries.push(['Metadata/credits.txt', creditsText]);
  return { entries, filaments: order.map((code, i) => ({ filament: i + 1, code, ...colourInfo(colours, code) })) };
}
