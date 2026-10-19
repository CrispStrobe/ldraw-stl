// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Part search over the catalog built from the library (name, title, category, keywords, type).

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class Catalog {
  constructor({ parts }) {
    this.parts = parts.map(([name, title, category, keywords, type]) => ({
      name, title, category, keywords, type,
      hidden: /^[~_=|]/.test(title), // subparts, obsolete, aliases, physical colours
      key: fold(name),
      text: fold(`${title} ${keywords}`),
    }));
    this.categories = [...new Set(this.parts.filter((p) => !p.hidden).map((p) => p.category))].sort((a, b) => a.localeCompare(b));
  }

  get(name) {
    const key = fold(name.replace(/\.dat$/i, ''));
    return this.parts.find((p) => p.key === key) ?? null;
  }

  // Every query word must appear in the part number, title or keywords. Ranking favours the
  // part number, then words at the start of the title, then short titles.
  search(query, { category = '', filter = null, hidden = false, limit = 60 } = {}) {
    const words = fold(query).split(/\s+/).filter(Boolean);
    const out = [];
    for (const p of this.parts) {
      if (p.hidden && !hidden) continue;
      if (category && p.category !== category) continue;
      if (filter && !filter(p)) continue;
      let score = 0;
      let ok = true;
      for (const w of words) {
        if (p.key === w) score += 1000;
        else if (p.key.startsWith(w)) score += 400;
        else if (p.key.includes(w)) score += 100;
        else {
          const i = p.text.indexOf(w);
          if (i < 0) { ok = false; break; }
          score += i === 0 ? 60 : /[\s(,-]/.test(p.text[i - 1]) ? 30 : 5;
        }
      }
      if (!ok) continue;
      out.push([score - p.title.length / 100, p]);
    }
    if (words.length) out.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name, undefined, { numeric: true }));
    else out.sort((a, b) => a[1].title.localeCompare(b[1].title, undefined, { numeric: true })); // browsing: A to Z
    return { total: out.length, results: limit ? out.slice(0, limit).map(([, p]) => p) : [] };
  }
}
