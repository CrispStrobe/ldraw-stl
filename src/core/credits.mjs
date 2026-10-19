// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Attribution for meshes made from the LDraw.org Parts Library.
//
// Every library file is CC BY 4.0 or CC BY 2.0 + 4.0 (CAreadme.txt). A converted mesh is an
// adaptation (only 2D renders are exempt), so each output names, per source file: the
// creator, the licence with its URL, where the file comes from, and that it was modified.

export const LIBRARY_URL = 'https://library.ldraw.org';
export const LICENSE_URLS = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
};
export const TRADEMARKS =
  'Not affiliated with or endorsed by LDraw.org or the LEGO Group. LEGO(R) is a trademark of the ' +
  'LEGO Group. LDraw(TM) is a trademark of the Estate of James Jessiman.';

export const CHANGES =
  'The LDraw files were combined and converted to a triangle mesh in millimetres (1 LDU = 0.4 mm, ' +
  'Z up); vertices were welded, T-junctions split and open loops capped so that each part is a ' +
  'closed solid.';

const ORDER = ['parts/s/', 'parts/', 'p/48/', 'p/8/', 'p/', 'models/'];
const rank = (rel) => {
  const i = ORDER.findIndex((d) => rel.startsWith(d));
  return i === 1 ? 0 : i === 0 ? 1 : i < 0 ? 9 : i;
};

export function licencesOf(text) {
  return Object.keys(LICENSE_URLS).filter((l) => text?.includes(l));
}

export function collectCredits(usedFiles) {
  const library = usedFiles
    .filter((f) => f.source === 'library')
    .sort((a, b) => rank(a.rel) - rank(b.rel) || a.rel.localeCompare(b.rel))
    .map((f) => ({
      rel: f.rel,
      title: f.header.title,
      author: f.header.author ?? 'unknown',
      editors: f.header.editors,
      license: f.header.license ?? 'see CAreadme.txt',
      licenses: licencesOf(f.header.license),
      url: `${LIBRARY_URL}/library/official/${f.rel}`,
    }));
  // editors appear as bare usernames; show them as "Real Name [user]" where an author line knows them
  const fullName = new Map();
  for (const f of library) {
    const m = f.author.match(/^(.*?)\s*\[([^\]]+)\]$/);
    if (m && m[1]) fullName.set(m[2].toLowerCase(), f.author);
  }
  for (const f of library) {
    f.editors = [...new Set(f.editors.map((e) => fullName.get(e.toLowerCase()) ?? e))].filter((e) => e !== f.author);
  }
  const local = usedFiles.filter((f) => f.source === 'local').map((f) => ({ name: f.name, title: f.header.title, author: f.header.author }));
  const authors = [...new Set(library.flatMap((f) => [f.author, ...f.editors]))].sort((a, b) => a.localeCompare(b));
  const licenses = [...new Set(library.flatMap((f) => f.licenses))];
  return { library, local, authors, licenses };
}

export function creditsText(credits, { title, tool = 'ldraw-stl', toolUrl = '', libraryDate = '' } = {}) {
  const lines = [];
  lines.push(`Credits and licences for: ${title}`, '');
  if (credits.library.length) {
    lines.push(
      `This 3D model is an adaptation of ${credits.library.length} files of the LDraw.org Parts Library`,
      `(${LIBRARY_URL}${libraryDate ? `, library update ${libraryDate}` : ''}), made with ${tool}${toolUrl ? ` (${toolUrl})` : ''}.`,
      '',
      `Changes: ${CHANGES}`,
      '',
      'The source files are licensed as stated on each file below:',
      ...credits.licenses.map((l) => `  ${l}: ${LICENSE_URLS[l]}`),
      '  (CC BY 2.0 and CC BY 4.0: parts of the file are under either licence, see CAreadme.txt in the library)',
      '',
      `Authors: ${credits.authors.join(', ')}`,
      '',
      'Files used (path - title - author [later edits] - licence - source):',
    );
    for (const f of credits.library) {
      const edits = f.editors.length ? ` [edits: ${f.editors.join(', ')}]` : '';
      lines.push(`  ${f.rel} - ${f.title} - ${f.author}${edits} - ${f.license} - ${f.url}`);
    }
    lines.push('');
  }
  if (credits.local.length) {
    lines.push('Your own files (not from the LDraw library, their licence is yours to state):');
    for (const f of credits.local) lines.push(`  ${f.name}${f.title ? ` - ${f.title}` : ''}${f.author ? ` - ${f.author}` : ''}`);
    lines.push('');
  }
  lines.push(TRADEMARKS, '');
  return lines.join('\n');
}

// 80-byte STL header: the licence and where the full credits are.
export function stlLabel(credits) {
  if (!credits.library.length) return 'ldraw-stl';
  return `LDraw.org parts, ${credits.licenses.join(' + ') || 'CC BY'}; credits: see .credits.txt`.slice(0, 80);
}
