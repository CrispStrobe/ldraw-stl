// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// About dialog: version, provider, privacy, components and their licences.

import { t, language } from './i18n.mjs';

export const REPO_URL = 'https://github.com/CrispStrobe/ldraw-stl';
const PROVIDER = {
  name: 'Christian Strobele',
  address: ['Nikolausstr. 5', '70190 Stuttgart', 'Deutschland / Germany'],
  email: 'postmaster@crispstro.be',
  phone: '+49 176 6421 8601',
};

// Shipped with the page, so they open without a network.
const LICENCE_TEXTS = [
  ['ldraw-stl (MPL-2.0)', 'licenses/ldraw-stl.MPL-2.0.txt'],
  ['three.js (MIT)', 'licenses/three.js.MIT.txt'],
  ['LDraw.org Parts Library: CAreadme.txt', 'library/CAreadme.txt'],
  ['CC BY 4.0 (CAlicense4.txt)', 'library/CAlicense4.txt'],
  ['CC BY 2.0 (CAlicense.txt)', 'library/CAlicense.txt'],
];

const COMPONENTS = [
  { name: 'ldraw-stl', url: REPO_URL, licence: 'MPL-2.0', licenceUrl: 'https://mozilla.org/MPL/2.0/', role: { en: 'This app and command-line tool', de: 'Diese App und das Kommandozeilenwerkzeug' } },
  { name: 'three.js 0.170.0', url: 'https://threejs.org', licence: 'MIT', licenceUrl: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE', role: { en: '3D preview (renderer and orbit controls), shipped unmodified', de: '3D-Vorschau (Renderer und Orbit-Steuerung), unverändert enthalten' } },
  { name: 'LDraw.org Parts Library', url: 'https://library.ldraw.org', licence: 'CC BY 4.0 / CC BY 2.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', role: { en: 'Part geometry and colours (LDConfig.ldr), mirrored unmodified', de: 'Teilegeometrie und Farben (LDConfig.ldr), unverändert gespiegelt' } },
];

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : String(c));
  return node;
};
const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

export function openAbout({ version, library }) {
  const lang = language();
  const dialog = el('dialog', { class: 'about', 'aria-labelledby': 'about-title' });
  const commit = version.commit && version.commit !== 'dev' ? version.commit : null;
  const details = el('dl', { class: 'details' },
    el('dt', {}, t('about.version')), el('dd', { class: 'mono' }, `${version.version}${commit ? ` (${commit.slice(0, 7)})` : ''}`),
    version.builtAt ? [el('dt', {}, t('about.built')), el('dd', { class: 'mono' }, version.builtAt.replace('T', ' ').slice(0, 16) + ' UTC')] : null,
    library ? [el('dt', {}, t('about.library')), el('dd', { class: 'mono' }, `${library.source.date} · ${library.fileCount} files · sha256 ${library.source.sha256.slice(0, 12)}…`)] : null,
  );
  const table = el('table', { class: 'licences' },
    el('thead', {}, el('tr', {}, el('th', {}, t('about.col.component')), el('th', {}, t('about.col.role')), el('th', {}, t('about.col.licence')))),
    el('tbody', {}, COMPONENTS.map((c) => el('tr', {},
      el('td', {}, link(c.url, c.name)),
      el('td', {}, c.role[lang] ?? c.role.en),
      el('td', {}, link(c.licenceUrl, c.licence)),
    ))),
  );
  dialog.append(
    el('h2', { id: 'about-title' }, t('about.title')),
    el('p', { class: 'blurb' }, t('about.blurb')),
    details,
    el('h3', {}, t('about.provider')),
    el('address', {}, PROVIDER.name, el('br'), ...PROVIDER.address.flatMap((l) => [l, el('br')])),
    el('h3', {}, t('about.contact')),
    el('p', {}, `${t('about.email')}: `, el('a', { href: `mailto:${PROVIDER.email}` }, PROVIDER.email), el('br'),
      `${t('about.phone')}: `, el('a', { href: `tel:${PROVIDER.phone.replace(/[^+0-9]/g, '')}` }, PROVIDER.phone)),
    el('h3', {}, t('about.privacy')),
    el('p', {}, t('about.privacyText')),
    el('h3', {}, t('about.disclaimer')),
    el('p', {}, t('about.disclaimerText')),
    el('h3', {}, t('about.components')),
    el('p', {}, t('about.licenseNote')),
    table,
    el('p', {}, t('about.libraryNote')),
    el('p', {}, t('about.texts'), ' ', ...LICENCE_TEXTS.flatMap(([label, href], i) => [i ? ' · ' : '', link(href, label)])),
    el('p', {}, link('THIRD-PARTY-NOTICES.txt', t('about.notices'))),
    el('h3', {}, t('about.thanks')),
    el('p', {}, t('about.thanksText')),
    el('h3', {}, t('about.affil')),
    el('p', {}, t('about.affilText')),
    el('div', { class: 'links' }, link(REPO_URL, t('about.source')), commit ? link(`${REPO_URL}/commit/${commit}`, t('about.commit')) : null),
  );
  const close = el('button', { class: 'primary', type: 'button', autofocus: '' }, t('about.close'));
  close.addEventListener('click', () => dialog.close());
  dialog.append(el('div', { class: 'actions' }, close));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  dialog.showModal();
}
