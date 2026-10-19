// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Progressive web app: service worker with an explicit "new version, reload" step, the install
// button, offline storage of the library, and files opened with the installed app.

import { t } from './i18n.mjs';

const $ = (sel) => document.querySelector(sel);
const mb = (bytes) => (bytes / 1e6).toFixed(0);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  let requested = false;
  // only reload when the user asked for the new version, not when the first worker takes over
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requested && !reloading) { reloading = true; location.reload(); }
  });
  const offer = (worker) => {
    $('#update').hidden = false;
    $('#update-btn').onclick = () => { requested = true; worker.postMessage('skip-waiting'); };
  };
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    // installed apps stay open for days: look for a new version now and then
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { /* no service worker (e.g. file://): the app still works online */ });
}

export function installButton() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#install-btn').hidden = false;
  });
  window.addEventListener('appinstalled', () => { $('#install-btn').hidden = true; deferred = null; });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    $('#install-btn').hidden = true;
  });
}

export function offlinePanel(library) {
  const panel = $('#offline');
  const status = $('#offline-status');
  const progress = $('#offline-progress');
  const get = $('#offline-get');
  const drop = $('#offline-drop');
  const refresh = async () => {
    const s = await library.offlineStatus().catch(() => ({ supported: false }));
    panel.hidden = false;
    get.textContent = t('pwa.getAll', { mb: mb(library.manifest.zip.bytes) });
    if (!s.supported) {
      status.textContent = t('pwa.unsupported');
      get.hidden = drop.hidden = true;
      return;
    }
    const all = s.stored === s.total;
    status.textContent = all ? t('pwa.statusAll', { mb: mb(s.bytes) }) : t('pwa.status', { files: s.files.toLocaleString() });
    get.hidden = all;
    drop.hidden = s.stored === 0;
  };
  get.addEventListener('click', async () => {
    get.disabled = drop.disabled = true;
    progress.hidden = false;
    try {
      await library.downloadAll((done, total) => {
        progress.value = done / total;
        status.textContent = t('pwa.progress', { done: mb(done), total: mb(total) });
      });
    } catch (err) {
      status.textContent = t('pwa.failed', { error: err.message });
      get.disabled = drop.disabled = false;
      progress.hidden = true;
      return;
    }
    progress.hidden = true;
    get.disabled = drop.disabled = false;
    refresh();
  });
  drop.addEventListener('click', async () => {
    await library.removeOffline();
    refresh();
  });
  refresh();
  return refresh;
}

// Files opened with the installed app ("Open with ldraw-stl"), where the browser supports it.
export function fileHandling(open) {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    open(await Promise.all(params.files.map((h) => h.getFile())));
  });
}
